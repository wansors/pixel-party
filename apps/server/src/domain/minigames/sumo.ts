import type { SumoInput, SumoSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 30_000
const CENTER = 0.5
const RING_R = 0.42
const PLAYER_R = 0.05
const SPAWN_R = 0.22 // players start on a circle this far from the centre
const ACCEL = 1.4 // normalized units / s²
const MAX_SPEED = 0.7
const RESTITUTION = 1.25 // >1 gives shoves an exaggerated, punchy feel
const FRICTION = 2.0 // velocity decay coefficient (per second)

interface Body {
  x: number
  y: number
  vx: number
  vy: number
  // Desired push direction (unit), set by input.
  ax: number
  ay: number
  alive: boolean
  outAt: number // ms when eliminated (0 = still in)
}

export interface SumoState {
  players: PlayerId[]
  bodies: Map<PlayerId, Body>
  startedAt: number
  endsAt: number
}

// Real-time FFA sumo arena. Deterministic: initial ring positions use one seeded rotation offset, then
// all motion is pure physics driven by `dt`/`now` (no RNG in tick). Ranked by survival time.
export class Sumo implements MiniGame<SumoState, SumoInput> {
  readonly id = 'sumo-push'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SumoState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const n = ctx.players.length
    const offset = ctx.random.next() * Math.PI * 2
    const bodies = new Map<PlayerId, Body>()
    ctx.players.forEach((pid, i) => {
      const angle = offset + (i / Math.max(1, n)) * Math.PI * 2
      bodies.set(pid, {
        x: CENTER + Math.cos(angle) * SPAWN_R,
        y: CENTER + Math.sin(angle) * SPAWN_R,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        alive: true,
        outAt: 0,
      })
    })
    return { players: [...ctx.players], bodies, startedAt: ctx.now, endsAt: ctx.now + durationMs }
  }

  onInput(state: SumoState, playerId: PlayerId, input: SumoInput, now: number): SumoState {
    if (input.kind !== 'move') return state
    if (now < state.startedAt || now >= state.endsAt) return state
    const body = state.bodies.get(playerId)
    if (!body || !body.alive) return state
    const { dx, dy } = input
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx + dy)) return state
    const mag = Math.hypot(dx, dy)
    if (mag < 0.001) {
      body.ax = 0
      body.ay = 0
    } else {
      body.ax = dx / mag
      body.ay = dy / mag
    }
    return state
  }

  tick(state: SumoState, dt: number, now: number): SumoState {
    const step = dt / 1000
    const live = state.players.map((p) => state.bodies.get(p)).filter((b): b is Body => !!b?.alive)
    // Integrate motion.
    for (const b of live) {
      b.vx = (b.vx + b.ax * ACCEL * step) * Math.max(0, 1 - FRICTION * step)
      b.vy = (b.vy + b.ay * ACCEL * step) * Math.max(0, 1 - FRICTION * step)
      const sp = Math.hypot(b.vx, b.vy)
      if (sp > MAX_SPEED) {
        b.vx = (b.vx / sp) * MAX_SPEED
        b.vy = (b.vy / sp) * MAX_SPEED
      }
      b.x += b.vx * step
      b.y += b.vy * step
    }
    // Pairwise collisions (n ≤ 10).
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        this.collide(live[i] as Body, live[j] as Body)
      }
    }
    // Ring eliminations.
    for (const b of live) {
      if (Math.hypot(b.x - CENTER, b.y - CENTER) > RING_R) {
        b.alive = false
        b.outAt = now
      }
    }
    return state
  }

  private collide(a: Body, b: Body): void {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy)
    const min = PLAYER_R * 2
    if (d <= 0 || d >= min) return
    const nx = dx / d
    const ny = dy / d
    // Separate the overlap so bodies don't stick.
    const overlap = (min - d) / 2
    a.x -= nx * overlap
    a.y -= ny * overlap
    b.x += nx * overlap
    b.y += ny * overlap
    // Exchange the normal velocity components only when they are approaching.
    const va = a.vx * nx + a.vy * ny
    const vb = b.vx * nx + b.vy * ny
    if (va - vb <= 0) return
    const imp = (vb - va) * RESTITUTION
    a.vx += imp * nx
    a.vy += imp * ny
    b.vx -= imp * nx
    b.vy -= imp * ny
  }

  isFinished(state: SumoState, now: number): boolean {
    const alive = state.players.filter((p) => state.bodies.get(p)?.alive).length
    return now >= state.endsAt || alive <= 1
  }

  private survival(state: SumoState, pid: PlayerId): number {
    const b = state.bodies.get(pid)
    if (!b) return 0
    return (b.alive ? state.endsAt : b.outAt) - state.startedAt
  }

  getResult(state: SumoState): NormalizedResult {
    const sorted = [...state.players].sort(
      (x, y) => this.survival(state, y) - this.survival(state, x),
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

  snapshot(state: SumoState, now: number): SumoSnapshot {
    const bodies = state.players.map((pid) => {
      const b = state.bodies.get(pid) as Body
      return { id: pid, x: b.x, y: b.y, alive: b.alive }
    })
    return { ring: RING_R, bodies, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
