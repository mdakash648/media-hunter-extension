// ===========================
// MAIN TAB SWITCHING
// ===========================
function switchMainTab(tab) {
  document.getElementById('panelMedia').classList.toggle('active', tab === 'media');
  document.getElementById('panelFtp').classList.toggle('active', tab === 'ftp');
  document.getElementById('tabMediaBtn').classList.toggle('active', tab === 'media');
  document.getElementById('tabFtpBtn').classList.toggle('active', tab === 'ftp');
  if (tab === 'ftp') initFtpPanel();
}

// ===========================
// TOAST
// ===========================
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ===========================
// MEDIA HUNTER
// ===========================
const VIDEO_EXT = ['mp4','mkv','avi','mov','webm','flv','wmv','m4v','3gp','ts','m2ts','vob','ogv','rm','rmvb','asf','divx','xvid'];
const AUDIO_EXT = ['mp3','aac','ogg','wav','flac','m4a','wma','opus','aiff','alac','ac3','dts'];
const MEDIA_EXT = ['m3u8','m3u','mpd','f4v','f4a'];

let allResults = [];
let currentFilter = 'ALL';

function getType(url) {
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  if (VIDEO_EXT.includes(ext)) return 'VIDEO';
  if (AUDIO_EXT.includes(ext)) return 'AUDIO';
  if (MEDIA_EXT.includes(ext)) return 'MEDIA';
  return 'MEDIA';
}

function scanPage() {
  const VIDEO_EXT = ['mp4','mkv','avi','mov','webm','flv','wmv','m4v','3gp','ts','m2ts','vob','ogv','rm','rmvb','asf','divx','xvid'];
  const AUDIO_EXT = ['mp3','aac','ogg','wav','flac','m4a','wma','opus','aiff','alac','ac3','dts'];
  const MEDIA_EXT = ['m3u8','m3u','mpd','f4v','f4a'];
  const ALL_EXT = [...VIDEO_EXT, ...AUDIO_EXT, ...MEDIA_EXT];
  const urls = new Set();
  const urlRegex = /https?:\/\/[^\s"'<>(){}[\]]+/gi;

  function checkUrl(url) {
    if (!url) return;
    url = url.trim().split(/[\s"'<>]/)[0];
    if (!url) return;
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    if (ALL_EXT.includes(ext) || url.includes('.m3u8') || url.includes('manifest')) urls.add(url);
  }

  document.querySelectorAll('video, audio').forEach(el => {
    if (el.src) checkUrl(el.src);
    if (el.currentSrc) checkUrl(el.currentSrc);
  });
  document.querySelectorAll('source').forEach(el => { if (el.src) checkUrl(el.src); });
  document.querySelectorAll('a[href]').forEach(el => { checkUrl(el.href); });
  document.querySelectorAll('[data-src],[data-url],[data-video],[data-source]').forEach(el => {
    ['data-src','data-url','data-video','data-source'].forEach(attr => {
      if (el.getAttribute(attr)) checkUrl(el.getAttribute(attr));
    });
  });
  document.querySelectorAll('script:not([src])').forEach(el => {
    (el.textContent.match(urlRegex) || []).forEach(checkUrl);
  });
  (document.documentElement.innerHTML.match(urlRegex) || []).forEach(checkUrl);
  return [...urls];
}

function renderResults() {
  const filtered = currentFilter === 'ALL' ? allResults : allResults.filter(u => getType(u) === currentFilter);
  let video = 0, audio = 0, other = 0;
  allResults.forEach(u => {
    const t = getType(u);
    if (t === 'VIDEO') video++;
    else if (t === 'AUDIO') audio++;
    else other++;
  });
  document.getElementById('videoCount').textContent = video;
  document.getElementById('audioCount').textContent = audio;
  document.getElementById('mediaCount').textContent = other;
  document.getElementById('totalCount').textContent = 'মোট: ' + allResults.length;
  document.getElementById('filteredCount').textContent = filtered.length + ' টি';
  document.getElementById('statsBar').style.display = 'flex';
  document.getElementById('filterBar').style.display = 'flex';
  document.getElementById('bottomBar').style.display = 'flex';

  const content = document.getElementById('content');
  if (filtered.length === 0) {
    content.innerHTML = `<div class="state-msg"><div class="state-icon">😕</div><div class="state-title">কিছু পাওয়া যায়নি</div><div class="state-sub">এই পেজে কোনো media URL নেই</div></div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'media-list';
  filtered.forEach(url => {
    const type = getType(url);
    const card = document.createElement('div');
    card.className = 'media-card';
    card.innerHTML = `
      <div class="card-top">
        <span class="ext-badge badge-${type}">${type}</span>
        <span class="url-text">${url}</span>
      </div>
      <div class="card-actions">
        <button class="btn-copy" data-url="${url}">📋 কপি</button>
        <button class="btn-download" data-url="${url}">⬇ ডাউনলোড</button>
      </div>`;
    list.appendChild(card);
  });
  content.innerHTML = '';
  content.appendChild(list);

  list.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.url);
      btn.textContent = '✅ কপি হয়েছে';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '📋 কপি'; btn.classList.remove('copied'); }, 1500);
    });
  });
  list.querySelectorAll('.btn-download').forEach(btn => {
    btn.addEventListener('click', () => chrome.tabs.create({ url: btn.dataset.url }));
  });
}

// ===========================
// FTP SCAN — popup side
// Actual scan runs in background.js
// ===========================
let ftpCurrentFilter = 'ALL';
let ftpResultsCache = {};

// Popup খুললে background থেকে current state নাও
function initFtpPanel() {
  chrome.runtime.sendMessage({ action: 'ftpGetStatus' }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      // background কাজ করছে না, storage থেকে লোড করো
      loadFtpFromStorage();
      return;
    }
    ftpResultsCache = resp.results || {};
    updateFtpUI(resp.scanning, resp.done || 0, resp.total || 0);
    renderFtpList();
  });
}

function loadFtpFromStorage() {
  chrome.runtime.sendMessage({ action: 'ftpLoadSaved' }, (resp) => {
    if (resp && resp.data) {
      ftpResultsCache = resp.data.results || {};
      if (resp.data.lastScan) {
        const d = new Date(resp.data.lastScan);
        document.getElementById('ftpLastScan').innerHTML =
          `শেষ স্ক্যান: <span>${d.toLocaleDateString('bn-BD')} ${d.toLocaleTimeString('bn-BD')}</span>`;
      }
      renderFtpList();
    }
  });
}

// Background থেকে live update শোনা
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

  // Scanning চলাকালীন badge দেখাও
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
document.addEventListener('DOMContentLoaded', () => {

  // Main tabs
  document.getElementById('tabMediaBtn').addEventListener('click', () => switchMainTab('media'));
  document.getElementById('tabFtpBtn').addEventListener('click', () => switchMainTab('ftp'));

  // --- Media Hunter ---
  document.getElementById('scanBtn').addEventListener('click', async () => {
    const btn = document.getElementById('scanBtn');
    btn.disabled = true;
    btn.textContent = '⏳ স্ক্যান চলছে...';
    document.getElementById('content').innerHTML = `<div class="state-msg"><div class="spinner"></div><div class="state-title">স্ক্যান চলছে...</div></div>`;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      document.getElementById('pageTitle').textContent = (tab.title || '').substring(0, 40) + '...';
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanPage });
      allResults = results[0].result || [];
      renderResults();
    } catch (e) {
      document.getElementById('content').innerHTML = `<div class="state-msg"><div class="state-icon">⚠️</div><div class="state-title">স্ক্যান ব্যর্থ হয়েছে</div><div class="state-sub">${e.message}</div></div>`;
    }
    btn.disabled = false;
    btn.textContent = '⚡ স্ক্যান';
  });

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      if (allResults.length > 0) renderResults();
    });
  });

  document.getElementById('copyAllBtn').addEventListener('click', () => {
    const filtered = currentFilter === 'ALL' ? allResults : allResults.filter(u => getType(u) === currentFilter);
    navigator.clipboard.writeText(filtered.join('\n'));
    showToast('✅ সব URL কপি হয়েছে!');
  });

  document.getElementById('playAllVlcBtn').addEventListener('click', () => {
    const filtered = currentFilter === 'ALL' ? allResults : allResults.filter(u => getType(u) === currentFilter);
    if (filtered.length > 0) chrome.tabs.create({ url: filtered[0] });
  });

  // --- FTP Scan ---
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

});
