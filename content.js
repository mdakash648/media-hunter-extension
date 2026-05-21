// Media Hunter - Content Script
// Media URL scan + FTP page search

const VIDEO_EXTS = ['mp4','mkv','avi','mov','webm','wmv','flv','m4v','3gp','ts','m2ts','vob','ogv','rm','rmvb','asf','divx','xvid'];
const AUDIO_EXTS = ['mp3','aac','ogg','wav','flac','m4a','wma','opus','aiff','alac','ac3','dts'];
const MEDIA_EXTS = ['m3u8','m3u','mpd','f4v','f4a'];
const ALL_EXT = [...VIDEO_EXTS, ...AUDIO_EXTS, ...MEDIA_EXTS];

function classifyUrl(url) {
  const lower = url.toLowerCase().split('?')[0];
  const ext = lower.split('.').pop();
  if (VIDEO_EXTS.includes(ext)) return 'VIDEO';
  if (AUDIO_EXTS.includes(ext)) return 'AUDIO';
  if (MEDIA_EXTS.includes(ext) || url.includes('.m3u8') || url.includes('manifest.mpd')) return 'MEDIA';
  return null;
}

function extractFilename(url) {
  try {
    const path = new URL(url).pathname;
    const name = path.split('/').pop();
    return decodeURIComponent(name) || url;
  } catch { return url; }
}

function isMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return classifyUrl(url) !== null;
}

function scanPageForMedia() {
  const found = new Map();
  const urlRegex = /https?:\/\/[^\s"'<>(){}[\]\\]+/gi;

  const add = (url) => {
    if (!url || url.length < 8) return;
    try { url = new URL(url, location.href).href; } catch { return; }
    const type = classifyUrl(url);
    if (type && !found.has(url)) {
      found.set(url, { url, type, name: extractFilename(url) });
    }
  };

  document.querySelectorAll('video, audio').forEach(el => {
    if (el.src) add(el.src);
    if (el.currentSrc) add(el.currentSrc);
    el.querySelectorAll('source').forEach(s => add(s.src));
  });
  document.querySelectorAll('source').forEach(s => add(s.src));
  document.querySelectorAll('a[href]').forEach(a => add(a.href));
  document.querySelectorAll('[data-src],[data-url],[data-video],[data-source],[data-file]').forEach(el => {
    ['data-src','data-url','data-video','data-source','data-file'].forEach(attr => {
      if (el.getAttribute(attr)) add(el.getAttribute(attr));
    });
  });
  document.querySelectorAll('script:not([src])').forEach(el => {
    (el.textContent.match(urlRegex) || []).forEach(u => { if (isMediaUrl(u)) add(u); });
  });
  (document.documentElement.innerHTML.match(urlRegex) || []).forEach(u => { if (isMediaUrl(u)) add(u); });

  return Array.from(found.values());
}

function searchInPage(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results = [];
  const seen = new Set();

  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href;
    const rawText = (a.textContent || '').trim();
    const text = decodeURIComponent(rawText);
    const hrefDecoded = decodeURIComponent(href);

    if (!href || href.startsWith('javascript') || !rawText) return;

    const searchIn = (text + ' ' + hrefDecoded).toLowerCase();
    if (searchIn.includes(q) && !seen.has(href)) {
      seen.add(href);
      const isFile = /\.(mp4|mkv|avi|mov|webm|mp3|flac|m4v|zip|rar|srt|ass|sub)$/i.test(href);
      const isFolder = href.endsWith('/') || !href.split('/').pop().includes('.');
      results.push({
        url: href,
        text: text,
        isFile,
        isFolder,
        type: isFile ? (classifyUrl(href) || 'FILE') : 'FOLDER'
      });
    }
  });

  return results;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scanMedia') {
    sendResponse({ results: scanPageForMedia(), url: location.href, title: document.title });
  } else if (msg.action === 'searchFtp') {
    sendResponse({ results: searchInPage(msg.query), pageUrl: location.href, pageTitle: document.title });
  }
  return true;
});
