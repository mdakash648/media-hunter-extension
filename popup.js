// ===========================
// MAIN TAB SWITCHING
// ===========================
function switchMainTab(tab) {
  document.getElementById('panelMedia').classList.toggle('active', tab === 'media');
  document.getElementById('panelFtpSearch').classList.toggle('active', tab === 'ftpSearch');
  document.getElementById('panelFtp').classList.toggle('active', tab === 'ftp');
  document.getElementById('panelM3u').classList.toggle('active', tab === 'm3u');
  document.getElementById('tabMediaBtn').classList.toggle('active', tab === 'media');
  document.getElementById('tabFtpSearchBtn').classList.toggle('active', tab === 'ftpSearch');
  document.getElementById('tabFtpBtn').classList.toggle('active', tab === 'ftp');
  document.getElementById('tabM3uBtn').classList.toggle('active', tab === 'm3u');
  if (tab === 'ftp') initFtpPanel();
  if (tab === 'ftpSearch') initFtpSearchPanel();
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
// FTP DEEP SEARCH (subfolders) + BULK SEARCH (working servers)
// ===========================
let bulkFtpSearchRows = [];
let bulkFtpSearchRunning = false;
let deepSearchRunning = false;
let deepSearchQuery = '';
let deepSearchRenderedUrls = new Set();

function isBulkFtpSearchOn() {
  return document.getElementById('bulkFtpToggle')?.checked === true;
}

function getWorkingFtpUrls() {
  return Object.entries(ftpResultsCache)
    .filter(([, info]) => info.status === 'working')
    .map(([url]) => url);
}

function updateBulkWorkingHint() {
  const hint = document.getElementById('bulkWorkingHint');
  const info = document.getElementById('currentPageUrl');
  const working = getWorkingFtpUrls().length;

  if (hint) {
    hint.textContent = isBulkFtpSearchOn() ? `${working} working` : '';
  }
  if (info) {
    info.textContent = isBulkFtpSearchOn()
      ? `Bulk — FTP স্ক্যানের ${working}টি working সার্ভার`
      : 'Deep Search — সাবফোল্ডার সহ খুঁজবে';
  }
}

function setBulkSearchBtnState(scanning) {
  const searchBtn = document.getElementById('searchBtn');
  if (!searchBtn) return;
  bulkFtpSearchRunning = scanning;
  searchBtn.textContent = scanning ? '⏹ বন্ধ' : '🔍 খোঁজো';
  searchBtn.disabled = false;
}

function applyBulkSearchStatus(resp) {
  if (!resp) return;
  bulkFtpSearchRows = resp.rows || [];
  if (resp.query) {
    const input = document.getElementById('searchInput');
    if (input) input.value = resp.query;
  }
  setBulkSearchBtnState(!!resp.running);
  const info = document.getElementById('currentPageUrl');
  if (info && isBulkFtpSearchOn()) {
    if (resp.running) {
      const done = resp.done ?? bulkFtpSearchRows.filter(r => !['pending', 'scanning'].includes(r.status)).length;
      const total = resp.total ?? bulkFtpSearchRows.length;
      info.textContent = `🔄 Background সার্চ ${done}/${total} — পপআপ বন্ধ করলেও চলবে`;
    } else {
      updateBulkWorkingHint();
    }
  }
  if (bulkFtpSearchRows.length) renderBulkFtpResults();
}

function syncBulkSearchFromBackground() {
  chrome.runtime.sendMessage({ action: 'ftpBulkSearchGetStatus' }, (resp) => {
    if (chrome.runtime.lastError || !resp) return;
    applyBulkSearchStatus(resp);
  });
}

function initFtpSearchPanel() {
  loadFtpDirectFromStorage(() => {
    updateBulkWorkingHint();
    syncBulkSearchFromBackground();
    loadDeepSearchFromStorage();
  });
}

function setDeepSearchBtnState(scanning) {
  const searchBtn = document.getElementById('searchBtn');
  if (!searchBtn) return;
  deepSearchRunning = scanning;
  if (!isBulkFtpSearchOn()) {
    searchBtn.textContent = scanning ? '⏹ বন্ধ' : '🔍 খোঁজো';
    searchBtn.disabled = false;
  }
}

function loadDeepSearchFromStorage() {
  chrome.storage.local.get(['ftpDeepSearchData'], (data) => {
    if (chrome.runtime.lastError) return;
    const saved = data.ftpDeepSearchData;
    if (!saved?.results?.length && !saved?.running) return;
    applyDeepSearchProgress({
      action: 'ftpSearchProgress',
      query: saved.query,
      rootUrl: saved.rootUrl,
      results: saved.results || [],
      foldersScanned: saved.foldersScanned || 0,
      running: !!saved.running
    });
  });
  chrome.runtime.sendMessage({ action: 'ftpDeepSearchGetStatus' }, (resp) => {
    if (chrome.runtime.lastError || !resp) return;
    if ((resp.results?.length || 0) > 0 || resp.running) {
      applyDeepSearchProgress({ action: 'ftpSearchProgress', ...resp });
    }
  });
}

function showDeepSearchLiveShell(query) {
  const searchResults = document.getElementById('searchResults');
  deepSearchRenderedUrls = new Set();
  searchResults.innerHTML = `
    <div class="deep-live-status" id="deepLiveStatus">
      <div class="spinner" style="width:18px;height:18px;display:inline-block;vertical-align:middle;margin-right:6px"></div>
      <span>লাইভ সার্চ চলছে — পপআপ বন্ধ করলেও চলবে</span>
    </div>
    <div id="deepSearchLiveList"></div>`;
  const info = document.getElementById('currentPageUrl');
  if (info) info.textContent = `"${query}" — লাইভ ফলাফল`;
}

function buildSearchResultCard(item) {
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

  return card;
}

function applyDeepSearchProgress(msg) {
  if (!msg || isBulkFtpSearchOn()) return;

  const results = msg.results || [];
  const query = msg.query || deepSearchQuery || document.getElementById('searchInput')?.value?.trim() || '';
  deepSearchQuery = query;
  if (msg.query) {
    const input = document.getElementById('searchInput');
    if (input) input.value = msg.query;
  }

  setDeepSearchBtnState(!!msg.running);

  const searchResultCount = document.getElementById('searchResultCount');
  const scanned = msg.foldersScanned ? ` · ${msg.foldersScanned} ফোল্ডার` : '';
  const liveTag = msg.running ? ' · 🔄 লাইভ' : '';
  if (searchResultCount) {
    searchResultCount.textContent = results.length
      ? `${results.length} টি${scanned}${liveTag}`
      : (msg.running ? `খুঁজছি...${scanned}` : `0 টি${scanned}`);
  }

  const searchResults = document.getElementById('searchResults');
  if (msg.running && !document.getElementById('deepSearchLiveList')) {
    showDeepSearchLiveShell(query);
  }

  let list = document.getElementById('deepSearchLiveList');
  if (!list && results.length) {
    searchResults.innerHTML = '<div id="deepSearchLiveList"></div>';
    list = document.getElementById('deepSearchLiveList');
    deepSearchRenderedUrls = new Set();
  }
  if (!list) return;

  results.forEach((item) => {
    if (!item?.url || deepSearchRenderedUrls.has(item.url)) return;
    deepSearchRenderedUrls.add(item.url);
    list.appendChild(buildSearchResultCard(item));
  });

  const statusEl = document.getElementById('deepLiveStatus');
  if (statusEl) {
    statusEl.style.display = msg.running ? 'block' : 'none';
  }

  if (!results.length && !msg.running) {
    searchResults.innerHTML = `<div class="state-msg"><div class="state-icon">😕</div><div class="state-title">"${query}" পাওয়া যায়নি</div><div class="state-sub">সাবফোল্ডারেও খুঁজেছে</div></div>`;
  }
}

const bulkStatusLabels = {
  pending: '⏳ অপেক্ষা',
  scanning: '🔄 স্ক্যান...',
  found: '✅ পাওয়া গেছে',
  not_found: '❌ নেই',
  error: '⚠️ এরর'
};

function renderBulkFtpResults() {
  const searchResults = document.getElementById('searchResults');
  const searchResultCount = document.getElementById('searchResultCount');
  const total = bulkFtpSearchRows.length;
  const done = bulkFtpSearchRows.filter(r => !['pending', 'scanning'].includes(r.status)).length;
  const found = bulkFtpSearchRows.filter(r => r.status === 'found').length;

  if (searchResultCount) {
    searchResultCount.textContent = total
      ? `${done}/${total} · ${found} পাওয়া গেছে`
      : '';
  }

  if (!total) {
    searchResults.innerHTML = `<div class="state-msg"><div class="state-icon">🖥️</div><div class="state-title">কোনো working সার্ভার নেই</div><div class="state-sub">আগে FTP স্ক্যান ট্যাবে স্ক্যান চালান</div></div>`;
    return;
  }

  searchResults.innerHTML = '';
  bulkFtpSearchRows.forEach((row) => {
    const card = document.createElement('div');
    card.className = `bulk-result-card status-${row.status}`;
    const safeUrl = escAttr(row.url);
    const openTarget = escAttr(row.searchUrl || row.url);
    const labelClass = `bulk-status-label ${row.status}`;
    const matchHint = row.matchText ? ` · ${row.matchText}` : '';
    const urlHtml = row.status === 'found'
      ? `<a class="bulk-url is-found" href="${openTarget}" title="${escAttr(row.matchText || row.url)}">${row.url}</a>`
      : `<span class="bulk-url" title="${safeUrl}">${row.url}</span>`;

    card.innerHTML = `
      <span class="bulk-dot ${row.status}"></span>
      <div class="bulk-result-body">
        ${urlHtml}
        <span class="${labelClass}">${bulkStatusLabels[row.status] || row.status}${matchHint}${row.detail && row.status === 'error' ? ' · ' + row.detail : ''}</span>
      </div>`;

    if (row.status === 'found') {
      card.querySelector('.bulk-url.is-found')?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: row.searchUrl || row.url });
      });
    }

    if (row.status === 'found') {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'bulk-open-btn';
      openBtn.textContent = '↗ খুলুন';
      openBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: row.searchUrl || row.url });
      });
      card.appendChild(openBtn);
    } else if (row.status === 'scanning') {
      const mini = document.createElement('div');
      mini.className = 'spinner';
      mini.style.cssText = 'width:14px;height:14px;border-width:2px;flex-shrink:0';
      card.appendChild(mini);
    }

    searchResults.appendChild(card);
  });
}

function startBulkFtpSearchInBackground(query) {
  const searchResults = document.getElementById('searchResults');
  searchResults.innerHTML = `<div class="state-msg"><div class="spinner"></div><div class="state-title">Background Bulk সার্চ...</div><div class="state-sub">পপআপ বন্ধ করলেও চলবে — আবার খুলে ফলাফল দেখুন</div></div>`;

  chrome.runtime.sendMessage({ action: 'ftpBulkSearchStart', query }, (resp) => {
    if (chrome.runtime.lastError) {
      showToast('⚠️ সার্চ শুরু হয়নি');
      return;
    }
    if (resp?.status === 'error') {
      showToast('⚠️ ' + (resp.error || 'সার্চ শুরু হয়নি'));
      if (resp.error?.includes('working')) {
        searchResults.innerHTML = `<div class="state-msg"><div class="state-icon">🖥️</div><div class="state-title">Working সার্ভার নেই</div><div class="state-sub">FTP স্ক্যান ট্যাবে স্ক্যান চালান</div></div>`;
      }
      return;
    }
    if (resp?.status === 'already_running') {
      showToast('ℹ️ সার্চ ইতিমধ্যে চলছে');
      applyBulkSearchStatus(resp);
      return;
    }
    applyBulkSearchStatus(resp);
    showToast('🔍 Background সার্চ শুরু — পপআপ বন্ধ করতে পারেন');
  });
}

async function doFtpSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) { showToast('কিছু লিখুন!'); return; }

  const searchBtn = document.getElementById('searchBtn');

  if (bulkFtpSearchRunning) {
    chrome.runtime.sendMessage({ action: 'ftpBulkSearchStop' });
    setBulkSearchBtnState(false);
    showToast('⏹ সার্চ বন্ধ হচ্ছে...');
    return;
  }

  if (isBulkFtpSearchOn()) {
    if (query.length < 2) {
      showToast('⚠️ কমপক্ষে ২ অক্ষর লিখুন');
      return;
    }
    if (Object.keys(ftpResultsCache).length === 0) {
      await new Promise((resolve) => loadFtpDirectFromStorage(() => resolve()));
    }
    startBulkFtpSearchInBackground(query);
    return;
  }

  if (deepSearchRunning) {
    const tab = await getActiveTab();
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'ftpDeepSearchStop' }).catch(() => {});
    }
    setDeepSearchBtnState(false);
    showToast('⏹ সার্চ বন্ধ হচ্ছে...');
    return;
  }

  const searchResultCount = document.getElementById('searchResultCount');
  deepSearchQuery = query;
  showDeepSearchLiveShell(query);
  if (searchResultCount) searchResultCount.textContent = 'খুঁজছি... 0 টি';

  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    chrome.tabs.sendMessage(tab.id, { action: 'searchFtp', query, deep: true, live: true }, (response) => {
      if (chrome.runtime.lastError) {
        document.getElementById('searchResults').innerHTML =
          `<div class="state-msg"><div class="state-icon">⚠️</div><div class="state-title">সার্চ শুরু হয়নি</div><div class="state-sub">${chrome.runtime.lastError.message}</div></div>`;
        setDeepSearchBtnState(false);
        return;
      }
      if (response?.error) {
        document.getElementById('searchResults').innerHTML =
          `<div class="state-msg"><div class="state-icon">⚠️</div><div class="state-title">সার্চ করা যায়নি</div><div class="state-sub">${response.error}</div></div>`;
        setDeepSearchBtnState(false);
        return;
      }
      if (response?.started) {
        deepSearchRunning = true;
        setDeepSearchBtnState(true);
        showToast('🔍 লাইভ সার্চ — পপআপ বন্ধ করলেও চলবে');
      }
    });
  } catch (err) {
    if (searchResultCount) searchResultCount.textContent = '';
    document.getElementById('searchResults').innerHTML =
      `<div class="state-msg"><div class="state-icon">⚠️</div><div class="state-title">সার্চ করা যায়নি</div><div class="state-sub">${err.message || 'পেজ reload করে আবার চেষ্টা করুন'}</div></div>`;
    setDeepSearchBtnState(false);
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
  searchResults.innerHTML = '<div id="deepSearchLiveList"></div>';
  deepSearchRenderedUrls = new Set();
  const list = document.getElementById('deepSearchLiveList');
  results.forEach((item) => {
    deepSearchRenderedUrls.add(item.url);
    list.appendChild(buildSearchResultCard(item));
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

function normalizeScanUrl(url) {
  try {
    const u = new URL(String(url).trim());
    let path = u.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${u.protocol}//${u.host}${path}${u.search}`.toLowerCase();
  } catch {
    return String(url).trim().replace(/\/+$/, '').toLowerCase();
  }
}

function applyFtpCompactWorking(compact) {
  if (!compact) return false;
  const working = compact.urls || [];
  const servers = compact.allServers?.length ? compact.allServers : working;
  if (!servers.length) return false;

  const workingSet = new Set(working.map(normalizeScanUrl));
  ftpResultsCache = {};
  servers.forEach(url => {
    ftpResultsCache[url] = { status: workingSet.has(normalizeScanUrl(url)) ? 'working' : 'dead' };
  });
  if (compact.lastScan || compact.savedAt) {
    const d = new Date(compact.lastScan || compact.savedAt);
    document.getElementById('ftpLastScan').innerHTML =
      `শেষ স্ক্যান: <span>${d.toLocaleDateString('bn-BD')} ${d.toLocaleTimeString('bn-BD')}</span>`;
  }
  updateFtpUI(false, servers.length, servers.length);
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
  if (msg.action === 'ftpSearchProgress') {
    applyDeepSearchProgress(msg);
    return;
  }
  if (msg.action === 'ftpSearchDone') {
    applyDeepSearchProgress({ ...msg, running: false });
    deepSearchRunning = false;
    setDeepSearchBtnState(false);
    const n = (msg.results || []).length;
    const scanned = msg.scannedFolders || msg.foldersScanned || 0;
    if (msg.stopped) {
      showToast(`⏹ বন্ধ — ${n} টি ফলাফল`);
    } else if (msg.error) {
      showToast('⚠️ ' + msg.error);
    } else {
      showToast(n ? `✅ ${n} টি · ${scanned} ফোল্ডার` : `😕 পাওয়া যায়নি (${scanned} ফোল্ডার)`);
    }
    return;
  }

  if (msg.action === 'bulkSearchProgress' || msg.action === 'bulkSearchDone') {
    applyBulkSearchStatus(msg);
    if (msg.action === 'bulkSearchDone') {
      const found = msg.found || 0;
      const total = msg.total || 0;
      if (msg.stopped) {
        showToast(`⏹ বন্ধ — ${found} টি পাওয়া গেছে`);
      } else {
        showToast(found ? `✅ ${found}/${total} সার্ভারে পাওয়া গেছে` : `😕 ${total} সার্ভারে পাওয়া যায়নি`);
      }
    }
  }

  if (msg.action === 'ftpProgress' || msg.action === 'ftpScanDone') {
    ftpResultsCache = msg.results || {};
    updateFtpUI(msg.scanning, msg.done || 0, msg.total || 0);
    renderFtpList();
    updateBulkWorkingHint();
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
// M3U UPLOAD & DOWNLOAD
// ===========================
let m3uEntries = [];
let m3uSourceName = '';
let m3uCurrentFilter = 'ALL';
let m3uChecking = false;

function isM3uFile(file) {
  if (!file) return false;
  const n = (file.name || '').toLowerCase();
  return n.endsWith('.m3u') || n.endsWith('.m3u8') ||
    file.type === 'audio/x-mpegurl' || file.type === 'application/vnd.apple.mpegurl';
}

function titleFromM3uUrl(url) {
  try {
    const parts = safeDecode(new URL(url).pathname).split('/').filter(Boolean);
    return parts[parts.length - 1] || url;
  } catch {
    return url.split('/').pop() || url;
  }
}

function parseM3uContent(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let pendingTitle = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '#EXTM3U') continue;

    if (trimmed.startsWith('#EXTINF:')) {
      const m = trimmed.match(/#EXTINF:-?\d*,\s*(.*)/i);
      pendingTitle = m ? m[1].trim() : '';
      continue;
    }
    if (trimmed.startsWith('#')) continue;

    if (/^https?:\/\//i.test(trimmed)) {
      entries.push({
        url: trimmed,
        title: pendingTitle || titleFromM3uUrl(trimmed),
        status: 'pending'
      });
      pendingTitle = '';
    }
  }
  return entries;
}

/** Background এ HEAD + Range GET দিয়ে লিংক ডাউনলোডযোগ্য কিনা যাচাই */
function checkM3uLink(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'checkMediaLink', url }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        resolve({ working: false, method: '', detail: 'check failed' });
        return;
      }
      resolve(resp);
    });
  });
}

function getFilteredM3u() {
  if (m3uCurrentFilter === 'WORKING') return m3uEntries.filter(e => e.status === 'working');
  if (m3uCurrentFilter === 'DEAD') return m3uEntries.filter(e => e.status === 'dead');
  return m3uEntries;
}

function updateM3uBottomBar() {
  const bar = document.getElementById('m3uBottomBar');
  const working = m3uEntries.filter(e => e.status === 'working');
  if (bar) bar.classList.toggle('visible', m3uEntries.length > 0);
  const dlAll = document.getElementById('m3uDownloadAllBtn');
  if (dlAll) dlAll.disabled = working.length === 0;
  const badge = document.getElementById('m3uResultBadge');
  if (badge) badge.textContent = `${working.length} working / ${m3uEntries.length}`;
}

function showM3uDownloadReady() {
  m3uEntries.forEach(e => {
    e.status = 'working';
    e.checkMethod = '';
    e.checkDetail = '';
  });
  const filterBar = document.getElementById('m3uFilterBar');
  if (filterBar) filterBar.style.display = 'flex';
  renderM3uList();
  updateM3uBottomBar();
}

function renderM3uList() {
  const list = document.getElementById('m3uList');
  const filterBar = document.getElementById('m3uFilterBar');
  const filtered = getFilteredM3u();

  if (!m3uEntries.length) {
    if (filterBar) filterBar.style.display = 'none';
    document.getElementById('m3uBottomBar')?.classList.remove('visible');
    list.innerHTML = `<div class="state-msg"><div class="state-icon">📥</div><div class="state-title">M3U আপলোড করুন</div><div class="state-sub">আপলোডের পর লিংক চেক করে ডাউনলোড দেখাবে</div></div>`;
    return;
  }

  if (filterBar && m3uEntries.length) filterBar.style.display = 'flex';
  updateM3uBottomBar();

  if (!filtered.length) {
    list.innerHTML = `<div class="state-msg"><div class="state-icon">🔍</div><div class="state-title">এই ফিল্টারে কিছু নেই</div></div>`;
    return;
  }

  function statusLabel(entry) {
    if (entry.status === 'working') return entry.checking ? '✅ OK' : '✅ ডাউনলোড';
    if (entry.status === 'dead') return `❌ নেই${entry.checkDetail ? ' ' + entry.checkDetail : ''}`;
    if (entry.status === 'checking') return '🔄...';
    return '⏳';
  }

  list.innerHTML = '';
  filtered.forEach((entry) => {
    const card = document.createElement('div');
    card.className = `m3u-card status-${entry.status}`;
    const safeTitle = escAttr(entry.title);
    const safeUrl = escAttr(entry.url);
    card.innerHTML = `
      <div class="m3u-card-top">
        <span class="m3u-card-title" title="${safeTitle}">${entry.title}</span>
        <span class="m3u-card-status ${entry.status}">${statusLabel(entry)}</span>
      </div>
      <div class="m3u-card-url" title="${safeUrl}">${entry.url}</div>
      <div class="m3u-card-actions">
        <button type="button" class="btn-m3u-dl" ${entry.status === 'working' ? '' : 'disabled'}>⬇ ডাউনলোড</button>
        <button type="button" class="btn-m3u-copy" data-url="${safeUrl}">📋 কপি</button>
      </div>`;

    const realEntry = entry;
    card.querySelector('.btn-m3u-dl')?.addEventListener('click', () => {
      if (realEntry.status === 'working') downloadM3uEntry(realEntry);
    });
    card.querySelector('.btn-m3u-copy')?.addEventListener('click', (e) => {
      navigator.clipboard.writeText(e.currentTarget.dataset.url);
      showToast('✅ URL কপি হয়েছে');
    });
    list.appendChild(card);
  });
}

function downloadM3uEntry(entry) {
  let filename = sanitizeFilename(entry.title || titleFromM3uUrl(entry.url));
  if (!/\.\w{2,5}$/.test(filename)) {
    const ext = entry.url.split('?')[0].split('.').pop();
    if (ext && ext.length <= 5) filename += '.' + ext;
  }
  chrome.downloads.download({ url: entry.url, filename, saveAs: false });
  showToast('⬇ ডাউনলোড শুরু...');
}

async function checkAllM3uLinks() {
  if (!m3uEntries.length || m3uChecking) return;

  m3uChecking = true;
  const btn = document.getElementById('m3uCheckBtn');
  if (btn) btn.disabled = true;

  const batchSize = 24;
  for (let i = 0; i < m3uEntries.length; i += batchSize) {
    const batch = m3uEntries.slice(i, i + batchSize);
    batch.forEach(e => { e.checking = true; });

    await Promise.all(batch.map(async (entry) => {
      const result = await checkM3uLink(entry.url);
      entry.checking = false;
      if (!result.working) {
        entry.status = 'dead';
        entry.checkMethod = result.method || '';
        entry.checkDetail = result.detail || '';
      } else {
        entry.status = 'working';
      }
    }));
    renderM3uList();
    updateM3uBottomBar();
  }

  m3uChecking = false;
  if (btn) { btn.disabled = false; btn.textContent = '🔍 লিংক চেক'; }
  const working = m3uEntries.filter(e => e.status === 'working').length;
  const dead = m3uEntries.length - working;
  if (dead > 0) showToast(`✅ ${working} OK · ${dead} নেই`);
  renderM3uList();
}

function handleM3uFile(file) {
  if (!isM3uFile(file)) {
    showToast('⚠️ শুধু .m3u ফাইল সাপোর্টেড');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result;
    if (typeof text !== 'string') {
      showToast('⚠️ ফাইল পড়া যায়নি');
      return;
    }
    m3uEntries = parseM3uContent(text);
    m3uSourceName = file.name;
    m3uCurrentFilter = 'ALL';

    document.getElementById('m3uFileInfo').style.display = 'flex';
    document.getElementById('m3uFileName').textContent = `${file.name} — ${m3uEntries.length} লিংক`;
    document.querySelectorAll('.m3u-filter-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.m3uFilter === 'ALL');
    });

    if (!m3uEntries.length) {
      showToast('⚠️ M3U-তে কোনো http লিংক নেই');
      renderM3uList();
      return;
    }

    showM3uDownloadReady();
    showToast(`✅ ${m3uEntries.length} টি — ডাউনলোড ready`);
    checkAllM3uLinks();
  };
  reader.onerror = () => showToast('⚠️ ফাইল পড়া যায়নি');
  reader.readAsText(file);
}

function initM3uPanel() {
  const zone = document.getElementById('m3uDropZone');
  const input = document.getElementById('m3uFileInput');
  const chooseBtn = document.getElementById('m3uChooseBtn');

  chooseBtn?.addEventListener('click', () => input?.click());

  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) handleM3uFile(file);
    input.value = '';
  });

  zone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone?.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleM3uFile(file);
  });

  document.getElementById('m3uCheckBtn')?.addEventListener('click', checkAllM3uLinks);

  document.querySelectorAll('.m3u-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.m3u-filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      m3uCurrentFilter = tab.dataset.m3uFilter;
      renderM3uList();
    });
  });

  document.getElementById('m3uDownloadAllBtn')?.addEventListener('click', () => {
    const working = m3uEntries.filter(e => e.status === 'working');
    if (!working.length) { showToast('কোনো working লিংক নেই'); return; }
    working.forEach((entry, i) => downloadM3uEntry(entry));
    showToast(`⬇ ${working.length} টি ডাউনলোড শুরু...`);
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
  document.getElementById('tabM3uBtn').addEventListener('click', () => switchMainTab('m3u'));

  initM3uPanel();

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
  document.getElementById('bulkFtpToggle')?.addEventListener('change', updateBulkWorkingHint);
  initFtpSearchPanel();

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
