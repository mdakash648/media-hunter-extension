// ============================================================
// MEDIA HUNTER - Background Service Worker
// FTP scan এখানে চলে — popup বন্ধ হলেও scan চলতে থাকে
// ============================================================

const SERVER_LIST_URL = 'https://raw.githubusercontent.com/mdakash648/media-hunter-extension/main/serverList.json';

let ftpServers = [];
let ftpResults = {};
let ftpScanning = false;
let ftpShouldStop = false;
let totalServers = 0;
let doneCount = 0;

// Service Worker কে alive রাখতে alarm ব্যবহার
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && ftpScanning) {
    // just a heartbeat — keeps SW alive during scan
  }
});

// ============================================================
// Popup থেকে message receive করা
// ============================================================
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
    sendResponse({ status: 'stopping' });
    return true;
  }

  if (msg.action === 'ftpGetStatus') {
    sendResponse({
      scanning: ftpScanning,
      total: totalServers,
      done: doneCount,
      results: ftpResults
    });
    return true;
  }

  if (msg.action === 'ftpClearData') {
    ftpResults = {};
    ftpServers = [];
    totalServers = 0;
    doneCount = 0;
    chrome.storage.local.remove('ftpScanData');
    sendResponse({ status: 'cleared' });
    return true;
  }

  if (msg.action === 'ftpLoadSaved') {
    chrome.storage.local.get('ftpScanData', (data) => {
      sendResponse({ data: data.ftpScanData || null });
    });
    return true; // async
  }

  return true;
});

// ============================================================
// FTP Scan Logic
// ============================================================
async function startFtpScan() {
  ftpScanning = true;
  ftpShouldStop = false;

  // Server list লোড করো
  if (ftpServers.length === 0) {
    try {
      const resp = await fetch(SERVER_LIST_URL);
      const data = await resp.json();
      ftpServers = data.urls || [];
    } catch (e) {
      // Storage থেকে পুরানো list নাও
      const saved = await new Promise(r => chrome.storage.local.get('ftpScanData', r));
      ftpServers = saved.ftpScanData?.servers || [];
    }
  }

  if (ftpServers.length === 0) {
    ftpScanning = false;
    broadcastToPopup({ action: 'ftpScanError', msg: 'সার্ভার লিস্ট লোড হয়নি' });
    return;
  }

  totalServers = ftpServers.length;
  doneCount = 0;

  // আগের result যদি না থাকে pending দাও
  ftpServers.forEach(url => {
    if (!ftpResults[url]) ftpResults[url] = { status: 'pending' };
  });

  broadcastToPopup({ action: 'ftpProgress', done: 0, total: totalServers, results: ftpResults, scanning: true });

  const batchSize = 10;

  for (let i = 0; i < totalServers; i += batchSize) {
    if (ftpShouldStop) break;

    const batch = ftpServers.slice(i, i + batchSize);

    // Batch কে scanning দেখাও
    batch.forEach(url => { ftpResults[url] = { status: 'scanning' }; });
    broadcastToPopup({ action: 'ftpProgress', done: doneCount, total: totalServers, results: ftpResults, scanning: true });

    // Parallel check
    await Promise.all(batch.map(async (url) => {
      if (ftpShouldStop) {
        ftpResults[url] = { status: 'pending' };
        return;
      }
      const ok = await checkServer(url);
      ftpResults[url] = { status: ok ? 'working' : 'dead' };
    }));

    doneCount += batch.length;

    // Save to storage every batch
    saveResults();

    // Popup কে update পাঠাও
    broadcastToPopup({ action: 'ftpProgress', done: doneCount, total: totalServers, results: ftpResults, scanning: true });
  }

  ftpScanning = false;
  saveResults(true); // final save with timestamp

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

function saveResults(isFinal = false) {
  const data = {
    results: ftpResults,
    servers: ftpServers,
    lastScan: isFinal ? new Date().toISOString() : null
  };
  chrome.storage.local.set({ ftpScanData: data });
}

// Popup কে message পাঠাও (popup খোলা থাকলে পাবে)
function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // popup বন্ধ থাকলে error হবে — ignore করো
  });
}
