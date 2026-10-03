import type { PixelRainInput, PixelRainSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
// Obstacles resolve a hit once they reach this line near the bottom.
const HIT_Y = 0.9
// Half-width of the avatar's hit zone in normalized x.
const AVATAR_HALF = 0.09
// Blocks spawn across the whole visible width; the avatar is held AVATAR_HALF inside that band, so its
// hit zone always lies within it and every spot gets the same rain — hugging a wall buys nothing.
const X_MIN = 0.03
const X_MAX = 0.97
export const AVATAR_MIN_X = X_MIN + AVATAR_HALF
export const AVATAR_MAX_X = X_MAX - AVATAR_HALF
// The avatar slides toward the dragged/steered x at most this fast (widths per second): a pointer can't
// teleport it out from under a block.
export const MAX_SPEED = 1.6
const SPAWN_MIN_MS = 300
const SPAWN_JITTER_MS = 350
const FALL_MIN_MS = 1600
const FALL_JITTER_MS = 1200
// Difficulty ramp: by the end of the round blocks come this much more often (gaps × SPAWN_RAMP) and
// fall this much faster (fall time × FALL_RAMP), linearly from the start — the survivors get sorted.
const SPAWN_RAMP = 0.45
const FALL_RAMP = 0.6

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
  // Where each avatar is, and where its player is steering it (it moves there at MAX_SPEED).
  avatars: Map<PlayerId, number>
  targets: Map<PlayerId, number>
  alive: Map<PlayerId, boolean>
  diedAt: Map<PlayerId, number> // 0 = still alive
}

// Real-time FFA dodge-'em-up. One seeded stream of falling blocks is shared by everyone; each player
// drags their own avatar along the bottom. Pure domain logic: the timeline comes from the injected
// Random port and time arrives as `now`. Obstacle y is a linear function of time (each block ships its
// fall speed), so the client renders it on the server's clock. The rain thickens over the round. Last
// one standing wins.
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
      const progress = t / durationMs
      obstacles.push({
        id: id++,
        spawnAt: t,
        x: X_MIN + r.next() * (X_MAX - X_MIN),
        fallMs: Math.round(
          (FALL_MIN_MS + r.next() * FALL_JITTER_MS) * (1 - (1 - FALL_RAMP) * progress),
        ),
      })
      t += Math.round(
        (SPAWN_MIN_MS + r.next() * SPAWN_JITTER_MS) * (1 - (1 - SPAWN_RAMP) * progress),
      )
    }
    return {
      players: [...ctx.players],
      obstacles,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      avatars: new Map(ctx.players.map((pid) => [pid, 0.5])),
      targets: new Map(ctx.players.map((pid) => [pid, 0.5])),
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
    if (!state.targets.has(playerId)) return state
    if (state.alive.get(playerId) === false) return state
    state.targets.set(playerId, Math.max(AVATAR_MIN_X, Math.min(AVATAR_MAX_X, input.x)))
    return state
  }

  tick(state: PixelRainState, dt: number, now: number): PixelRainState {
    const reach = (MAX_SPEED * dt) / 1000
    for (const pid of state.players) {
      if (state.alive.get(pid) === false) continue
      const from = state.avatars.get(pid) ?? 0.5
      const to = state.targets.get(pid) ?? from
      const avatar = from + Math.max(-reach, Math.min(reach, to - from))
      state.avatars.set(pid, avatar)
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

  // A player who left is out right away: last-one-standing doesn't wait for a block to find them.
  leave(state: PixelRainState, playerId: PlayerId, now: number): PixelRainState {
    if (state.alive.get(playerId) === true) {
      state.alive.set(playerId, false)
      state.diedAt.set(playerId, now)
    }
    return state
  }

  // Over at the time cap, or once the survivor is decided: last one standing in a multiplayer round
  // (nobody is left to beat — waiting out the clock alone is dead air), everyone out when solo.
  isFinished(state: PixelRainState, now: number): boolean {
    if (now >= state.endsAt) return true
    const alive = state.players.filter((pid) => state.alive.get(pid) !== false).length
    return state.players.length > 1 ? alive <= 1 : alive === 0
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
      return y >= 0 && y <= 1
        ? [{ id: obstacle.id, x: obstacle.x, y, fallMs: obstacle.fallMs }]
        : []
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
