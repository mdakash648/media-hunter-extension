// Media Hunter - Content Script
// Runs on every page, collects media URLs via message passing

const VIDEO_EXT = ['mp4','mkv','avi','mov','webm','flv','wmv','m4v','3gp','ts','m2ts','vob','ogv','rm','rmvb','asf','divx','xvid'];
const AUDIO_EXT = ['mp3','aac','ogg','wav','flac','m4a','wma','opus','aiff','alac','ac3','dts'];
const MEDIA_EXT = ['m3u8','m3u','mpd','f4v','f4a'];
const ALL_EXT = [...VIDEO_EXT, ...AUDIO_EXT, ...MEDIA_EXT];

function isMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.split('?')[0].toLowerCase();
  const ext = clean.split('.').pop();
  return ALL_EXT.includes(ext) || url.includes('.m3u8') || url.includes('manifest.mpd');
}

function collectMediaUrls() {
  const urls = new Set();
  const urlRegex = /https?:\/\/[^\s"'<>(){}[\]\\]+/gi;

  // video/audio tags
  document.querySelectorAll('video, audio').forEach(el => {
    if (el.src && isMediaUrl(el.src)) urls.add(el.src);
    if (el.currentSrc && isMediaUrl(el.currentSrc)) urls.add(el.currentSrc);
  });

  // source tags
  document.querySelectorAll('source').forEach(el => {
    if (el.src && isMediaUrl(el.src)) urls.add(el.src);
  });

  // anchor tags
  document.querySelectorAll('a[href]').forEach(el => {
    if (el.href && isMediaUrl(el.href)) urls.add(el.href);
  });

  // data attributes
  const dataAttrs = ['data-src','data-url','data-video','data-source','data-file'];
  document.querySelectorAll('*').forEach(el => {
    dataAttrs.forEach(attr => {
      const val = el.getAttribute(attr);
      if (val && isMediaUrl(val)) urls.add(val);
    });
  });

  // inline scripts
  document.querySelectorAll('script:not([src])').forEach(el => {
    const matches = el.textContent.match(urlRegex) || [];
    matches.forEach(u => { if (isMediaUrl(u)) urls.add(u); });
  });

  // full HTML scan
  const allMatches = document.documentElement.innerHTML.match(urlRegex) || [];
  allMatches.forEach(u => { if (isMediaUrl(u)) urls.add(u); });

  return [...urls];
}

chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scanMedia') {
    sendResponse({ urls: collectMediaUrls() });
  }
  return true;
});
