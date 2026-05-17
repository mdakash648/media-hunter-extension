// Media Hunter - Content Script
// Page এর HTML স্ক্যান করে সব media URL বের করে

const MEDIA_EXTENSIONS = [
  // Video
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg',
  '3gp', 'ogv', 'ts', 'm3u8', 'm3u', 'f4v', 'rmvb', 'rm', 'asf', 'divx',
  // Audio
  'mp3', 'aac', 'ogg', 'wav', 'flac', 'm4a', 'wma', 'opus', 'aiff', 'mid',
  'midi', 'ra', 'mka', 'ac3',
  // Other media
  'swf', 'vob'
];

const MEDIA_MIME_TYPES = [
  'video/', 'audio/', 'application/x-mpegURL', 'application/vnd.apple.mpegurl',
  'application/octet-stream', 'application/x-matroska'
];

function getExtension(url) {
  try {
    const clean = url.split('?')[0].split('#')[0];
    const parts = clean.split('.');
    if (parts.length > 1) {
      return parts[parts.length - 1].toLowerCase();
    }
  } catch (e) {}
  return '';
}

function isMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return MEDIA_MIME_TYPES.some(m => url.includes(m));
  }
  const ext = getExtension(url);
  return MEDIA_EXTENSIONS.includes(ext);
}

function getTypeLabel(url) {
  const ext = getExtension(url);
  const videoExts = ['mp4','mkv','avi','mov','wmv','flv','webm','m4v','mpg','mpeg','3gp','ogv','ts','m3u8','m3u','f4v','rmvb','rm','asf','divx','vob'];
  const audioExts = ['mp3','aac','ogg','wav','flac','m4a','wma','opus','aiff','mid','midi','ra','mka','ac3'];
  if (videoExts.includes(ext)) return 'VIDEO';
  if (audioExts.includes(ext)) return 'AUDIO';
  return 'MEDIA';
}

// URL এর শেষ অংশ থেকে filename বের করে title হিসেবে ব্যবহার করা হয়
function guessTitle(url) {
  try {
    // URL decode করে শেষ path segment নাও (query/hash বাদ দিয়ে)
    const clean = url.split('?')[0].split('#')[0];
    const parts = clean.split('/');
    let filename = parts[parts.length - 1];
    if (!filename || filename.length < 2) {
      // শেষটা খালি হলে আগেরটা নাও
      filename = parts[parts.length - 2] || '';
    }
    // URL percent-encoding decode
    filename = decodeURIComponent(filename).trim();
    if (filename.length > 1) return filename;
  } catch (e) {
    // decode ব্যর্থ হলে raw নাও
    try {
      const clean = url.split('?')[0].split('#')[0];
      const parts = clean.split('/');
      const filename = parts[parts.length - 1];
      if (filename && filename.length > 1) return filename;
    } catch (e2) {}
  }
  return url; // সবকিছু ব্যর্থ হলে পুরো URL
}

function scanPage() {
  const found = new Map(); // URL -> info

  function addUrl(url, source) {
    if (!url || url.length < 5) return;
    try {
      // Resolve relative URLs
      const absolute = new URL(url, window.location.href).href;
      if (isMediaUrl(absolute) && !found.has(absolute)) {
        const ext = getExtension(absolute) || '?';
        const title = guessTitle(absolute);
        found.set(absolute, {
          url: absolute,
          ext: ext.toUpperCase(),
          type: getTypeLabel(absolute),
          source: source,
          title: title
        });
      }
    } catch (e) {}
  }

  // 1. <video> tags
  document.querySelectorAll('video').forEach(el => {
    if (el.src) addUrl(el.src, 'video tag');
    el.querySelectorAll('source').forEach(s => addUrl(s.src, 'video>source'));
  });

  // 2. <audio> tags
  document.querySelectorAll('audio').forEach(el => {
    if (el.src) addUrl(el.src, 'audio tag');
    el.querySelectorAll('source').forEach(s => addUrl(s.src, 'audio>source'));
  });

  // 3. <source> tags globally
  document.querySelectorAll('source').forEach(el => {
    if (el.src) addUrl(el.src, 'source tag');
  });

  // 4. <a href> links
  document.querySelectorAll('a[href]').forEach(el => {
    addUrl(el.href, 'link');
  });

  // 5. <iframe src>
  document.querySelectorAll('iframe[src]').forEach(el => {
    addUrl(el.src, 'iframe');
  });

  // 6. All attributes scan - data-src, data-url, data-video, etc.
  const dataAttrs = ['src', 'data-src', 'data-url', 'data-video', 'data-audio',
    'data-file', 'data-media', 'data-stream', 'data-mp4', 'data-mp3',
    'data-source', 'data-href', 'content'];
  document.querySelectorAll('*').forEach(el => {
    dataAttrs.forEach(attr => {
      const val = el.getAttribute(attr);
      if (val) addUrl(val, attr);
    });
  });

  // 7. Scan all inline scripts for URLs
  const urlRegex = /https?:\/\/[^\s"'<>(){}[\]\\,]+/gi;
  document.querySelectorAll('script:not([src])').forEach(script => {
    const matches = script.textContent.match(urlRegex) || [];
    matches.forEach(u => addUrl(u.replace(/[,;)\]}"']+$/, ''), 'script'));
  });

  // 8. Scan page HTML as text
  const htmlText = document.documentElement.outerHTML;
  const htmlMatches = htmlText.match(urlRegex) || [];
  htmlMatches.forEach(u => {
    const clean = u.replace(/[,;)\]}"'\\]+$/, '');
    addUrl(clean, 'html');
  });

  // 9. JSON-LD / meta tags
  document.querySelectorAll('meta[content]').forEach(el => {
    addUrl(el.getAttribute('content'), 'meta');
  });

  return Array.from(found.values());
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanMedia') {
    const results = scanPage();
    sendResponse({ results });
  }
  return true;
});
