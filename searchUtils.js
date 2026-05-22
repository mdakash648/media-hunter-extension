// Shared FTP search URL patterns — content.js + background.js
const FTP_SEARCH_ENDPOINTS = [
  { path: 'movie/search', param: 'search' },
  { path: 'search', param: 'q' },
  { path: 'search', param: 'keyword' },
  { path: 'search', param: 'search' },
  { path: 'search', param: 'query' },
  { path: 'movies/search', param: 'search' },
  { path: 'movies/search', param: 'q' },
  { path: 'movie/search', param: 'q' }
];

function normalizeFtpRootUrl(url) {
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

function buildFtpSearchUrlCandidates(baseUrl, query) {
  const encoded = encodeURIComponent(String(query || '').trim());
  if (!encoded) return [];

  const dir = normalizeFtpRootUrl(baseUrl);
  const out = [];

  try {
    const root = new URL(dir);
    for (const { path, param } of FTP_SEARCH_ENDPOINTS) {
      const u = new URL(root.href);
      if (path) {
        const basePath = u.pathname.replace(/\/$/, '');
        u.pathname = `${basePath}/${path}`.replace(/\/+/g, '/');
      }
      u.search = `${param}=${encoded}`;
      out.push(u.href);
    }
  } catch {
    return [];
  }

  return [...new Set(out)];
}
