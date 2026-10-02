import { SUMO_ICE, type SumoIceInput, type SumoIceSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 45_000
const CENTER = 0.5
const R = SUMO_ICE.playerR
const SPAWN_R = 0.24
// Ice: weak grip and almost no friction, so every shove sends you sliding.
const ACCEL = 1.1
const MAX_SPEED = 0.6
const FRICTION = 0.55
const RESTITUTION = 1.3
// The melt: nothing goes for the first seconds; the floe is down to its core a little before the end,
// with the core itself (tiles within CORE_R of the centre) never melting.
const MELT_START_MS = 6000
const FINAL_FIGHT_MS = 8000
const CORE_R = 0.12
const JITTER = 0.28 // how far out of edge-first order a tile may melt (fraction of the radius)

interface Body {
  id: PlayerId
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
  alive: boolean
  outAt: number
  lives: number
  // Just fished out: no collisions until then (so a respawn on a crowded core doesn't explode).
  ghostUntil: number
  rescues: number
}

export interface SumoIceState {
  players: PlayerId[]
  bodies: Map<PlayerId, Body>
  // Per tile (row-major): when it starts cracking / sinks; Infinity = never (core); -1 = no tile.
  crackAt: number[]
  meltAt: number[]
  startedAt: number
  endsAt: number
}

const N = SUMO_ICE.grid
const tileCentre = (i: number): [number, number] => [
  ((i % N) + 0.5) / N,
  (Math.floor(i / N) + 0.5) / N,
]

// Real-time FFA sumo on a melting ice floe. Deterministic: spawn spin and the whole melt schedule are
// drawn from the seeded Random at init; tick is pure physics plus the floe's time-driven state.
export class SumoIce implements MiniGame<SumoIceState, SumoIceInput> {
  readonly id = 'sumo-ice'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SumoIceState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const rng = (): number => ctx.random.next()
    const n = ctx.players.length
    const spin = rng() * Math.PI * 2
    const bodies = new Map<PlayerId, Body>()
    ctx.players.forEach((id, i) => {
      const a = spin + (i / Math.max(1, n)) * Math.PI * 2
      const x = CENTER + Math.cos(a) * SPAWN_R
      const y = CENTER + Math.sin(a) * SPAWN_R
      bodies.set(id, {
        id,
        x,
        y,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        alive: true,
        outAt: 0,
        lives: SUMO_ICE.lives,
        ghostUntil: 0,
        rescues: 0,
      })
    })
    // Melt order: edge first, shuffled by a seeded jitter so the floe breaks up irregularly.
    const crackAt = new Array<number>(N * N).fill(-1)
    const meltAt = new Array<number>(N * N).fill(-1)
    const meltable: { i: number; key: number }[] = []
    for (let i = 0; i < N * N; i++) {
      const [x, y] = tileCentre(i)
      const d = Math.hypot(x - CENTER, y - CENTER)
      const jitter = rng()
      if (d > SUMO_ICE.floeR) continue
      if (d < CORE_R) {
        crackAt[i] = Number.POSITIVE_INFINITY
        meltAt[i] = Number.POSITIVE_INFINITY
        continue
      }
      meltable.push({ i, key: 1 - d / SUMO_ICE.floeR + jitter * JITTER })
    }
    meltable.sort((a, b) => a.key - b.key || a.i - b.i)
    const span = Math.max(1000, durationMs - MELT_START_MS - SUMO_ICE.crackMs - FINAL_FIGHT_MS)
    meltable.forEach(({ i }, k) => {
      const t =
        ctx.now + MELT_START_MS + SUMO_ICE.crackMs + Math.round((k / meltable.length) * span)
      meltAt[i] = t
      crackAt[i] = t - SUMO_ICE.crackMs
    })
    return {
      players: [...ctx.players],
      bodies,
      crackAt,
      meltAt,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(state: SumoIceState, playerId: PlayerId, input: SumoIceInput, now: number): SumoIceState {
    if (input.kind !== 'move' || now >= state.endsAt) return state
    const b = state.bodies.get(playerId)
    if (!b?.alive) return state
    const { dx, dy } = input
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx + dy)) return state
    const mag = Math.hypot(dx, dy)
    b.ax = mag < 0.001 ? 0 : dx / mag
    b.ay = mag < 0.001 ? 0 : dy / mag
    return state
  }

  tick(state: SumoIceState, dt: number, now: number): SumoIceState {
    const step = dt / 1000
    const live = state.players.map((p) => state.bodies.get(p)).filter((b): b is Body => !!b?.alive)
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
    const solid = live.filter((b) => now >= b.ghostUntil)
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) this.collide(solid[i] as Body, solid[j] as Body)
    }
    // Into the water: the tile under a body's centre is gone (or there never was one).
    for (const b of live) {
      if (this.solidAt(state, b.x, b.y, now)) continue
      b.lives -= 1
      if (b.lives > 0) this.rescue(b, now)
      else {
        b.alive = false
        b.outAt = now
      }
    }
    return state
  }

  // The lifebuoy: back onto the never-melting core, at rest, a ghost for a moment. Successive rescues
  // land on different spots around the centre (deterministic from the rescue count and the body).
  private rescue(b: Body, now: number): void {
    b.rescues += 1
    const a = (b.rescues * 2.4 + b.id.length) % (Math.PI * 2)
    b.x = CENTER + Math.cos(a) * 0.03
    b.y = CENTER + Math.sin(a) * 0.03
    b.vx = 0
    b.vy = 0
    b.ghostUntil = now + SUMO_ICE.ghostMs
  }

  private solidAt(state: SumoIceState, x: number, y: number, now: number): boolean {
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return false
    const i = Math.floor(y * N) * N + Math.floor(x * N)
    const melt = state.meltAt[i] ?? -1
    return melt !== -1 && now < melt
  }

  private collide(a: Body, b: Body): void {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy)
    const min = R * 2
    if (d <= 0 || d >= min) return
    const nx = dx / d
    const ny = dy / d
    const overlap = (min - d) / 2
    a.x -= nx * overlap
    a.y -= ny * overlap
    b.x += nx * overlap
    b.y += ny * overlap
    const va = a.vx * nx + a.vy * ny
    const vb = b.vx * nx + b.vy * ny
    if (va - vb <= 0) return
    const imp = (vb - va) * RESTITUTION
    a.vx += imp * nx
    a.vy += imp * ny
    b.vx -= imp * nx
    b.vy -= imp * ny
  }

  isFinished(state: SumoIceState, now: number): boolean {
    const alive = state.players.filter((p) => state.bodies.get(p)?.alive).length
    return now >= state.endsAt || alive === 0 || (state.players.length > 1 && alive <= 1)
  }

  private survival(state: SumoIceState, pid: PlayerId): number {
    const b = state.bodies.get(pid)
    if (!b) return 0
    return (b.alive ? state.endsAt : b.outAt) - state.startedAt
  }

  getResult(state: SumoIceState): NormalizedResult {
    const sorted = [...state.players].sort(
      (x, y) => this.survival(state, y) - this.survival(state, x),
    )
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((id, i) => {
      const prev = sorted[i - 1]
      const v = this.survival(state, id)
      ranks[id] = prev !== undefined && this.survival(state, prev) === v ? (ranks[prev] ?? i) : i
      stats[id] = `${Math.round(v / 1000)}s`
    })
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: SumoIceState, now: number): SumoIceSnapshot {
    let tiles = ''
    for (let i = 0; i < N * N; i++) {
      const melt = state.meltAt[i] ?? -1
      const crack = state.crackAt[i] ?? -1
      tiles += melt === -1 || now >= melt ? '.' : now >= crack ? '%' : '#'
    }
    return {
      tiles,
      bodies: state.players.map((id) => {
        const b = state.bodies.get(id) as Body
        return { id, x: b.x, y: b.y, alive: b.alive, lives: b.lives, ghost: now < b.ghostUntil }
      }),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
