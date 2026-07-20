export const environment = {
  production: true,
  apiUrl: '',
  wsBase: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
}
