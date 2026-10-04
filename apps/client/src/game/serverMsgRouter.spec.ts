import { ServerMsgRouter } from './serverMsgRouter'

describe('ServerMsgRouter', () => {
  it('dispatches to the registered handler with the narrowed message', () => {
    let seen: string | undefined
    const router = new ServerMsgRouter().on('WELCOME', (msg) => {
      seen = msg.playerId
    })
    router.dispatch({
      type: 'WELCOME',
      protocolVersion: 1,
      playerId: 'p1',
      roomCode: 'ABCD',
      isHost: true,
      rejoinToken: 'secret',
    })
    expect(seen).toBe('p1')
  })

  it('is a no-op for unregistered types', () => {
    const router = new ServerMsgRouter()
    expect(() => router.dispatch({ type: 'ERROR', reason: 'x' })).not.toThrow()
  })
})
