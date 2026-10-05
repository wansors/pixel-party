// Dev environment (default). Replaced by environment.production.ts via angular.json fileReplacements
// in production builds. API and socket URLs aren't configured here: core/net/app-url resolves them
// against the page's <base href>. In dev that's "/", and the dev-server proxy (proxy.conf.json) sends
// /api and /ws on to the game server, so only port 4200 is exposed. Works over localhost or LAN IP.
export const environment = {
  production: false,
}
