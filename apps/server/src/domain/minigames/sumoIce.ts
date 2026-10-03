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
// with the core itself (tiles within CORE_R of the centre: 3×3 tiles) never melting. A big field gets a
// wider core (BIG_CORE_R: 13 tiles, one more on each side) so its final fight isn't pinball.
const MELT_START_MS = 6000
const FINAL_FIGHT_MS = 8000
const CORE_R = 0.12
const BIG_CORE_R = 0.16
const BIG_FIELD = 10
const JITTER = 0.28 // how far out of edge-first order a tile may melt (fraction of the radius)
// Lifebuoy drop: the clearest of RESCUE_SPOTS points this far from the centre (inside the 3×3 core).
const RESCUE_R = 0.06
const RESCUE_SPOTS = 8

interface Body {
  id: PlayerId
  // Seat angle (seeded spin + seat order): where this body spawned, and where its lifebuoy aims first.
  seat: number
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
// drawn from the seeded Random at init; tick is pure physics plus the floe's time-driven state. Ranked
// by survival time; among those still in at the buzzer, an unused lifebuoy ranks first.
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
        seat: a,
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
    const coreR = n >= BIG_FIELD ? BIG_CORE_R : CORE_R
    for (let i = 0; i < N * N; i++) {
      const [x, y] = tileCentre(i)
      const d = Math.hypot(x - CENTER, y - CENTER)
      const jitter = rng()
      if (d > SUMO_ICE.floeR) continue
      if (d < coreR) {
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
      if (b.lives > 0) this.rescue(b, live, now)
      else {
        b.alive = false
        b.outAt = now
      }
    }
    return state
  }

  // The lifebuoy: back onto the never-melting core, at rest, a ghost for a moment. It drops on the
  // clearest of a ring of spots around the centre (the ring starts at the body's own seat angle, so
  // ties break differently per player) — never on top of someone.
  private rescue(b: Body, live: Body[], now: number): void {
    b.rescues += 1
    let best = { x: CENTER, y: CENTER, gap: -1 }
    for (let k = 0; k < RESCUE_SPOTS; k++) {
      const a = b.seat + (k / RESCUE_SPOTS) * Math.PI * 2
      const x = CENTER + Math.cos(a) * RESCUE_R
      const y = CENTER + Math.sin(a) * RESCUE_R
      let gap = Number.POSITIVE_INFINITY
      for (const o of live)
        if (o !== b && o.alive) gap = Math.min(gap, Math.hypot(o.x - x, o.y - y))
      if (gap > best.gap + 1e-9) best = { x, y, gap }
    }
    b.x = best.x
    b.y = best.y
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
    if (d >= min) return
    // Exactly on top of each other: split them along x (deterministic) instead of never separating.
    const nx = d > 1e-9 ? dx / d : 1
    const ny = d > 1e-9 ? dy / d : 0
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

  // A player gone for good sinks for good (the engine ranks them last); last one dry still wins.
  leave(state: SumoIceState, playerId: PlayerId, now: number): SumoIceState {
    const b = state.bodies.get(playerId)
    if (!b?.alive) return state
    b.alive = false
    b.outAt = now
    return state
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
    const lives = (id: PlayerId): number => state.bodies.get(id)?.lives ?? 0
    const cmp = (x: PlayerId, y: PlayerId): number =>
      this.survival(state, y) - this.survival(state, x) || lives(y) - lives(x)
    const sorted = [...state.players].sort(cmp)
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((id, i) => {
      const prev = sorted[i - 1]
      ranks[id] = prev !== undefined && cmp(prev, id) === 0 ? (ranks[prev] ?? i) : i
      stats[id] = `${Math.round(this.survival(state, id) / 1000)}s`
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
