// Media Hunter - Content Script
// Media URL scan + FTP deep folder search

const VIDEO_EXTS = ['mp4','mkv','avi','mov','webm','wmv','flv','m4v','3gp','ts','m2ts','vob','ogv','rm','rmvb','asf','divx','xvid'];
const AUDIO_EXTS = ['mp3','aac','ogg','wav','flac','m4a','wma','opus','aiff','alac','ac3','dts'];
const MEDIA_EXTS = ['m3u8','m3u','mpd','f4v','f4a'];
const ALL_EXT = [...VIDEO_EXTS, ...AUDIO_EXTS, ...MEDIA_EXTS];

const FILE_EXT_RE = /\.(mp4|mkv|avi|mov|webm|mp3|flac|m4v|zip|rar|7z|iso|srt|ass|sub|wmv|ts|m2ts|mpg|mpeg)$/i;

/** 0 = সীমা নেই (Windows search — কোনো folder বাদ নয়) */
const DEEP_SEARCH = {
  maxDepth: 0,
  maxFolders: 0,
  maxConcurrent: 10,
  fetchTimeoutMs: 15000,
  maxResults: 0
};

function deepUnlimited(limit) {
  return limit == null || limit <= 0;
}

function deepUnderLimit(limit, count) {
  return deepUnlimited(limit) || count < limit;
}

function deepCanEnqueueChild(depth) {
  return deepUnlimited(DEEP_SEARCH.maxDepth) || depth + 1 <= DEEP_SEARCH.maxDepth;
}

/** decodeURIComponent safe — invalid % (যেমন 100% বা ভাঙা encoding) এ URI malformed এড়ায় */
function safeDecode(str) {
  if (str == null || str === '') return '';
  try {
    return decodeURIComponent(str);
  } catch {
    try {
      return str.replace(/%(?:[0-9A-Fa-f]{2})+/g, (seq) => {
        try { return decodeURIComponent(seq); } catch { return seq; }
      });
    } catch {
      return str;
    }
  }
}

/** পুরো URL decode না করে শুধু path/search — FTP লিংকে নিরাপদ */
function hrefSearchText(href) {
  try {
    const u = new URL(href);
    const path = safeDecode(u.pathname);
    const search = safeDecode(u.search);
    return `${u.hostname}${path}${search}`;
  } catch {
    return safeDecode(href);
  }
}

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
    return safeDecode(name) || url;
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
  const searchIn = (safeDecode(text) + ' ' + hrefSearchText(href)).toLowerCase();
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

let deepSearchAbort = false;
let deepSearchLiveTimer = null;

function publishDeepSearchProgress(ctx) {
  const payload = {
    action: 'ftpSearchProgress',
    query: ctx.query,
    rootUrl: ctx.rootUrl,
    results: ctx.results.slice(),
    resultsCount: ctx.results.length,
    foldersScanned: ctx.foldersScanned || 0,
    running: ctx.running !== false,
    current: ctx.current || ctx.rootUrl,
    phase: ctx.phase || 'crawl'
  };
  try {
    chrome.runtime.sendMessage(payload);
  } catch { /* popup বন্ধ */ }
  try {
    chrome.storage.local.set({
      ftpDeepSearchData: {
        query: ctx.query,
        rootUrl: ctx.rootUrl,
        results: ctx.results.slice(),
        foldersScanned: ctx.foldersScanned || 0,
        running: ctx.running !== false,
        updatedAt: new Date().toISOString()
      }
    });
  } catch { /* storage */ }
}

function scheduleDeepSearchLiveUpdate(ctx) {
  if (deepSearchLiveTimer) return;
  deepSearchLiveTimer = setTimeout(() => {
    deepSearchLiveTimer = null;
    publishDeepSearchProgress(ctx);
  }, 250);
}

function reportSearchProgress(data) {
  publishDeepSearchProgress({
    query: data.query || '',
    rootUrl: data.rootUrl || location.href,
    results: data.results || [],
    foldersScanned: data.foldersScanned || 0,
    running: data.running !== false,
    current: data.current,
    phase: data.phase
  });
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

function collectLinksFromHtml(html, baseUrl, q, rootUrl, depth, results, seenResults, nextLevel, visitedFolders) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('a[href]').forEach(a => {
    try {
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

      const text = safeDecode(rawText);

      if (matchesQuery(text, href, q) && !seenResults.has(href)) {
        seenResults.add(href);
        results.push(makeSearchResult(href, text, depth));
      }

      if (isFolderLink(href)) {
        const folderUrl = normalizeDirUrl(href);
        if (!visitedFolders.has(folderUrl) && deepCanEnqueueChild(depth)) {
          visitedFolders.add(folderUrl);
          nextLevel.push({ url: folderUrl, depth: depth + 1 });
        }
      }
    } catch {
      /* একটা খারাপ লিংক — বাকি সার্চ চালু */
    }
  });
}

function collectLinksFromCurrentDocument(q, rootUrl, depth, results, seenResults, nextLevel, visitedFolders) {
  document.querySelectorAll('a[href]').forEach(a => {
    try {
      const href = a.href;
      const rawText = (a.textContent || '').trim();
      if (!href || !rawText || href.startsWith('javascript')) return;
      if (!isUnderRoot(href, rootUrl)) return;
      if (isParentLink(href, rawText)) return;

      const text = safeDecode(rawText);

      if (matchesQuery(text, href, q) && !seenResults.has(href)) {
        seenResults.add(href);
        results.push(makeSearchResult(href, text, depth));
      }

      if (isFolderLink(href)) {
        const folderUrl = normalizeDirUrl(href);
        if (!visitedFolders.has(folderUrl) && deepCanEnqueueChild(depth)) {
          visitedFolders.add(folderUrl);
          nextLevel.push({ url: folderUrl, depth: depth + 1 });
        }
      }
    } catch {
      /* skip malformed link */
    }
  });
}

/** এক ফোল্ডার স্ক্যান — পরের depth-এর তালিকা ফেরত */
async function scanOneFolderLevel({ url, depth }, rootUrl, q, results, seenResults, visitedFolders) {
  const nextLevel = [];
  const isCurrentPage = url === location.href || url === normalizeDirUrl(location.href);

  if (isCurrentPage) {
    collectLinksFromCurrentDocument(q, rootUrl, depth, results, seenResults, nextLevel, visitedFolders);
    return nextLevel;
  }

  try {
    const html = await fetchFolderHtml(url);
    collectLinksFromHtml(html, url, q, rootUrl, depth, results, seenResults, nextLevel, visitedFolders);
  } catch {
    /* unreachable */
  }
  return nextLevel;
}

/** search?q= / movie/search?search= — ফলাফল লিংক; folder crawl আলাদা */
async function tryDeepSearchEndpoints(query, rootUrl, results, seenResults, visitedFolders) {
  if (typeof buildFtpSearchUrlCandidates !== 'function') return;
  const q = query.toLowerCase().trim();
  const candidates = buildFtpSearchUrlCandidates(rootUrl, query);

  for (const searchUrl of candidates) {
    if (!deepUnderLimit(DEEP_SEARCH.maxResults, results.length)) break;
    try {
      const html = await fetchFolderHtml(searchUrl);
      const discard = [];
      collectLinksFromHtml(html, searchUrl, rootUrl, q, 0, results, seenResults, discard, visitedFolders);
      reportSearchProgress({
        foldersScanned: 0,
        queueLen: 0,
        resultsCount: results.length,
        current: searchUrl,
        phase: 'search_url'
      });
    } catch {
      /* পরের প্যাটার্ন */
    }
  }
}

async function deepSearchFtp(query) {
  const q = query.toLowerCase().trim();
  if (!q) return { results: [], scannedFolders: 0, rootUrl: location.href };

  const rootUrl = normalizeDirUrl(location.href);
  const results = [];
  const seenResults = new Set();
  const visitedFolders = new Set();
  visitedFolders.add(rootUrl);

  let foldersScanned = 0;
  let currentLevel = [{ url: rootUrl, depth: 0 }];

  const liveCtx = () => ({
    query: q,
    rootUrl,
    results,
    foldersScanned,
    running: true
  });

  publishDeepSearchProgress({ ...liveCtx(), phase: 'search_urls', current: rootUrl });

  await tryDeepSearchEndpoints(query, rootUrl, results, seenResults, visitedFolders);
  scheduleDeepSearchLiveUpdate({ ...liveCtx(), phase: 'search_urls_done', current: rootUrl });

  /** Level BFS — প্রতিটি depth-এর সব folder, কোনো branch বাদ নয় (Windows-style) */
  while (
    currentLevel.length > 0 &&
    !deepSearchAbort &&
    deepUnderLimit(DEEP_SEARCH.maxFolders, foldersScanned) &&
    deepUnderLimit(DEEP_SEARCH.maxResults, results.length)
  ) {
    const nextLevel = [];

    for (let i = 0; i < currentLevel.length; i += DEEP_SEARCH.maxConcurrent) {
      if (deepSearchAbort) break;
      if (!deepUnderLimit(DEEP_SEARCH.maxFolders, foldersScanned)) break;
      if (!deepUnderLimit(DEEP_SEARCH.maxResults, results.length)) break;

      const batch = currentLevel.slice(i, i + DEEP_SEARCH.maxConcurrent);
      const childLists = await Promise.all(
        batch.map(item =>
          scanOneFolderLevel(item, rootUrl, q, results, seenResults, visitedFolders)
        )
      );

      for (const children of childLists) {
        mergeFolderLevels(nextLevel, children);
      }

      foldersScanned += batch.length;
      scheduleDeepSearchLiveUpdate({
        ...liveCtx(),
        phase: 'crawl',
        current: batch[batch.length - 1]?.url || rootUrl
      });
    }

    if (deepSearchAbort) break;
    currentLevel = nextLevel;
  }

  results.sort((a, b) => (a.depth || 0) - (b.depth || 0));

  const finalData = {
    results,
    scannedFolders: foldersScanned,
    rootUrl,
    deep: true,
    stopped: deepSearchAbort
  };

  publishDeepSearchProgress({
    query: q,
    rootUrl,
    results,
    foldersScanned,
    running: false,
    phase: 'done'
  });

  try {
    chrome.runtime.sendMessage({ action: 'ftpSearchDone', query: q, ...finalData, running: false });
  } catch { /* popup বন্ধ */ }

  return finalData;
}

/** একই লেভেলে duplicate folder URL এড়ায় */
function mergeFolderLevels(target, incoming) {
  const seen = new Set(target.map((x) => x.url));
  for (const item of incoming) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      target.push(item);
    }
  }
}

function searchInPage(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results = [];
  const seen = new Set();

  document.querySelectorAll('a[href]').forEach(a => {
    try {
      const href = a.href;
      const rawText = (a.textContent || '').trim();
      if (!href || href.startsWith('javascript') || !rawText) return;

      const text = safeDecode(rawText);
      if (matchesQuery(text, href, q) && !seen.has(href)) {
        seen.add(href);
        results.push(makeSearchResult(href, text, 0));
      }
    } catch {
      /* skip */
    }
  });

  return results;
}

function scanPageForMedia() {
  const found = new Map();
  const urlRegex = /https?:\/\/[^\s"'<>(){}[\]\\]+/gi;
  // এই page-এর URL টা সব media item-এর referrer হবে
  const pageReferrer = location.href;

  const add = (url) => {
    if (!url || url.length < 8) return;
    try { url = new URL(url, location.href).href; } catch { return; }
    const type = classifyUrl(url);
    if (type && !found.has(url)) {
      found.set(url, { url, type, name: extractFilename(url), referrer: pageReferrer });
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

  if (msg.action === 'ftpDeepSearchStop') {
    deepSearchAbort = true;
    sendResponse({ stopped: true });
    return true;
  }

  if (msg.action === 'searchFtp') {
    const runDeep = msg.deep !== false;

    if (runDeep) {
      deepSearchAbort = false;
      deepSearchFtp(msg.query).catch((err) => {
        publishDeepSearchProgress({
          query: String(msg.query || '').toLowerCase().trim(),
          rootUrl: normalizeDirUrl(location.href),
          results: [],
          foldersScanned: 0,
          running: false
        });
        try {
          chrome.runtime.sendMessage({
            action: 'ftpSearchDone',
            query: msg.query,
            results: [],
            error: err.message,
            running: false
          });
        } catch { /* */ }
      });
      sendResponse({ started: true, live: true });
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
