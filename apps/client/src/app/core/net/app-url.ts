// Every URL the client builds is relative to the page's <base href>. That's "/" at a domain root;
// behind a reverse proxy it's the server's BASE_PATH (e.g. "/pixel-party/"), which the server writes
// into index.html. In development the Angular dev server proxies /api and /ws (proxy.conf.json).
export function appUrl(path: string): string {
  return new URL(path, document.baseURI).href
}

// The same, as a WebSocket URL (ws: next to http:, wss: next to https:).
export function socketUrl(path: string): string {
  const url = new URL(path, document.baseURI)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}
