import type { LiveRoomRegistry } from '../../../application/ports/LiveRoomRegistry'
import type { CreateRoomUseCase } from '../../../application/use-cases/CreateRoomUseCase'
import { config } from '../../../config'

export interface HttpDeps {
  createRoom: CreateRoomUseCase
  rooms: LiveRoomRegistry
}

const cors = (origin: string | null): Record<string, string> => {
  // Reflect only allowlisted origins (fail-closed); cookies ride the WS upgrade, not these calls.
  if (origin && config.allowedOrigins.includes(origin)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
  }
  return {}
}

const json = (body: unknown, status: number, origin: string | null): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors(origin) },
  })

// Minimal /api surface: health, create room, and a room-exists probe the join screen uses before
// upgrading the socket. Room JOIN identity is resolved on the WS side; these are pre-upgrade helpers.
export async function handleHttp(req: Request, deps: HttpDeps): Promise<Response> {
  const url = new URL(req.url)
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })

  if (url.pathname === '/api/health') return json({ ok: true }, 200, origin)

  if (url.pathname === '/api/rooms' && req.method === 'POST') {
    const { code } = deps.createRoom.execute()
    return json({ code }, 201, origin)
  }

  if (url.pathname.startsWith('/api/rooms/') && req.method === 'GET') {
    const code = url.pathname.slice('/api/rooms/'.length)
    const room = deps.rooms.get(code)
    return json({ exists: !!room, phase: room?.phase ?? null }, room ? 200 : 404, origin)
  }

  return json({ error: 'not_found' }, 404, origin)
}
