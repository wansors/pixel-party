import { APP_VERSION } from '@pp/shared'
import type { LiveRoomRegistry } from '../../../application/ports/LiveRoomRegistry'
import type { CreateRoomUseCase } from '../../../application/use-cases/CreateRoomUseCase'
import { config } from '../../../config'
import type { Logger } from '../../observability/logger'
import type { Metrics } from '../../observability/metrics'

export interface HttpDeps {
  createRoom: CreateRoomUseCase
  rooms: LiveRoomRegistry
  logger?: Logger
  metrics?: Metrics
  // Counters + live gauges, assembled by the WS server (which holds the session manager).
  metricsSnapshot?: () => Record<string, number>
}

// Far beyond any LAN party (a handful of rooms), low enough that a script hammering POST /api/rooms
// can't fill the memory before the idle sweeper (ROOM_IDLE_TIMEOUT_SEC) clears unused rooms.
export const MAX_ROOMS = 100

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
// `path` is the request path below BASE_PATH (defaults to the URL's own path).
export async function handleHttp(req: Request, deps: HttpDeps, path?: string): Promise<Response> {
  const pathname = path ?? new URL(req.url).pathname
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })

  if (pathname === '/api/health') return json({ ok: true, version: APP_VERSION }, 200, origin)

  if (pathname === '/api/metrics' && req.method === 'GET') {
    return json(deps.metricsSnapshot?.() ?? {}, 200, origin)
  }

  if (pathname === '/api/rooms' && req.method === 'POST') {
    if (deps.rooms.list().length >= MAX_ROOMS) {
      deps.logger?.warn('room_limit', { rooms: MAX_ROOMS })
      return json({ error: 'too_many_rooms' }, 503, origin)
    }
    const { code } = deps.createRoom.execute()
    deps.metrics?.inc('rooms_created')
    deps.logger?.info('room_created', { code })
    return json({ code }, 201, origin)
  }

  if (pathname.startsWith('/api/rooms/') && req.method === 'GET') {
    const code = pathname.slice('/api/rooms/'.length)
    const room = deps.rooms.get(code)
    return json({ exists: !!room, phase: room?.phase ?? null }, room ? 200 : 404, origin)
  }

  return json({ error: 'not_found' }, 404, origin)
}
