import type { SumoInput, SumoSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 30_000
const CENTER = 0.5
// The ring holds its size for the first SHRINK_FROM of the round, then closes in linearly to RING_END —
// narrower than a wrestler, so even a bout of centre-huggers ends with one left.
const RING_R = 0.42
const RING_END = 0.04
const SHRINK_FROM = 0.4
const PLAYER_R = 0.05
const SPAWN_R = 0.22 // players start on a circle this far from the centre
const ACCEL = 1.4 // normalized units / s²
// Top speed under your own steam. A shove or a dash can carry you faster (friction bleeds it off), up
// to HARD_MAX_SPEED.
const MAX_SPEED = 0.7
const HARD_MAX_SPEED = 1.4
// Collisions swap the bodies' approach speeds (equal masses, elastic): a dash's momentum goes into the
// one it hits. Above 1 they'd add energy, and two dashers would launch each other out.
const RESTITUTION = 1.0
const FRICTION = 2.0 // velocity decay coefficient (per second)
// Dash: a burst to DASH_SPEED toward where you push, once per DASH_COOLDOWN_MS — the way to knock a
// centre-holder out (and to fly out yourself if you miss). DASH_MS is how long it shows as a dash.
const DASH_SPEED = 1.2
export const DASH_COOLDOWN_MS = 1500
const DASH_MS = 250

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
  dashAt: number // ms of the last dash (0 = never)
}

export interface SumoState {
  players: PlayerId[]
  bodies: Map<PlayerId, Body>
  startedAt: number
  endsAt: number
}

// Real-time FFA sumo arena. Deterministic: initial ring positions use one seeded rotation offset, then
// all motion is pure physics driven by `dt`/`now` (no RNG in tick). The ring shrinks over the round and
// a dash can launch anyone out of it, so holding the centre isn't a lock. Ranked by survival time.
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
        dashAt: 0,
      })
    })
    return { players: [...ctx.players], bodies, startedAt: ctx.now, endsAt: ctx.now + durationMs }
  }

  // The ring's radius at `now`.
  ringAt(state: SumoState, now: number): number {
    const span = state.endsAt - state.startedAt
    const progress = span > 0 ? (now - state.startedAt) / span : 0
    const shrink = Math.max(0, Math.min(1, (progress - SHRINK_FROM) / (1 - SHRINK_FROM)))
    return RING_R + (RING_END - RING_R) * shrink
  }

  onInput(state: SumoState, playerId: PlayerId, input: SumoInput, now: number): SumoState {
    if (now < state.startedAt || now >= state.endsAt) return state
    const body = state.bodies.get(playerId)
    if (!body || !body.alive) return state
    if (input.kind === 'dash') return this.dash(state, body, now)
    if (input.kind !== 'move') return state
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

  // Launch toward where the player is pushing, cooldown permitting (no push direction, no dash).
  private dash(state: SumoState, body: Body, now: number): SumoState {
    if (body.dashAt > 0 && now - body.dashAt < DASH_COOLDOWN_MS) return state
    if (body.ax === 0 && body.ay === 0) return state
    body.vx = body.ax * DASH_SPEED
    body.vy = body.ay * DASH_SPEED
    body.dashAt = now
    return state
  }

  tick(state: SumoState, dt: number, now: number): SumoState {
    const step = dt / 1000
    const live = state.players.map((p) => state.bodies.get(p)).filter((b): b is Body => !!b?.alive)
    // Integrate motion. Steering can't push you past MAX_SPEED, but momentum from a dash or a shove
    // isn't clipped to it — friction bleeds it off.
    for (const b of live) {
      const before = Math.hypot(b.vx, b.vy)
      b.vx += b.ax * ACCEL * step
      b.vy += b.ay * ACCEL * step
      const sp = Math.hypot(b.vx, b.vy)
      const cap = Math.min(HARD_MAX_SPEED, Math.max(MAX_SPEED, before))
      if (sp > cap) {
        b.vx = (b.vx / sp) * cap
        b.vy = (b.vy / sp) * cap
      }
      const drag = Math.max(0, 1 - FRICTION * step)
      b.vx *= drag
      b.vy *= drag
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
    const ring = this.ringAt(state, now)
    for (const b of live) {
      if (Math.hypot(b.x - CENTER, b.y - CENTER) > ring) {
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

  // A wrestler whose player is gone steps out of the ring: the bout carries on without a statue in it.
  leave(state: SumoState, playerId: PlayerId, now: number): SumoState {
    const body = state.bodies.get(playerId)
    if (body?.alive) {
      body.alive = false
      body.outAt = now
    }
    return state
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
      const dashing = b.dashAt > 0 && now - b.dashAt < DASH_MS
      return { id: pid, x: b.x, y: b.y, alive: b.alive, dashing }
    })
    return {
      ring: this.ringAt(state, now),
      bodies,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
