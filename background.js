// ============================================================
// MEDIA HUNTER - Background Service Worker
// FTP scan — chrome.storage.local + IndexedDB (Android/Kiwi)
// ============================================================

const SERVER_LIST_URL = 'https://raw.githubusercontent.com/mdakash648/media-hunter-extension/main/serverList.json';
const STORAGE_KEY = 'ftpScanData';
const STORAGE_KEY_WORKING = 'ftpWorkingServers';
const STORAGE_KEY_BULK_SEARCH = 'ftpBulkSearchData';
const IDB_NAME = 'MediaHunterDB';
const IDB_STORE = 'ftp';
const IDB_KEY = 'ftpScanData';

let ftpServers = [];
let ftpResults = {};
let ftpScanning = false;
let ftpShouldStop = false;
let totalServers = 0;
let doneCount = 0;
let lastScanTime = null;
let storageReady = false;

let bulkSearchRunning = false;
let bulkShouldStop = false;
let bulkQuery = '';
let bulkRows = [];

// ---------- Storage helpers (Promise + error handling) ----------
function storageGet(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, (data) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(data || {});
      });
    } catch (e) { reject(e); }
  });
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    } catch (e) { reject(e); }
  });
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(IDB_STORE)) {
        e.target.result.createObjectStore(IDB_STORE);
      }
    };
  });
}

async function idbSave(payload) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(payload, IDB_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function idbLoad() {
  try {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return null;
  }
}

function applySavedPayload(saved) {
  if (!saved) return false;
  if (saved.results && Object.keys(saved.results).length > 0) {
    ftpResults = saved.results;
    ftpServers = saved.servers || ftpServers;
    lastScanTime = saved.lastScan || lastScanTime;
    return true;
  }
  return false;
}

/** সেভড working তালিকা মিলানোর জন্য (trailing slash / case) */
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

function applyCompactWorking(compact) {
  const working = compact?.urls || [];
  const servers = compact?.allServers?.length ? compact.allServers : working;
  if (!servers.length) return false;

  ftpServers = servers;
  ftpResults = {};
  const workingSet = new Set(working.map(normalizeScanUrl));
  servers.forEach(url => {
    ftpResults[url] = { status: workingSet.has(normalizeScanUrl(url)) ? 'working' : 'dead' };
  });
  lastScanTime = compact.lastScan || compact.savedAt || lastScanTime;
  return true;
}

async function restoreFromStorage() {
  try {
    const data = await storageGet([STORAGE_KEY, STORAGE_KEY_WORKING]);
    if (applySavedPayload(data[STORAGE_KEY])) return true;
    if (applyCompactWorking(data[STORAGE_KEY_WORKING])) return true;
  } catch (e) {
    console.warn('[Media Hunter] chrome.storage read failed:', e);
  }

  try {
    const idbData = await idbLoad();
    if (applySavedPayload(idbData)) return true;
    if (applyCompactWorking(idbData?.compact)) return true;
  } catch (e) {
    console.warn('[Media Hunter] IndexedDB read failed:', e);
  }

  return false;
}

async function saveResults(isFinal = false) {
  if (isFinal) lastScanTime = new Date().toISOString();

  const payload = {
    results: ftpResults,
    servers: ftpServers,
    lastScan: lastScanTime
  };

  const workingUrls = Object.entries(ftpResults)
    .filter(([, info]) => info.status === 'working')
    .map(([url]) => url);

  const compact = {
    urls: workingUrls,
    allServers: ftpServers,
    lastScan: lastScanTime,
    savedAt: new Date().toISOString()
  };

  const idbPayload = { ...payload, compact };

  let chromeOk = false;
  try {
    await storageSet({ [STORAGE_KEY]: payload, [STORAGE_KEY_WORKING]: compact });
    chromeOk = true;
  } catch (e) {
    console.warn('[Media Hunter] chrome.storage save failed:', e);
    try {
      await storageSet({ [STORAGE_KEY_WORKING]: compact });
      chromeOk = true;
    } catch (e2) {
      console.warn('[Media Hunter] compact save failed:', e2);
    }
  }

  try {
    await idbSave(idbPayload);
  } catch (e) {
    console.warn('[Media Hunter] IndexedDB save failed:', e);
  }

  return chromeOk;
}

// Service Worker শুরুতেই storage থেকে restore
(async () => {
  await restoreFromStorage();
  await restoreBulkSearchState();
  if (bulkSearchRunning && bulkQuery && bulkRows.some(r => r.status === 'pending' || r.status === 'scanning')) {
    bulkRows.forEach((r) => { if (r.status === 'scanning') r.status = 'pending'; });
    continueBulkSearchFromPending().catch(() => {});
  } else if (bulkSearchRunning) {
    bulkSearchRunning = false;
    await saveBulkSearchState(false).catch(() => {});
  }
  storageReady = true;
})();

chrome.runtime.onStartup.addListener(() => { restoreFromStorage(); });
chrome.runtime.onInstalled.addListener(() => { restoreFromStorage(); });

chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && (ftpScanning || bulkSearchRunning)) { /* heartbeat */ }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'ftpStartScan') {
    if (ftpScanning) {
      sendResponse({ status: 'already_running' });
      return true;
    }
    startFtpScan();
    sendResponse({ status: 'started' });
    return true;
  }

  if (msg.action === 'ftpStopScan') {
    ftpShouldStop = true;
    saveResults(true);
    sendResponse({ status: 'stopping' });
    return true;
  }

  if (msg.action === 'ftpGetStatus') {
    (async () => {
      if (!storageReady || Object.keys(ftpResults).length === 0) {
        await restoreFromStorage();
      }
      sendResponse({
        scanning: ftpScanning,
        total: totalServers || ftpServers.length,
        done: doneCount,
        results: ftpResults,
        lastScan: lastScanTime
      });
    })();
    return true;
  }

  if (msg.action === 'ftpClearData') {
    ftpResults = {};
    ftpServers = [];
    totalServers = 0;
    doneCount = 0;
    lastScanTime = null;
    chrome.storage.local.remove([STORAGE_KEY, STORAGE_KEY_WORKING]);
    idbSave(null).catch(() => {});
    sendResponse({ status: 'cleared' });
    return true;
  }

  if (msg.action === 'ftpLoadSaved') {
    (async () => {
      await restoreFromStorage();
      sendResponse({
        data: {
          results: ftpResults,
          servers: ftpServers,
          lastScan: lastScanTime
        }
      });
    })();
    return true;
  }

  if (msg.action === 'checkMediaLink') {
    checkMediaLink(msg.url)
      .then(result => sendResponse(result))
      .catch(() => sendResponse({ working: false, method: '', status: 0, detail: 'error' }));
    return true;
  }

  if (msg.action === 'ftpBulkSearchStart') {
    (async () => {
      if (bulkSearchRunning) {
        sendResponse({ status: 'already_running', rows: bulkRows, query: bulkQuery, running: true });
        return;
      }
      const q = String(msg.query || '').trim();
      if (q.length < 2) {
        sendResponse({ status: 'error', error: 'কমপক্ষে ২ অক্ষর লিখুন' });
        return;
      }
      if (!storageReady || Object.keys(ftpResults).length === 0) {
        await restoreFromStorage();
      }
      const urls = Object.entries(ftpResults)
        .filter(([, info]) => info.status === 'working')
        .map(([url]) => url);
      if (!urls.length) {
        sendResponse({ status: 'error', error: 'কোনো working সার্ভার নেই — আগে FTP স্ক্যান করুন' });
        return;
      }
      startBulkFtpSearchJob(q, urls);
      sendResponse({ status: 'started', rows: bulkRows, query: bulkQuery, running: true, total: urls.length });
    })();
    return true;
  }

  if (msg.action === 'ftpBulkSearchStop') {
    bulkShouldStop = true;
    saveBulkSearchState(false).catch(() => {});
    sendResponse({ status: 'stopping' });
    return true;
  }

  if (msg.action === 'ftpBulkSearchGetStatus') {
    (async () => {
      await restoreBulkSearchState();
      sendResponse({
        rows: bulkRows,
        query: bulkQuery,
        running: bulkSearchRunning,
        done: bulkRows.filter(r => !['pending', 'scanning'].includes(r.status)).length,
        total: bulkRows.length,
        found: bulkRows.filter(r => r.status === 'found').length
      });
    })();
    return true;
  }

  if (msg.action === 'ftpBulkSearchClear') {
    bulkSearchRunning = false;
    bulkShouldStop = false;
    bulkQuery = '';
    bulkRows = [];
    chrome.storage.local.remove(STORAGE_KEY_BULK_SEARCH);
    sendResponse({ status: 'cleared' });
    return true;
  }

  return true;
});

async function startFtpScan() {
  ftpScanning = true;
  ftpShouldStop = false;

  if (ftpServers.length === 0) {
    try {
      const resp = await fetch(SERVER_LIST_URL);
      const data = await resp.json();
      ftpServers = data.urls || [];
    } catch (e) {
      const saved = await storageGet([STORAGE_KEY, STORAGE_KEY_WORKING]).catch(() => ({}));
      ftpServers = saved[STORAGE_KEY]?.servers || saved[STORAGE_KEY_WORKING]?.allServers || [];
      if (!ftpServers.length) await restoreFromStorage();
    }
  }

  if (ftpServers.length === 0) {
    ftpScanning = false;
    broadcastToPopup({ action: 'ftpScanError', msg: 'সার্ভার লিস্ট লোড হয়নি' });
    return;
  }

  totalServers = ftpServers.length;
  doneCount = 0;

  ftpServers.forEach(url => {
    if (!ftpResults[url]) ftpResults[url] = { status: 'pending' };
  });

  broadcastToPopup({ action: 'ftpProgress', done: 0, total: totalServers, results: ftpResults, scanning: true });

  const batchSize = 10;

  for (let i = 0; i < totalServers; i += batchSize) {
    if (ftpShouldStop) break;

    const batch = ftpServers.slice(i, i + batchSize);
    batch.forEach(url => { ftpResults[url] = { status: 'scanning' }; });
    broadcastToPopup({ action: 'ftpProgress', done: doneCount, total: totalServers, results: ftpResults, scanning: true });

    await Promise.all(batch.map(async (url) => {
      if (ftpShouldStop) {
        ftpResults[url] = { status: 'pending' };
        return;
      }
      const ok = await checkServer(url);
      ftpResults[url] = { status: ok ? 'working' : 'dead' };
    }));

    doneCount += batch.length;
    await saveResults(false);
    broadcastToPopup({ action: 'ftpProgress', done: doneCount, total: totalServers, results: ftpResults, scanning: true });
  }

  ftpScanning = false;
  await saveResults(true);
  broadcastToPopup({ action: 'ftpScanDone', done: doneCount, total: totalServers, results: ftpResults, scanning: false });
}

const FAST_HEAD_MS = 900;
const FTP_HEAD_MS = 4000;
const FTP_GET_MS = 7000;

async function fetchWithTimeout(url, options = {}) {
  const ms = options.timeout ?? FAST_HEAD_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: options.method || 'HEAD',
      headers: options.headers,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      mode: options.mode
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function isAliveHttpStatus(status) {
  if (status >= 200 && status < 400) return true;
  if (status === 206) return true;
  // 403/405/500 ইত্যাদি — সার্ভার জীবিত, শুধু HEAD/GET সীমিত
  return status !== 404 && status !== 410;
}

/** M3U মিডিয়া লিংক — দ্রুত HEAD (~1s) */
async function checkMediaLink(url) {
  if (!/^https?:\/\//i.test(url)) {
    return { working: false, method: '', status: 0, detail: 'bad URL' };
  }

  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD', timeout: FAST_HEAD_MS });
    if (res.status === 404 || res.status === 410) {
      return { working: false, method: 'HEAD', status: res.status, detail: `${res.status}` };
    }
    return { working: true, method: 'HEAD', status: res.status, detail: 'OK' };
  } catch {
    return { working: true, method: 'LINK', status: 0, detail: 'OK' };
  }
}

/**
 * FTP সার্ভার হোমপেজ — HEAD-এ 404 আসলেও GET/no-cors দিয়ে আবার চেক।
 * আগের স্ক্যানের মতো শুধু নেটওয়ার্কে পৌঁছানোই working ধরা হয় (no-cors fallback)।
 */
async function checkFtpServer(url) {
  if (!/^https?:\/\//i.test(url)) return false;

  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD', timeout: FTP_HEAD_MS });
    if (isAliveHttpStatus(head.status)) return true;
  } catch { /* GET fallback */ }

  try {
    const get = await fetchWithTimeout(url, {
      method: 'GET',
      timeout: FTP_GET_MS,
      headers: { Range: 'bytes=0-0' }
    });
    if (isAliveHttpStatus(get.status)) return true;
  } catch { /* no-cors fallback */ }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FTP_GET_MS);
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

async function checkServer(url) {
  return checkFtpServer(url);
}

// ---------- Bulk FTP content search (background job + storage) ----------
const BULK_SEARCH_MS = 15000;
const BULK_TEXT_MAX = 768000;
const BULK_FILE_EXT_RE = /\.(mp4|mkv|avi|mov|webm|mp3|flac|m4v|zip|rar|7z|iso|srt|ass|sub|wmv|ts|m2ts|mpg|mpeg)$/i;
const BULK_CRAWL = { maxDepth: 6, maxFolders: 55 };

async function saveBulkSearchState(running) {
  await storageSet({
    [STORAGE_KEY_BULK_SEARCH]: {
      query: bulkQuery,
      running: running !== undefined ? running : bulkSearchRunning,
      rows: bulkRows,
      updatedAt: new Date().toISOString()
    }
  }).catch((e) => console.warn('[Media Hunter] bulk search save failed:', e));
}

async function restoreBulkSearchState() {
  try {
    const data = await storageGet([STORAGE_KEY_BULK_SEARCH]);
    const saved = data[STORAGE_KEY_BULK_SEARCH];
    if (!saved?.rows?.length) return false;
    bulkQuery = saved.query || '';
    bulkRows = saved.rows;
    bulkSearchRunning = !!saved.running;
    return true;
  } catch {
    return false;
  }
}

function broadcastBulkProgress() {
  const done = bulkRows.filter(r => !['pending', 'scanning'].includes(r.status)).length;
  const found = bulkRows.filter(r => r.status === 'found').length;
  broadcastToPopup({
    action: 'bulkSearchProgress',
    rows: bulkRows,
    query: bulkQuery,
    running: bulkSearchRunning,
    done,
    total: bulkRows.length,
    found
  });
}

async function runBulkSearchLoop(query, startIndex = 0) {
  for (let i = startIndex; i < bulkRows.length; i++) {
    if (bulkShouldStop) break;
    if (bulkRows[i].status !== 'pending') continue;

    bulkRows[i].status = 'scanning';
    broadcastBulkProgress();

    const result = await searchFtpServerContent(bulkRows[i].url, query);
    bulkRows[i] = {
      url: bulkRows[i].url,
      status: result.status || 'error',
      searchUrl: result.searchUrl || bulkRows[i].url,
      matchText: result.matchText || '',
      detail: result.detail || ''
    };

    await saveBulkSearchState(true);
    broadcastBulkProgress();
  }

  bulkSearchRunning = false;
  await saveBulkSearchState(false);
  broadcastToPopup({
    action: 'bulkSearchDone',
    rows: bulkRows,
    query: bulkQuery,
    running: false,
    done: bulkRows.filter(r => !['pending', 'scanning'].includes(r.status)).length,
    total: bulkRows.length,
    found: bulkRows.filter(r => r.status === 'found').length,
    stopped: bulkShouldStop
  });
}

async function startBulkFtpSearchJob(query, urls) {
  bulkSearchRunning = true;
  bulkShouldStop = false;
  bulkQuery = query;
  bulkRows = urls.map((url) => ({
    url,
    status: 'pending',
    searchUrl: url,
    matchText: '',
    detail: ''
  }));

  await saveBulkSearchState(true);
  broadcastBulkProgress();
  await runBulkSearchLoop(query, 0);
}

async function continueBulkSearchFromPending() {
  bulkSearchRunning = true;
  bulkShouldStop = false;
  const startIndex = bulkRows.findIndex((r) => r.status === 'pending');
  if (startIndex < 0) {
    bulkSearchRunning = false;
    await saveBulkSearchState(false);
    return;
  }
  await saveBulkSearchState(true);
  broadcastBulkProgress();
  await runBulkSearchLoop(bulkQuery, startIndex);
}

function bulkSafeDecode(str) {
  if (str == null || str === '') return '';
  try {
    return decodeURIComponent(str);
  } catch {
    try {
      return String(str).replace(/%(?:[0-9A-Fa-f]{2})+/g, (seq) => {
        try { return decodeURIComponent(seq); } catch { return seq; }
      });
    } catch {
      return String(str);
    }
  }
}

function bulkHrefSearchText(href) {
  try {
    const u = new URL(href);
    return `${u.hostname}${bulkSafeDecode(u.pathname)}${bulkSafeDecode(u.search)}`;
  } catch {
    return bulkSafeDecode(href);
  }
}

function bulkNormalizeDirUrl(url) {
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

function bulkIsUnderRoot(href, rootUrl) {
  try {
    const u = new URL(href, rootUrl);
    const root = new URL(rootUrl);
    return u.origin === root.origin && u.pathname.startsWith(root.pathname);
  } catch {
    return false;
  }
}

function bulkIsParentLink(href, text) {
  const t = (text || '').toLowerCase();
  if (/parent|\.\.\/|up to/i.test(t)) return true;
  try {
    const path = new URL(href).pathname;
    return path.endsWith('/../') || path.includes('/..');
  } catch {
    return false;
  }
}

function bulkIsFolderLink(href) {
  try {
    const u = new URL(href);
    if (u.pathname.endsWith('/')) return true;
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    if (!last) return true;
    if (/^index\.(html?|php|asp|jsp)$/i.test(last)) return false;
    if (BULK_FILE_EXT_RE.test(last)) return false;
    return !last.includes('.');
  } catch {
    return false;
  }
}

function bulkMatchesQuery(text, href, q) {
  const searchIn = (bulkSafeDecode(text) + ' ' + bulkHrefSearchText(href)).toLowerCase();
  return searchIn.includes(q);
}

function bulkStripHtmlTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function bulkFetchFolderHtml(url) {
  const res = await fetchWithTimeout(url, { method: 'GET', timeout: BULK_SEARCH_MS });
  if (!res.ok && res.status >= 400 && res.status !== 403) {
    throw new Error(`HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const len = Math.min(buf.byteLength, BULK_TEXT_MAX);
  return new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, len));
}

function bulkCollectFromHtml(html, baseUrl, rootUrl, q, state) {
  const linkRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    if (state.match) break;
    try {
      const rawHref = (m[1] || m[2] || m[3] || '').trim();
      if (!rawHref || rawHref === '#') continue;

      let href;
      try {
        href = new URL(rawHref, baseUrl).href;
      } catch {
        continue;
      }

      const rawText = bulkStripHtmlTags(m[4]);
      if (!rawText || href.startsWith('javascript') || href.startsWith('mailto:')) continue;
      if (!bulkIsUnderRoot(href, rootUrl)) continue;
      if (bulkIsParentLink(href, rawText)) continue;

      const text = bulkSafeDecode(rawText);

      if (bulkMatchesQuery(text, href, q) && !state.seen.has(href)) {
        state.seen.add(href);
        state.match = { href, text };
        break;
      }

      if (!state.match && bulkIsFolderLink(href)) {
        const folderUrl = bulkNormalizeDirUrl(href);
        if (
          !state.visited.has(folderUrl) &&
          state.depth + 1 <= BULK_CRAWL.maxDepth &&
          state.queue.length < BULK_CRAWL.maxFolders
        ) {
          state.visited.add(folderUrl);
          state.queue.push({ url: folderUrl, depth: state.depth + 1 });
        }
      }
    } catch {
      /* skip */
    }
  }
}

async function searchFtpServerContent(baseUrl, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.length < 2 || !/^https?:\/\//i.test(baseUrl)) {
    return { status: 'error', url: baseUrl, searchUrl: baseUrl, detail: 'bad input' };
  }

  const rootUrl = bulkNormalizeDirUrl(baseUrl);
  const state = {
    queue: [{ url: rootUrl, depth: 0 }],
    visited: new Set([rootUrl]),
    seen: new Set(),
    match: null,
    depth: 0,
    foldersScanned: 0
  };
  let lastDetail = '';

  while (
    state.queue.length > 0 &&
    state.foldersScanned < BULK_CRAWL.maxFolders &&
    !state.match
  ) {
    const item = state.queue.shift();
    state.depth = item.depth;
    try {
      const html = await bulkFetchFolderHtml(item.url);
      bulkCollectFromHtml(html, item.url, rootUrl, q, state);
      state.foldersScanned++;
      if (state.match) {
        return {
          status: 'found',
          url: baseUrl,
          searchUrl: state.match.href,
          matchText: state.match.text
        };
      }
    } catch (e) {
      lastDetail = e?.message || 'fetch failed';
    }
  }

  if (state.foldersScanned === 0 && lastDetail) {
    return { status: 'error', url: baseUrl, searchUrl: rootUrl, detail: lastDetail };
  }

  return {
    status: 'not_found',
    url: baseUrl,
    searchUrl: rootUrl,
    detail: lastDetail
  };
}

function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}
