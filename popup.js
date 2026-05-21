// ===========================
// MAIN TAB SWITCHING
// ===========================
function switchMainTab(tab) {
  document.getElementById('panelMedia').classList.toggle('active', tab === 'media');
  document.getElementById('panelFtpSearch').classList.toggle('active', tab === 'ftpSearch');
  document.getElementById('panelFtp').classList.toggle('active', tab === 'ftp');
  document.getElementById('tabMediaBtn').classList.toggle('active', tab === 'media');
  document.getElementById('tabFtpSearchBtn').classList.toggle('active', tab === 'ftpSearch');
  document.getElementById('tabFtpBtn').classList.toggle('active', tab === 'ftp');
  if (tab === 'ftp') initFtpPanel();
  if (tab === 'media' && allMediaItems.length === 0) doMediaScan();
}

// ===========================
// TOAST & HELPERS
// ===========================
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  }).catch(() => {});
}

function safeDecode(str) {
  if (str == null || str === '') return '';
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

// ===========================
// MEDIA HUNTER
// ===========================
let allMediaItems = [];
let currentFilter = 'ALL';

function getFilteredMedia() {
  return currentFilter === 'ALL' ? allMediaItems : allMediaItems.filter(i => i.type === currentFilter);
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function sanitizeFilename(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .substring(0, 180) || 'media';
}

function getMediaDisplayName(item) {
  const raw = item.name || item.url.split('/').pop().split('?')[0] || '';
  return safeDecode(raw).replace(/\.[^.]+$/, '') || raw;
}

function getEpisodeSortKey(name) {
  const m = name.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10);
}

/** প্রথম–শেষ এপিসোড অনুযায়ী সাজানো (M3U নাম ও প্লেলিস্ট অর্ডার) */
function sortMediaForPlaylist(items) {
  return [...items].sort((a, b) => {
    const na = getMediaDisplayName(a);
    const nb = getMediaDisplayName(b);
    const ka = getEpisodeSortKey(na);
    const kb = getEpisodeSortKey(nb);
    if (ka != null && kb != null) return ka - kb;
    return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** M3U filename: From.S01E01 - S04E05.Long.Days.Journey... (first + last video name) */
function buildM3uPlaylistFilename(items) {
  if (!items.length) return 'media-hunter-playlist';
  const sorted = sortMediaForPlaylist(items);
  const first = getMediaDisplayName(sorted[0]);
  const last = getMediaDisplayName(sorted[sorted.length - 1]);
  if (sorted.length === 1) return sanitizeFilename(first);

  const epPattern = /[Ss]\d{1,2}[Ee]\d{1,2}/;
  const firstMatch = first.match(epPattern);
  const lastMatch = last.match(epPattern);

  if (firstMatch && lastMatch) {
    const firstIdx = first.search(epPattern);
    const lastIdx = last.search(epPattern);
    const head = first.slice(0, firstIdx + firstMatch[0].length);
    const tail = last.slice(lastIdx);
    return sanitizeFilename(`${head} - ${tail}`);
  }

  let commonLen = 0;
  const minLen = Math.min(first.length, last.length);
  while (commonLen < minLen && first[commonLen] === last[commonLen]) commonLen++;
  if (commonLen > 3) {
    return sanitizeFilename(`${first} - ${last.slice(commonLen)}`);
  }
  return sanitizeFilename(`${first} - ${last}`);
}

function updateBottomBarState() {
  const bar = document.getElementById('bottomBar');
  if (!bar) return;
  const filtered = getFilteredMedia();
  const hasItems = filtered.length > 0;
  bar.style.display = 'flex';
  ['copyAllBtn', 'downloadAllBtn', 'playAllVlcBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !hasItems;
  });
  document.getElementById('filteredCount').textContent = filtered.length + ' টি';
}

function buildM3uContent(items) {
  const sorted = sortMediaForPlaylist(items);
  const lines = ['#EXTM3U'];
  sorted.forEach((item, i) => {
    const title = getMediaDisplayName(item).replace(/,/g, ' ') || `Track ${i + 1}`;
    lines.push(`#EXTINF:-1,${title}`);
    lines.push(item.url);
  });
  return lines.join('\n') + '\n';
}

function downloadM3uFile(items, baseName = 'media-hunter-playlist') {
  if (!items.length) {
    showToast('কোনো media নেই');
    return;
  }

  const filename = `${sanitizeFilename(baseName)}.m3u`;
  const content = buildM3uContent(items);
  const blob = new Blob([content], { type: 'application/vnd.apple.mpegurl;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  // chrome.downloads + blob: URL → Chrome অনেক সময় UUID নাম দেয়; <a download> সঠিক নাম দেয়
  try {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`✅ ${items.length} টি — ${filename}`);
  } catch {
    const dataUrl = `data:application/vnd.apple.mpegurl;charset=utf-8,${encodeURIComponent(content)}`;
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, () => {
      if (chrome.runtime.lastError) {
        showToast('⚠️ M3U ডাউনলোড ব্যর্থ');
      } else {
        showToast(`✅ ${items.length} টি — ${filename}`);
      }
    });
  }

  setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
}

function downloadMediaUrl(item, index = 0) {
  let filename = item.name || item.url.split('/').pop().split('?')[0] || `media_${index + 1}`;
  filename = sanitizeFilename(filename);
  chrome.downloads.download({ url: item.url, filename, saveAs: false });
}

function renderMediaResults() {
  const filtered = getFilteredMedia();
  let video = 0, audio = 0, other = 0;
  allMediaItems.forEach(i => {
    if (i.type === 'VIDEO') video++;
    else if (i.type === 'AUDIO') audio++;
    else other++;
  });
  document.getElementById('videoCount').textContent = video;
  document.getElementById('audioCount').textContent = audio;
  document.getElementById('mediaCount').textContent = other;
  document.getElementById('totalCount').textContent = 'মোট: ' + allMediaItems.length;
  document.getElementById('statsBar').style.display = 'flex';
  document.getElementById('filterBar').style.display = 'flex';
  updateBottomBarState();

  const content = document.getElementById('content');
  if (filtered.length === 0) {
    content.innerHTML = `<div class="state-msg"><div class="state-icon">😕</div><div class="state-title">কিছু পাওয়া যায়নি</div><div class="state-sub">এই পেজে কোনো media URL নেই</div></div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'media-list';
  filtered.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'media-card';
    const safeUrl = escAttr(item.url);
    const safeName = item.name ? escAttr(item.name) : '';
    card.innerHTML = `
      <div class="card-top">
        <span class="ext-badge badge-${item.type}">${item.type}</span>
        <span class="url-text" title="${safeUrl}">${item.url}</span>
      </div>
      ${safeName ? `<div class="card-title" title="${safeName}">${item.name}</div>` : ''}
      <div class="card-actions">
        <button class="btn-copy" data-url="${safeUrl}">📋 কপি</button>
        <button class="btn-download" data-idx="${idx}">⬇ ডাউনলোড</button>
        <button class="btn-vlc" data-idx="${idx}">▶ VLC</button>
      </div>`;
    list.appendChild(card);
  });
  content.innerHTML = '';
  content.appendChild(list);

  list.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.url);
      btn.textContent = '✅ কপি';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '📋 কপি'; btn.classList.remove('copied'); }, 1500);
    });
  });
  list.querySelectorAll('.btn-download').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = filtered[parseInt(btn.dataset.idx, 10)];
      if (item) {
        downloadMediaUrl(item, parseInt(btn.dataset.idx, 10));
        showToast('⬇ ডাউনলোড শুরু...');
      }
    });
  });
  list.querySelectorAll('.btn-vlc').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = filtered[parseInt(btn.dataset.idx, 10)];
      if (item) {
        downloadM3uFile([item], buildM3uPlaylistFilename([item]));
      }
    });
  });
}

async function doMediaScan() {
  const btn = document.getElementById('scanBtn');
  btn.disabled = true;
  btn.textContent = '⏳ স্ক্যান চলছে...';
  document.getElementById('content').innerHTML = `<div class="state-msg"><div class="spinner"></div><div class="state-title">স্ক্যান চলছে...</div></div>`;
  document.getElementById('statsBar').style.display = 'none';
  document.getElementById('filterBar').style.display = 'none';
  updateBottomBarState();

  try {
    const tab = await getActiveTab();
    document.getElementById('pageTitle').textContent = (tab.title || '').substring(0, 40) + (tab.title && tab.title.length > 40 ? '...' : '');
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'scanMedia' });
    allMediaItems = response?.results || [];
    renderMediaResults();
  } catch (e) {
    document.getElementById('content').innerHTML = `<div class="state-msg"><div class="state-icon">⚠️</div><div class="state-title">স্ক্যান ব্যর্থ হয়েছে</div><div class="state-sub">${e.message || 'পেজ reload করে আবার চেষ্টা করুন'}</div></div>`;
  }
  btn.disabled = false;
  btn.textContent = '⚡ স্ক্যান';
}

// ===========================
// FTP DEEP SEARCH (subfolders)
// ===========================
let ftpSearchProgressHandler = null;

function onFtpSearchProgress(msg) {
  if (msg.action !== 'ftpSearchProgress') return;
  const el = document.getElementById('searchResultCount');
  if (el) {
    el.textContent = `${msg.resultsCount || 0} টি · ${msg.foldersScanned || 0} ফোল্ডার স্ক্যান...`;
  }
}

async function doFtpSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) { showToast('কিছু লিখুন!'); return; }

  const searchBtn = document.getElementById('searchBtn');
  const searchResults = document.getElementById('searchResults');
  const searchResultCount = document.getElementById('searchResultCount');

  searchBtn.disabled = true;
  searchBtn.textContent = '⏳ Deep সার্চ...';
  searchResultCount.textContent = 'শুরু হচ্ছে...';
  searchResults.innerHTML = `<div class="state-msg"><div class="spinner"></div><div class="state-title">Deep Search চলছে...</div><div class="state-sub">সাবফোল্ডার খুঁজছে (একটু সময় লাগতে পারে)</div></div>`;

  if (ftpSearchProgressHandler) {
    chrome.runtime.onMessage.removeListener(ftpSearchProgressHandler);
  }
  ftpSearchProgressHandler = onFtpSearchProgress;
  chrome.runtime.onMessage.addListener(ftpSearchProgressHandler);

  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'searchFtp', query, deep: true });
    if (response?.error) throw new Error(response.error);
    renderSearchResults(response?.results || [], query, response);
  } catch (err) {
    searchResultCount.textContent = '';
    searchResults.innerHTML = `<div class="state-msg"><div class="state-icon">⚠️</div><div class="state-title">সার্চ করা যায়নি</div><div class="state-sub">${err.message || 'পেজ reload করে আবার চেষ্টা করুন'}</div></div>`;
  } finally {
    if (ftpSearchProgressHandler) {
      chrome.runtime.onMessage.removeListener(ftpSearchProgressHandler);
      ftpSearchProgressHandler = null;
    }
    searchBtn.disabled = false;
    searchBtn.textContent = '🔍 খোঁজো';
  }
}

function renderSearchResults(results, query, meta = {}) {
  const searchResults = document.getElementById('searchResults');
  const searchResultCount = document.getElementById('searchResultCount');
  const scanned = meta.scannedFolders ? ` · ${meta.scannedFolders} ফোল্ডার` : '';

  if (!results || results.length === 0) {
    searchResultCount.textContent = meta.scannedFolders ? `${meta.scannedFolders} ফোল্ডার স্ক্যান` : '';
    searchResults.innerHTML = `<div class="state-msg"><div class="state-icon">😕</div><div class="state-title">"${query}" পাওয়া যায়নি</div><div class="state-sub">Deep search: সাবফোল্ডারেও খুঁজেছে — অন্য নাম দিয়ে চেষ্টা করুন</div></div>`;
    return;
  }

  searchResultCount.textContent = results.length + ' টি পাওয়া গেছে' + scanned;
  searchResults.innerHTML = '';

  results.forEach(item => {
    const card = document.createElement('div');
    card.className = 'result-card' + (item.isFile ? ' is-file' : '');
    const badgeClass = item.type === 'FOLDER' ? 'badge-FOLDER'
      : item.type === 'VIDEO' ? 'badge-VIDEO'
      : item.type === 'AUDIO' ? 'badge-AUDIO'
      : 'badge-FILE';
    const icon = item.type === 'FOLDER' ? '📁' : item.type === 'VIDEO' ? '🎬' : item.type === 'AUDIO' ? '🎵' : '📄';

    let displayName = item.text || '';
    try {
      const u = new URL(item.url);
      const parts = safeDecode(u.pathname).split('/').filter(Boolean);
      displayName = parts[parts.length - 1] || displayName;
    } catch {}

    card.innerHTML = `
      <div class="result-top">
        <span class="type-badge ${badgeClass}">${icon} ${item.type}</span>
        <span class="result-name" title="${displayName}">${displayName}</span>
      </div>
      <div class="result-url" title="${item.url}">${item.url}</div>
      <div class="result-actions">
        <button class="btn-check-tab" data-url="${item.url}">🔀 Check Tab এ দেখুন</button>
        <button class="btn-copy-link" data-url="${item.url}">📋 লিংক কপি</button>
        <button class="btn-open-link" data-url="${item.url}">↗ খুলুন</button>
      </div>`;

    card.querySelector('.btn-check-tab').addEventListener('click', async (e) => {
      const url = e.currentTarget.dataset.url;
      const tab = await getActiveTab();
      await chrome.tabs.update(tab.id, { url });
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      showToast('✅ Tab এ খুলছে...');
      window.close();
    });

    card.querySelector('.btn-copy-link').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      await navigator.clipboard.writeText(btn.dataset.url);
      btn.textContent = '✅ কপি হয়েছে!';
      btn.classList.add('copied');
      setTimeout(() => { btn.innerHTML = '📋 লিংক কপি'; btn.classList.remove('copied'); }, 2000);
      showToast('✅ লিংক কপি হয়েছে!');
    });

    card.querySelector('.btn-open-link').addEventListener('click', (e) => {
      chrome.tabs.create({ url: e.currentTarget.dataset.url });
      showToast('🆕 নতুন ট্যাবে খুলছে');
    });

    searchResults.appendChild(card);
  });
}

// ===========================
// FTP SCAN — popup side
// ===========================
let ftpCurrentFilter = 'ALL';
let ftpResultsCache = {};

function applyFtpSavedData(data) {
  if (!data) return false;
  const results = data.results || {};
  if (!Object.keys(results).length) return false;
  ftpResultsCache = results;
  if (data.lastScan) {
    const d = new Date(data.lastScan);
    document.getElementById('ftpLastScan').innerHTML =
      `শেষ স্ক্যান: <span>${d.toLocaleDateString('bn-BD')} ${d.toLocaleTimeString('bn-BD')}</span>`;
  }
  const total = data.servers?.length || Object.keys(results).length;
  const done = Object.values(results).filter(r => r.status !== 'pending' && r.status !== 'scanning').length;
  updateFtpUI(false, done, total);
  renderFtpList();
  return true;
}

function applyFtpCompactWorking(compact) {
  if (!compact) return false;
  const working = compact.urls || [];
  const servers = compact.allServers?.length ? compact.allServers : working;
  if (!servers.length) return false;

  const workingSet = new Set(working);
  ftpResultsCache = {};
  servers.forEach(url => {
    ftpResultsCache[url] = { status: workingSet.has(url) ? 'working' : 'dead' };
  });
  if (compact.lastScan || compact.savedAt) {
    const d = new Date(compact.lastScan || compact.savedAt);
    document.getElementById('ftpLastScan').innerHTML =
      `শেষ স্ক্যান: <span>${d.toLocaleDateString('bn-BD')} ${d.toLocaleTimeString('bn-BD')}</span>`;
  }
  updateFtpUI(false, list.length, list.length);
  renderFtpList();
  return true;
}

/** Android/Kiwi: popup সরাসরি storage পড়ে — background memory খালি থাকলেও কাজ করে */
function loadFtpDirectFromStorage(callback) {
  chrome.storage.local.get(['ftpScanData', 'ftpWorkingServers'], (data) => {
    if (chrome.runtime.lastError) {
      callback(false);
      return;
    }
    if (applyFtpSavedData(data.ftpScanData)) {
      callback(true);
      return;
    }
    if (applyFtpCompactWorking(data.ftpWorkingServers)) {
      callback(true);
      return;
    }
    callback(false);
  });
}

function initFtpPanel() {
  loadFtpDirectFromStorage((directOk) => {
    if (directOk) return;

    chrome.runtime.sendMessage({ action: 'ftpGetStatus' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        loadFtpFromStorage();
        return;
      }
      const results = resp.results || {};
      const hasData = Object.keys(results).length > 0;
      if (!hasData) {
        loadFtpFromStorage();
        return;
      }
      ftpResultsCache = results;
      if (resp.lastScan) {
        const d = new Date(resp.lastScan);
        document.getElementById('ftpLastScan').innerHTML =
          `শেষ স্ক্যান: <span>${d.toLocaleDateString('bn-BD')} ${d.toLocaleTimeString('bn-BD')}</span>`;
      }
      updateFtpUI(resp.scanning, resp.done || 0, resp.total || 0);
      renderFtpList();
    });
  });
}

function loadFtpFromStorage() {
  loadFtpDirectFromStorage((ok) => {
    if (ok) return;
    chrome.runtime.sendMessage({ action: 'ftpLoadSaved' }, (resp) => {
      if (resp?.data) applyFtpSavedData(resp.data);
    });
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'ftpProgress' || msg.action === 'ftpScanDone') {
    ftpResultsCache = msg.results || {};
    updateFtpUI(msg.scanning, msg.done || 0, msg.total || 0);
    renderFtpList();
    if (msg.action === 'ftpScanDone') {
      showToast('✅ স্ক্যান সম্পন্ন!');
      setScanBtnState(false);
      const now = new Date();
      document.getElementById('ftpLastScan').innerHTML =
        `শেষ স্ক্যান: <span>${now.toLocaleDateString('bn-BD')} ${now.toLocaleTimeString('bn-BD')}</span>`;
    }
  }
  if (msg.action === 'ftpScanError') {
    showToast('⚠️ ' + msg.msg);
    setScanBtnState(false);
  }
});

function updateFtpUI(scanning, done, total) {
  setScanBtnState(scanning);
  if (total > 0) {
    const pct = Math.round((done / total) * 100);
    document.getElementById('ftpProgressBar').style.width = pct + '%';
    document.getElementById('ftpProgressText').textContent = done + '/' + total;
  }
  const working = Object.values(ftpResultsCache).filter(r => r.status === 'working').length;
  document.getElementById('ftpWorkingCount').textContent = '✅ ' + working + ' working';
}

function setScanBtnState(scanning) {
  document.getElementById('ftpScanBtn').style.display = scanning ? 'none' : 'inline-block';
  document.getElementById('ftpStopBtn').style.display = scanning ? 'inline-block' : 'none';
  const badge = document.getElementById('ftpScanningBadge');
  if (badge) badge.style.display = scanning ? 'flex' : 'none';
}

function renderFtpList() {
  const list = document.getElementById('ftpList');
  const entries = Object.entries(ftpResultsCache);
  const filtered = entries.filter(([, info]) => {
    if (ftpCurrentFilter === 'ALL') return true;
    if (ftpCurrentFilter === 'WORKING') return info.status === 'working';
    if (ftpCurrentFilter === 'DEAD') return info.status === 'dead';
    if (ftpCurrentFilter === 'PENDING') return info.status === 'pending' || info.status === 'scanning';
    return true;
  });

  document.getElementById('ftpResultBadge').textContent = filtered.length + ' টি';

  if (entries.length === 0) {
    list.innerHTML = `<div class="state-msg"><div class="state-icon">🖥️</div><div class="state-title">সার্ভার স্ক্যান করা হয়নি</div><div class="state-sub">🔍 স্ক্যান বাটন চাপুন</div></div>`;
    return;
  }
  if (filtered.length === 0) {
    list.innerHTML = `<div class="state-msg"><div class="state-icon">🔍</div><div class="state-title">এই ক্যাটাগরিতে কিছু নেই</div></div>`;
    return;
  }

  const order = { scanning: 0, working: 1, pending: 2, dead: 3 };
  filtered.sort((a, b) => (order[a[1].status] || 3) - (order[b[1].status] || 3));

  list.innerHTML = '';
  filtered.forEach(([url, info]) => {
    const card = document.createElement('div');
    card.className = `ftp-card status-${info.status}`;
    const statusLabels = { working: '✅ Working', dead: '❌ Dead', scanning: '🔄 Scanning', pending: '⏳ Pending' };
    card.innerHTML = `
      <div class="ftp-status-dot ${info.status}"></div>
      <span class="ftp-card-url">${url}</span>
      <span class="ftp-card-status ${info.status}">${statusLabels[info.status] || info.status}</span>
      ${info.status === 'working' ? `<button class="ftp-visit-btn" data-url="${url}">🌐 ভিজিট</button>` : ''}`;
    list.appendChild(card);
  });

  list.querySelectorAll('.ftp-visit-btn').forEach(btn => {
    btn.addEventListener('click', () => chrome.tabs.create({ url: btn.dataset.url }));
  });
}

// ===========================
// DOMContentLoaded
// ===========================
document.addEventListener('DOMContentLoaded', async () => {
  const tab = await getActiveTab();
  if (tab) {
    document.getElementById('pageTitle').textContent = (tab.title || tab.url || '').substring(0, 40);
    const urlEl = document.getElementById('currentPageUrl');
    if (urlEl) {
      try {
        const u = new URL(tab.url);
        urlEl.textContent = u.hostname + u.pathname.slice(0, 40);
      } catch { urlEl.textContent = (tab.url || '').slice(0, 50); }
    }
  }

  document.getElementById('tabMediaBtn').addEventListener('click', () => switchMainTab('media'));
  document.getElementById('tabFtpSearchBtn').addEventListener('click', () => switchMainTab('ftpSearch'));
  document.getElementById('tabFtpBtn').addEventListener('click', () => switchMainTab('ftp'));

  document.getElementById('scanBtn').addEventListener('click', doMediaScan);

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      if (allMediaItems.length > 0) renderMediaResults();
    });
  });

  document.getElementById('copyAllBtn').addEventListener('click', () => {
    const filtered = getFilteredMedia();
    if (!filtered.length) { showToast('কোনো media নেই'); return; }
    navigator.clipboard.writeText(filtered.map(i => i.url).join('\n'));
    showToast(`✅ ${filtered.length} টি URL কপি হয়েছে!`);
  });

  document.getElementById('downloadAllBtn').addEventListener('click', () => {
    const filtered = getFilteredMedia();
    if (!filtered.length) { showToast('কোনো media নেই'); return; }
    filtered.forEach((item, i) => downloadMediaUrl(item, i));
    showToast(`⬇ ${filtered.length} টি ফাইল ডাউনলোড শুরু...`);
  });

  document.getElementById('playAllVlcBtn').addEventListener('click', () => {
    const filtered = sortMediaForPlaylist(getFilteredMedia());
    if (!filtered.length) { showToast('কোনো media নেই'); return; }
    downloadM3uFile(filtered, buildM3uPlaylistFilename(filtered));
  });

  document.getElementById('searchBtn').addEventListener('click', doFtpSearch);
  document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doFtpSearch(); });

  document.getElementById('ftpScanBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'ftpStartScan' }, (resp) => {
      if (resp && resp.status === 'started') {
        setScanBtnState(true);
        showToast('🔍 Background এ স্ক্যান শুরু হয়েছে...');
      } else if (resp && resp.status === 'already_running') {
        showToast('⚠️ স্ক্যান ইতিমধ্যে চলছে');
      }
    });
  });

  document.getElementById('ftpStopBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'ftpStopScan' });
    showToast('⏹ স্ক্যান বন্ধ করা হচ্ছে...');
  });

  document.querySelectorAll('.ftp-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ftp-filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      ftpCurrentFilter = tab.dataset.ftpFilter;
      renderFtpList();
    });
  });

  document.getElementById('ftpVisitAllBtn').addEventListener('click', () => {
    const working = Object.entries(ftpResultsCache).filter(([, info]) => info.status === 'working');
    if (working.length === 0) { showToast('কোনো working সার্ভার নেই'); return; }
    working.forEach(([url]) => chrome.tabs.create({ url }));
    showToast(`✅ ${working.length} টি সার্ভার খোলা হচ্ছে...`);
  });

  document.getElementById('ftpClearBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'ftpClearData' });
    ftpResultsCache = {};
    document.getElementById('ftpProgressBar').style.width = '0%';
    document.getElementById('ftpProgressText').textContent = '0/0';
    document.getElementById('ftpLastScan').innerHTML = `শেষ স্ক্যান: <span>কখনো না</span>`;
    document.getElementById('ftpWorkingCount').textContent = '✅ 0 working';
    renderFtpList();
    showToast('🗑 ডেটা ক্লিয়ার হয়েছে');
  });

  updateBottomBarState();
  doMediaScan();
});
