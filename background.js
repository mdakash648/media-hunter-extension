// ============================================================
// MEDIA HUNTER - Background Service Worker
// FTP scan — chrome.storage.local + IndexedDB (Android/Kiwi)
// ============================================================

const SERVER_LIST_URL = 'https://raw.githubusercontent.com/mdakash648/media-hunter-extension/main/serverList.json';
const STORAGE_KEY = 'ftpScanData';
const STORAGE_KEY_WORKING = 'ftpWorkingServers';
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

function applyCompactWorking(compact) {
  const working = compact?.urls || [];
  const servers = compact?.allServers?.length ? compact.allServers : working;
  if (!servers.length) return false;

  ftpServers = servers;
  ftpResults = {};
  const workingSet = new Set(working);
  servers.forEach(url => {
    ftpResults[url] = { status: workingSet.has(url) ? 'working' : 'dead' };
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
  storageReady = true;
})();

chrome.runtime.onStartup.addListener(() => { restoreFromStorage(); });
chrome.runtime.onInstalled.addListener(() => { restoreFromStorage(); });

chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && ftpScanning) { /* heartbeat */ }
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

async function checkServer(url) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); resolve(false); }, 8000);
    fetch(url, { method: 'HEAD', signal: controller.signal, cache: 'no-store', mode: 'no-cors' })
      .then(() => { clearTimeout(timer); resolve(true); })
      .catch(() => { clearTimeout(timer); resolve(false); });
  });
}

function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}
