import type { PixelRainInput, PixelRainSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
// Obstacles resolve a hit once they reach this line near the bottom.
const HIT_Y = 0.9
// Half-width of the avatar's hit zone in normalized x.
const AVATAR_HALF = 0.09
const SPAWN_MIN_MS = 300
const SPAWN_JITTER_MS = 350
const FALL_MIN_MS = 1600
const FALL_JITTER_MS = 1200
const X_MIN = 0.06
const X_SPAN = 0.88

interface Obstacle {
  id: number
  spawnAt: number // ms offset from start
  x: number
  fallMs: number
}

export interface PixelRainState {
  players: PlayerId[]
  obstacles: Obstacle[]
  startedAt: number
  endsAt: number
  avatars: Map<PlayerId, number>
  alive: Map<PlayerId, boolean>
  diedAt: Map<PlayerId, number> // 0 = still alive
}

// Real-time FFA dodge-'em-up. One seeded stream of falling blocks is shared by everyone; each player
// drags their own avatar along the bottom. Pure domain logic: the timeline comes from the injected
// Random port and time arrives as `now`. Obstacle y is a deterministic function of time, so the client
// can render smoothly. Last one standing wins.
export class PixelRain implements MiniGame<PixelRainState, PixelRainInput> {
  readonly id = 'pixel-rain'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): PixelRainState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const obstacles: Obstacle[] = []
    let t = 500
    let id = 0
    while (t < durationMs - 300) {
      obstacles.push({
        id: id++,
        spawnAt: t,
        x: X_MIN + r.next() * X_SPAN,
        fallMs: FALL_MIN_MS + Math.floor(r.next() * FALL_JITTER_MS),
      })
      t += SPAWN_MIN_MS + Math.floor(r.next() * SPAWN_JITTER_MS)
    }
    return {
      players: [...ctx.players],
      obstacles,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      avatars: new Map(ctx.players.map((pid) => [pid, 0.5])),
      alive: new Map(ctx.players.map((pid) => [pid, true])),
      diedAt: new Map(ctx.players.map((pid) => [pid, 0])),
    }
  }

  private yOf(state: PixelRainState, obstacle: Obstacle, now: number): number {
    return (now - state.startedAt - obstacle.spawnAt) / obstacle.fallMs
  }

  onInput(
    state: PixelRainState,
    playerId: PlayerId,
    input: PixelRainInput,
    _now: number,
  ): PixelRainState {
    if (input.kind !== 'move' || typeof input.x !== 'number' || !Number.isFinite(input.x)) {
      return state
    }
    if (!state.avatars.has(playerId)) return state
    if (state.alive.get(playerId) === false) return state
    state.avatars.set(playerId, Math.max(0, Math.min(1, input.x)))
    return state
  }

  tick(state: PixelRainState, _dt: number, now: number): PixelRainState {
    for (const pid of state.players) {
      if (state.alive.get(pid) === false) continue
      const avatar = state.avatars.get(pid) ?? 0.5
      for (const obstacle of state.obstacles) {
        const y = this.yOf(state, obstacle, now)
        if (y < HIT_Y || y > 1.05) continue
        if (Math.abs(obstacle.x - avatar) <= AVATAR_HALF) {
          state.alive.set(pid, false)
          state.diedAt.set(pid, now)
          break
        }
      }
    }
    return state
  }

  isFinished(state: PixelRainState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((pid) => state.alive.get(pid) === false)
  }

  private survival(state: PixelRainState, pid: PlayerId): number {
    const end = state.alive.get(pid) === false ? (state.diedAt.get(pid) ?? 0) : state.endsAt
    return end - state.startedAt
  }

  getResult(state: PixelRainState): NormalizedResult {
    const sorted = [...state.players].sort(
      (a, b) => this.survival(state, b) - this.survival(state, a),
    )
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: number | undefined
    sorted.forEach((id, idx) => {
      const v = this.survival(state, id)
      if (idx > 0 && v !== prev) rank = idx
      ranks[id] = rank
      prev = v
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${Math.round(this.survival(state, id) / 1000)}s`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: PixelRainState, now: number): PixelRainSnapshot {
    const obstacles = state.obstacles.flatMap((obstacle) => {
      const y = this.yOf(state, obstacle, now)
      return y >= 0 && y <= 1 ? [{ id: obstacle.id, x: obstacle.x, y }] : []
    })
    const alive: Record<string, boolean> = {}
    for (const pid of state.players) alive[pid] = state.alive.get(pid) !== false
    return {
      obstacles,
      alive,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
