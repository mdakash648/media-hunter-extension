// Media Hunter - Content Script
// Media URL scan + FTP deep folder search

const VIDEO_EXTS = ['mp4','mkv','avi','mov','webm','wmv','flv','m4v','3gp','ts','m2ts','vob','ogv','rm','rmvb','asf','divx','xvid'];
const AUDIO_EXTS = ['mp3','aac','ogg','wav','flac','m4a','wma','opus','aiff','alac','ac3','dts'];
const MEDIA_EXTS = ['m3u8','m3u','mpd','f4v','f4a'];
const ALL_EXT = [...VIDEO_EXTS, ...AUDIO_EXTS, ...MEDIA_EXTS];

const FILE_EXT_RE = /\.(mp4|mkv|avi|mov|webm|mp3|flac|m4v|zip|rar|7z|iso|srt|ass|sub|wmv|ts|m2ts|mpg|mpeg)$/i;

const DEEP_SEARCH = {
  maxDepth: 10,
  maxFolders: 150,
  maxConcurrent: 6,
  fetchTimeoutMs: 15000,
  maxResults: 300
};

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

function normalizeDirUrl(url) {
  try {
    const u = new URL(url);
    if (!u.pathname.endsWith('/')) {
      const last = u.pathname.split('/').pop() || '';
      if (last.includes('.') && !last.endsWith('/')) {
        u.pathname = u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
      } else {
        u.pathname += '/';
      }
    }
    return u.href;
  } catch {
    return url;
  }
}

function isUnderRoot(href, rootUrl) {
  try {
    const u = new URL(href, rootUrl);
    const root = new URL(rootUrl);
    return u.origin === root.origin && u.pathname.startsWith(root.pathname);
  } catch {
    return false;
  }
}

function isParentLink(href, text) {
  const t = (text || '').toLowerCase();
  if (/parent|\.\.\/|up to/i.test(t)) return true;
  try {
    const path = new URL(href).pathname;
    return path.endsWith('/../') || path.includes('/..');
  } catch {
    return false;
  }
}

function isFolderLink(href) {
  try {
    const u = new URL(href);
    if (u.pathname.endsWith('/')) return true;
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    if (!last) return true;
    if (/^index\.(html?|php|asp|jsp)$/i.test(last)) return false;
    if (FILE_EXT_RE.test(last)) return false;
    return !last.includes('.');
  } catch {
    return false;
  }
}

function matchesQuery(text, href, q) {
  const searchIn = (text + ' ' + decodeURIComponent(href)).toLowerCase();
  return searchIn.includes(q);
}

function makeSearchResult(href, text, depth) {
  const isFile = FILE_EXT_RE.test(href);
  const isFolder = isFolderLink(href);
  return {
    url: href,
    text,
    isFile,
    isFolder,
    type: isFile ? (classifyUrl(href) || 'FILE') : 'FOLDER',
    depth
  };
}

function reportSearchProgress(data) {
  try {
    chrome.runtime.sendMessage({ action: 'ftpSearchProgress', ...data });
  } catch { /* popup closed */ }
}

async function fetchFolderHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEP_SEARCH.fetchTimeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow'
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

function collectLinksFromHtml(html, baseUrl, q, rootUrl, depth, results, seenResults, queue, visitedFolders) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('a[href]').forEach(a => {
    const rawHref = a.getAttribute('href');
    if (!rawHref) return;

    let href;
    try {
      href = new URL(rawHref, baseUrl).href;
    } catch {
      return;
    }

    const rawText = (a.textContent || '').trim();
    if (!rawText || href.startsWith('javascript') || href.startsWith('mailto:')) return;
    if (!isUnderRoot(href, rootUrl)) return;
    if (isParentLink(href, rawText)) return;

    const text = decodeURIComponent(rawText);
    const hrefDecoded = decodeURIComponent(href);

    if (matchesQuery(text, hrefDecoded, q) && !seenResults.has(href)) {
      seenResults.add(href);
      results.push(makeSearchResult(href, text, depth));
    }

    if (isFolderLink(href)) {
      const folderUrl = normalizeDirUrl(href);
      if (!visitedFolders.has(folderUrl) && depth + 1 <= DEEP_SEARCH.maxDepth) {
        visitedFolders.add(folderUrl);
        queue.push({ url: folderUrl, depth: depth + 1 });
      }
    }
  });
}

function collectLinksFromCurrentDocument(q, rootUrl, depth, results, seenResults, queue, visitedFolders) {
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href;
    const rawText = (a.textContent || '').trim();
    if (!href || !rawText || href.startsWith('javascript')) return;
    if (!isUnderRoot(href, rootUrl)) return;
    if (isParentLink(href, rawText)) return;

    const text = decodeURIComponent(rawText);
    const hrefDecoded = decodeURIComponent(href);

    if (matchesQuery(text, hrefDecoded, q) && !seenResults.has(href)) {
      seenResults.add(href);
      results.push(makeSearchResult(href, text, depth));
    }

    if (isFolderLink(href)) {
      const folderUrl = normalizeDirUrl(href);
      if (!visitedFolders.has(folderUrl) && depth + 1 <= DEEP_SEARCH.maxDepth) {
        visitedFolders.add(folderUrl);
        queue.push({ url: folderUrl, depth: depth + 1 });
      }
    }
  });
}

async function scanOneFolder({ url, depth }, rootUrl, q, results, seenResults, queue, visitedFolders) {
  const isCurrentPage = url === location.href || url === normalizeDirUrl(location.href);

  if (isCurrentPage) {
    collectLinksFromCurrentDocument(q, rootUrl, depth, results, seenResults, queue, visitedFolders);
    return;
  }

  try {
    const html = await fetchFolderHtml(url);
    collectLinksFromHtml(html, url, q, rootUrl, depth, results, seenResults, queue, visitedFolders);
  } catch {
    // skip unreachable folder
  }
}

async function deepSearchFtp(query) {
  const q = query.toLowerCase().trim();
  if (!q) return { results: [], scannedFolders: 0, rootUrl: location.href };

  const rootUrl = normalizeDirUrl(location.href);
  const results = [];
  const seenResults = new Set();
  const visitedFolders = new Set();
  const queue = [{ url: rootUrl, depth: 0 }];
  visitedFolders.add(rootUrl);

  let foldersScanned = 0;

  reportSearchProgress({ foldersScanned: 0, queueLen: 1, resultsCount: 0, current: rootUrl });

  while (
    queue.length > 0 &&
    foldersScanned < DEEP_SEARCH.maxFolders &&
    results.length < DEEP_SEARCH.maxResults
  ) {
    const batch = [];
    while (
      batch.length < DEEP_SEARCH.maxConcurrent &&
      queue.length > 0 &&
      foldersScanned + batch.length < DEEP_SEARCH.maxFolders
    ) {
      batch.push(queue.shift());
    }
    if (!batch.length) break;

    await Promise.all(
      batch.map(item =>
        scanOneFolder(item, rootUrl, q, results, seenResults, queue, visitedFolders)
      )
    );

    foldersScanned += batch.length;
    reportSearchProgress({
      foldersScanned,
      queueLen: queue.length,
      resultsCount: results.length,
      current: batch[batch.length - 1]?.url || rootUrl
    });
  }

  results.sort((a, b) => (a.depth || 0) - (b.depth || 0));

  return {
    results,
    scannedFolders: foldersScanned,
    rootUrl,
    deep: true
  };
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

    if (matchesQuery(text, hrefDecoded, q) && !seen.has(href)) {
      seen.add(href);
      results.push(makeSearchResult(href, text, 0));
    }
  });

  return results;
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scanMedia') {
    sendResponse({ results: scanPageForMedia(), url: location.href, title: document.title });
    return true;
  }

  if (msg.action === 'searchFtp') {
    const runDeep = msg.deep !== false;

    if (runDeep) {
      deepSearchFtp(msg.query)
        .then(data => sendResponse(data))
        .catch(err => sendResponse({ results: [], error: err.message, deep: true }));
      return true;
    }

    sendResponse({
      results: searchInPage(msg.query),
      pageUrl: location.href,
      pageTitle: document.title,
      deep: false
    });
    return true;
  }

  return true;
});
