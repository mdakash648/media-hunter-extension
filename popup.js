// Media Hunter - Popup Script

let allResults = [];
let currentFilter = 'ALL';

const scanBtn = document.getElementById('scanBtn');
const content = document.getElementById('content');
const statsBar = document.getElementById('statsBar');
const filterBar = document.getElementById('filterBar');
const bottomBar = document.getElementById('bottomBar');
const initState = document.getElementById('initState');
const videoCount = document.getElementById('videoCount');
const audioCount = document.getElementById('audioCount');
const mediaCount = document.getElementById('mediaCount');
const totalCount = document.getElementById('totalCount');
const filteredCount = document.getElementById('filteredCount');
const copyAllBtn = document.getElementById('copyAllBtn');
const pageTitle = document.getElementById('pageTitle');
const toast = document.getElementById('toast');

// Toast notification
function showToast(msg, duration = 1800) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// Show loading state
function showLoading() {
  content.innerHTML = `
    <div class="state-msg">
      <div class="spinner"></div>
      <div class="state-title">স্ক্যান চলছে...</div>
      <div class="state-sub">পেজের HTML বিশ্লেষণ করা হচ্ছে</div>
    </div>
  `;
}

// Show empty state
function showEmpty() {
  content.innerHTML = `
    <div class="state-msg">
      <div class="state-icon">😔</div>
      <div class="state-title">কোনো মিডিয়া পাওয়া যায়নি</div>
      <div class="state-sub">এই পেজে কোনো media file এর URL নেই</div>
    </div>
  `;
  statsBar.style.display = 'none';
  filterBar.style.display = 'none';
  bottomBar.style.display = 'none';
}

// Shorten URL for display
function shortenUrl(url, maxLen = 55) {
  if (url.length <= maxLen) return url;
  const start = url.substring(0, 30);
  const end = url.substring(url.length - 18);
  return `${start}...${end}`;
}

// Get filename from URL
function getFilename(url) {
  try {
    const clean = url.split('?')[0].split('#')[0];
    const parts = clean.split('/');
    const name = parts[parts.length - 1];
    return name || 'media_file';
  } catch (e) {
    return 'media_file';
  }
}

// Render media cards
function renderList(results) {
  const filtered = currentFilter === 'ALL'
    ? results
    : results.filter(r => r.type === currentFilter);

  filteredCount.textContent = `${filtered.length} টি`;

  if (filtered.length === 0) {
    const msg = currentFilter === 'ALL' ? 'কোনো ফলাফল নেই' : `কোনো ${currentFilter} ফাইল নেই`;
    content.innerHTML = `
      <div class="state-msg">
        <div class="state-icon">🔍</div>
        <div class="state-title">${msg}</div>
      </div>
    `;
    return;
  }

  const listHtml = filtered.map((item, idx) => `
    <div class="media-card" data-idx="${idx}">
      <div class="card-title-row">
        <span class="ext-badge badge-${item.type}">${item.ext}</span>
        <span class="card-title" title="${escapeAttr(item.title || '')}">${escapeHtml(item.title || 'অজানা মিডিয়া')}</span>
      </div>
      <div class="card-top">
        <span class="url-text" title="${item.url}">${shortenUrl(item.url)}</span>
      </div>
      <div class="card-actions">
        <button class="btn-copy" data-url="${escapeAttr(item.url)}" data-copy-idx="${idx}">
          📋 কপি
        </button>
        <button class="btn-download" data-url="${escapeAttr(item.url)}" data-filename="${escapeAttr(getFilename(item.url))}">
          ⬇️ ডাউনলোড
        </button>
        <button class="btn-play" data-url="${escapeAttr(item.url)}" data-title="${escapeAttr(item.title || '')}">
          ▶ VLC
        </button>
      </div>
    </div>
  `).join('');

  const listWrapper = document.createElement('div');
  listWrapper.className = 'media-list';
  listWrapper.innerHTML = listHtml;
  content.innerHTML = '';
  content.appendChild(listWrapper);

  // Attach events
  listWrapper.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      copyToClipboard(url, btn);
    });
  });

  listWrapper.querySelectorAll('.btn-download').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      downloadMedia(url);
    });
  });

  listWrapper.querySelectorAll('.btn-play').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      const title = btn.getAttribute('data-title') || 'media';
      openInVLC(url, title);
    });
  });
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Copy URL to clipboard
async function copyToClipboard(url, btn) {
  try {
    await navigator.clipboard.writeText(url);
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ কপি হয়েছে!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.classList.remove('copied');
      }, 1500);
    }
    showToast('✅ URL কপি হয়েছে!');
  } catch (e) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('✅ URL কপি হয়েছে!');
  }
}

// Download: open new tab with URL (browser will auto-download or show)
function downloadMedia(url) {
  chrome.tabs.create({ url: url, active: true });
  showToast('⬇️ নতুন ট্যাবে ডাউনলোড শুরু হচ্ছে...');
}

// VLC তে open করা — .m3u playlist file বানিয়ে download করানো হয়
// <a download> ব্যবহার করলে browser নিজেই সঠিক filename দেয়
function openInVLC(url, title) {
  // M3U playlist content তৈরি
  const m3uContent = [
    '#EXTM3U',
    '#EXTINF:-1,' + (title || 'Media'),
    url
  ].join('\n');

  // filename: title থেকে extension বাদ দিয়ে .m3u লাগানো
  // যেমন: "Il sorpasso (1962) Italian 1080p WEB-DL x264.mkv" → "Il sorpasso (1962) Italian 1080p WEB-DL x264.m3u"
  let baseName = (title || 'vlc_stream').trim();
  // শেষে .mkv/.mp4 etc থাকলে সেটা সরিয়ে .m3u লাগানো
  baseName = baseName.replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|3gp|ts|mp3|aac|ogg|wav|flac|m4a)$/i, '');
  // illegal filesystem characters সরানো (Windows safe)
  baseName = baseName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().substring(0, 180);
  const filename = baseName + '.m3u';

  // <a download> trick — browser এই ক্ষেত্রে filename সঠিকভাবে রাখে
  const blob = new Blob([m3uContent], { type: 'audio/x-mpegurl' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
  showToast('▶ VLC তে খুলছে: ' + filename);
}

// Fallback: vlc:// protocol দিয়ে চেষ্টা
function openInVLCFallback(url) {
  // vlc:// scheme — VLC installed থাকলে কাজ করে কিছু OS এ
  const vlcUrl = 'vlc://' + url.replace(/^https?:\/\//, '');
  chrome.tabs.create({ url: vlcUrl, active: false });
  showToast('▶ VLC Protocol দিয়ে চেষ্টা করছে...');
}

// Copy all filtered URLs
copyAllBtn.addEventListener('click', async () => {
  const filtered = currentFilter === 'ALL'
    ? allResults
    : allResults.filter(r => r.type === currentFilter);

  if (filtered.length === 0) {
    showToast('কোনো URL নেই!');
    return;
  }

  const text = filtered.map(r => r.url).join('\n');
  await copyToClipboard(text, null);
  showToast(`✅ ${filtered.length} টি URL কপি হয়েছে!`);
});

// Filter tabs
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.getAttribute('data-filter');
    renderList(allResults);
  });
});

// Main scan action
scanBtn.addEventListener('click', async () => {
  scanBtn.disabled = true;
  scanBtn.textContent = '⏳ স্ক্যান...';
  showLoading();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Update page title
    if (tab.title) {
      pageTitle.textContent = tab.title.substring(0, 45) + (tab.title.length > 45 ? '...' : '');
    }

    // Inject content script if needed and send message
    let results = [];
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'scanMedia' });
      results = response?.results || [];
    } catch (err) {
      // Content script may not be injected, inject manually
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      // Small delay then retry
      await new Promise(r => setTimeout(r, 300));
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'scanMedia' });
      results = response?.results || [];
    }

    allResults = results;

    if (results.length === 0) {
      showEmpty();
    } else {
      // Update stats
      const vCount = results.filter(r => r.type === 'VIDEO').length;
      const aCount = results.filter(r => r.type === 'AUDIO').length;
      const mCount = results.filter(r => r.type === 'MEDIA').length;

      videoCount.textContent = vCount;
      audioCount.textContent = aCount;
      mediaCount.textContent = mCount;
      totalCount.textContent = `মোট: ${results.length}`;

      statsBar.style.display = 'flex';
      filterBar.style.display = 'flex';
      bottomBar.style.display = 'flex';

      renderList(results);
    }

  } catch (err) {
    content.innerHTML = `
      <div class="state-msg">
        <div class="state-icon">⚠️</div>
        <div class="state-title">স্ক্যান ব্যর্থ হয়েছে</div>
        <div class="state-sub">${err.message || 'অজানা সমস্যা'}</div>
      </div>
    `;
  }

  scanBtn.disabled = false;
  scanBtn.textContent = '⚡ আবার স্ক্যান';
});

// Popup খুলতেই auto scan শুরু
document.addEventListener('DOMContentLoaded', () => {
  scanBtn.click();
});
