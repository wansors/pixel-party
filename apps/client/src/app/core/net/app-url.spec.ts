import { appUrl, socketUrl } from './app-url'

describe('app URLs follow the <base href>', () => {
  const base = document.createElement('base')
  afterEach(() => base.remove())

  it('stay at the root by default', () => {
    expect(new URL(appUrl('api/rooms')).pathname).toBe('/api/rooms')
  })

  it('live below BASE_PATH when the server rewrote the base', () => {
    base.href = '/pixel-party/'
    document.head.prepend(base)
    expect(new URL(appUrl('api/rooms/ABCD')).pathname).toBe('/pixel-party/api/rooms/ABCD')
    expect(new URL(appUrl('?code=ABCD')).pathname).toBe('/pixel-party/')
    const ws = new URL(socketUrl('ws'))
    expect(ws.protocol).toBe('ws:')
    expect(ws.pathname).toBe('/pixel-party/ws')
  })
})
