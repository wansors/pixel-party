// Dev environment (default). Replaced by environment.production.ts via angular.json fileReplacements
// in production builds. Same-origin via the dev-server proxy (proxy.conf.json): the WS rides the
// proxied /ws path and /api is relative, so only port 4200 is exposed. Works over localhost or LAN IP.
export const environment = {
  production: false,
  apiUrl: '',
  wsBase: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
}
