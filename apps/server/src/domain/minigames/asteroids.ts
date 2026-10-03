import {
  ASTEROIDS,
  type AsteroidsBullet,
  type AsteroidsInput,
  type AsteroidsRock,
  type AsteroidsSnapshot,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
const W = ASTEROIDS.w
const H = ASTEROIDS.h
const THRUST = 0.95
const DRAG = 0.35
const MAX_SPEED = 0.75
const FIRE_MS = 220
const MAX_BULLETS = 4
const ROCK_SPEED = [0, 0.22, 0.15, 0.09] as const
// The field is topped up with a big rock (seeded edge spot) whenever its "mass" (big 4 · medium 2 ·
// small 1) drops below MIN_MASS, at most every REFILL_MS. Tuned for up to TUNED_SHIPS pilots; a bigger
// field scales the start rocks, the mass floor and the refill rate with it, so rocks per pilot hold.
const MIN_MASS = 16
const REFILL_MS = 1800
const START_ROCKS = 6
const TUNED_SHIPS = 4
const SPAWN_R = 0.28

interface Ship {
  id: PlayerId
  idx: number
  x: number
  y: number
  vx: number
  vy: number
  a: number
  rot: -1 | 0 | 1
  thrust: boolean
  fire: boolean
  alive: boolean
  respawnAt: number
  shieldUntil: number
  nextFireAt: number
  score: number
  kills: number
  // Parked until its pilot first touches the controls: a ghost that bullets and rocks pass through
  // (an AFK seat is no free kill, and no obstacle either).
  piloted: boolean
  // Left the round: gone from the sky for good.
  gone: boolean
}

interface Rock {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  size: number
}

interface Bullet {
  owner: number
  x: number
  y: number
  vx: number
  vy: number
  dieAt: number
}

export interface AsteroidsState {
  ships: Ship[]
  rocks: Rock[]
  bullets: Bullet[]
  nextRockId: number
  lastRefillAt: number
  // Rock supply for this field size (see MIN_MASS).
  minMass: number
  refillMs: number
  // mulberry32 state, seeded from the round's Random at init (splits and refills draw from it).
  rng: number
  startedAt: number
  endsAt: number
}

function nextRand(state: AsteroidsState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0
  let t = state.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const wrap = (v: number, size: number): number => ((v % size) + size) % size
// Shortest offset between two coordinates on a wrapping axis.
const delta = (d: number, size: number): number => d - size * Math.round(d / size)
const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(delta(ax - bx, W), delta(ay - by, H))
const round = (v: number): number => Math.round(v * 1000) / 1000

// Distance from a circle centre to a segment (start + v), on the wrapped plane.
function segDist(sx: number, sy: number, vx: number, vy: number, cx: number, cy: number): number {
  const dx = delta(cx - sx, W)
  const dy = delta(cy - sy, H)
  const len2 = vx * vx + vy * vy
  const t = len2 > 0 ? Math.max(0, Math.min(1, (dx * vx + dy * vy) / len2)) : 0
  return Math.hypot(dx - vx * t, dy - vy * t)
}

// Real-time FFA Asteroids in one shared, wrapping arena. Deterministic: the start field and a mulberry32
// stream (seeded from the round's Random) drive every split, refill and respawn spot; the rest is pure
// integration of `dt`. Ranked by score (rocks + rivals shot).
export class Asteroids implements MiniGame<AsteroidsState, AsteroidsInput> {
  readonly id = 'asteroids'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): AsteroidsState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const n = ctx.players.length
    const crowd = Math.max(1, n / TUNED_SHIPS)
    const state: AsteroidsState = {
      ships: ctx.players.map((id, idx) => {
        const a = (idx / Math.max(1, n)) * Math.PI * 2
        return {
          id,
          idx,
          x: W / 2 + Math.cos(a) * SPAWN_R,
          y: H / 2 + Math.sin(a) * SPAWN_R,
          vx: 0,
          vy: 0,
          a,
          rot: 0,
          thrust: false,
          fire: false,
          alive: true,
          respawnAt: 0,
          shieldUntil: ctx.now + ASTEROIDS.shieldMs,
          nextFireAt: 0,
          score: 0,
          kills: 0,
          piloted: false,
          gone: false,
        }
      }),
      rocks: [],
      bullets: [],
      nextRockId: 0,
      lastRefillAt: ctx.now,
      minMass: Math.round(MIN_MASS * Math.sqrt(crowd)),
      refillMs: Math.round(REFILL_MS / crowd),
      rng: Math.floor(ctx.random.next() * 4294967296) | 0,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
    for (let i = 0; i < Math.round(START_ROCKS * Math.sqrt(crowd)); i++) this.spawnRock(state)
    return state
  }

  onInput(
    state: AsteroidsState,
    playerId: PlayerId,
    input: AsteroidsInput,
    now: number,
  ): AsteroidsState {
    if (input.kind !== 'controls' || now >= state.endsAt) return state
    const s = state.ships.find((x) => x.id === playerId)
    if (!s || s.gone) return state
    if (input.rot === -1 || input.rot === 0 || input.rot === 1) s.rot = input.rot
    s.thrust = input.thrust === true
    s.fire = input.fire === true
    // Taking the controls for the first time unparks the ship, with a fresh spawn shield.
    if (!s.piloted && (s.rot !== 0 || s.thrust || s.fire)) {
      s.piloted = true
      s.shieldUntil = Math.max(s.shieldUntil, now + ASTEROIDS.shieldMs)
    }
    return state
  }

  // A pilot who left: the ship (and its bullets in flight) leave the sky; its score stands.
  leave(state: AsteroidsState, playerId: PlayerId, now: number): AsteroidsState {
    const s = state.ships.find((x) => x.id === playerId)
    if (!s || s.gone) return state
    this.explode(s, now)
    s.gone = true
    s.respawnAt = Number.POSITIVE_INFINITY
    state.bullets = state.bullets.filter((b) => b.owner !== s.idx)
    return state
  }

  tick(state: AsteroidsState, dt: number, now: number): AsteroidsState {
    const step = dt / 1000
    for (const s of state.ships) this.fly(state, s, step, now)
    for (const r of state.rocks) {
      r.x = wrap(r.x + r.vx * step, W)
      r.y = wrap(r.y + r.vy * step, H)
    }
    this.bullets(state, step, now)
    this.rams(state, now)
    const mass = state.rocks.reduce((m, r) => m + (r.size === 3 ? 4 : r.size === 2 ? 2 : 1), 0)
    if (mass < state.minMass && now - state.lastRefillAt >= state.refillMs) {
      state.lastRefillAt = now
      this.spawnRock(state)
    }
    return state
  }

  private fly(state: AsteroidsState, s: Ship, step: number, now: number): void {
    if (!s.alive) {
      if (now >= s.respawnAt) this.respawn(state, s, now)
      return
    }
    s.a += s.rot * ASTEROIDS.turn * step
    if (s.thrust) {
      s.vx += Math.cos(s.a) * THRUST * step
      s.vy += Math.sin(s.a) * THRUST * step
    }
    const drag = Math.max(0, 1 - DRAG * step)
    s.vx *= drag
    s.vy *= drag
    const sp = Math.hypot(s.vx, s.vy)
    if (sp > MAX_SPEED) {
      s.vx = (s.vx / sp) * MAX_SPEED
      s.vy = (s.vy / sp) * MAX_SPEED
    }
    s.x = wrap(s.x + s.vx * step, W)
    s.y = wrap(s.y + s.vy * step, H)
    const mine = state.bullets.filter((b) => b.owner === s.idx).length
    if (s.fire && now >= s.nextFireAt && mine < MAX_BULLETS) {
      s.nextFireAt = now + FIRE_MS
      const cos = Math.cos(s.a)
      const sin = Math.sin(s.a)
      state.bullets.push({
        owner: s.idx,
        x: wrap(s.x + cos * ASTEROIDS.shipR * 1.3, W),
        y: wrap(s.y + sin * ASTEROIDS.shipR * 1.3, H),
        vx: s.vx + cos * ASTEROIDS.bulletSpeed,
        vy: s.vy + sin * ASTEROIDS.bulletSpeed,
        dieAt: now + ASTEROIDS.bulletLifeMs,
      })
    }
  }

  // Bullets sweep their whole step (fast enough to skip a small rock otherwise): the first rock or
  // rival ship on the way takes the hit.
  private bullets(state: AsteroidsState, step: number, now: number): void {
    const kept: Bullet[] = []
    for (const b of state.bullets) {
      if (now >= b.dieAt) continue
      const mx = b.vx * step
      const my = b.vy * step
      const rock = state.rocks.find(
        (r) => segDist(b.x, b.y, mx, my, r.x, r.y) < (ASTEROIDS.rockR[r.size] ?? 0.03),
      )
      const owner = state.ships[b.owner]
      if (rock) {
        if (owner) owner.score += ASTEROIDS.rockPts[rock.size] ?? 0
        this.split(state, rock)
        continue
      }
      const victim = state.ships.find(
        (s) =>
          s.idx !== b.owner &&
          s.alive &&
          s.piloted &&
          now >= s.shieldUntil &&
          segDist(b.x, b.y, mx, my, s.x, s.y) < ASTEROIDS.shipR,
      )
      if (victim) {
        if (owner) {
          owner.score += ASTEROIDS.rivalPts
          owner.kills += 1
        }
        this.explode(victim, now)
        continue
      }
      b.x = wrap(b.x + mx, W)
      b.y = wrap(b.y + my, H)
      kept.push(b)
    }
    state.bullets = kept
  }

  // A ship flying into a rock blows up (and breaks the rock — no points for anyone).
  private rams(state: AsteroidsState, now: number): void {
    for (const s of state.ships) {
      if (!s.alive || !s.piloted || now < s.shieldUntil) continue
      const rock = state.rocks.find(
        (r) => dist(s.x, s.y, r.x, r.y) < ASTEROIDS.shipR + (ASTEROIDS.rockR[r.size] ?? 0.03) * 0.9,
      )
      if (!rock) continue
      this.explode(s, now)
      this.split(state, rock)
    }
  }

  private explode(s: Ship, now: number): void {
    s.alive = false
    s.respawnAt = now + ASTEROIDS.respawnMs
    s.vx = 0
    s.vy = 0
  }

  // Back at the safest of a few seeded spots (farthest from rocks and ships), shielded.
  private respawn(state: AsteroidsState, s: Ship, now: number): void {
    let best = { x: W / 2, y: H / 2, d: -1 }
    for (let i = 0; i < 8; i++) {
      const x = nextRand(state) * W
      const y = nextRand(state) * H
      let d = Number.POSITIVE_INFINITY
      for (const r of state.rocks)
        d = Math.min(d, dist(x, y, r.x, r.y) - (ASTEROIDS.rockR[r.size] ?? 0))
      for (const o of state.ships)
        if (o !== s && o.alive && o.piloted) d = Math.min(d, dist(x, y, o.x, o.y))
      if (d > best.d) best = { x, y, d }
    }
    s.x = best.x
    s.y = best.y
    s.vx = 0
    s.vy = 0
    s.alive = true
    s.shieldUntil = now + ASTEROIDS.shieldMs
  }

  private split(state: AsteroidsState, rock: Rock): void {
    state.rocks = state.rocks.filter((r) => r !== rock)
    if (rock.size <= 1) return
    const heading = Math.atan2(rock.vy, rock.vx)
    const speed = ROCK_SPEED[rock.size - 1] ?? 0.2
    for (const side of [-1, 1]) {
      const a = heading + side * (0.5 + nextRand(state) * 0.5)
      state.rocks.push({
        id: state.nextRockId++,
        x: rock.x,
        y: rock.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: rock.size - 1,
      })
    }
  }

  // A big rock at a seeded spot well away from every ship.
  private spawnRock(state: AsteroidsState): void {
    let best = { x: 0, y: 0, d: -1 }
    for (let i = 0; i < 6; i++) {
      const x = nextRand(state) * W
      const y = nextRand(state) * H
      let d = Number.POSITIVE_INFINITY
      for (const s of state.ships) if (s.alive && s.piloted) d = Math.min(d, dist(x, y, s.x, s.y))
      if (d > best.d) best = { x, y, d }
    }
    const a = nextRand(state) * Math.PI * 2
    state.rocks.push({
      id: state.nextRockId++,
      x: best.x,
      y: best.y,
      vx: Math.cos(a) * (ROCK_SPEED[3] ?? 0.09),
      vy: Math.sin(a) * (ROCK_SPEED[3] ?? 0.09),
      size: 3,
    })
  }

  isFinished(state: AsteroidsState, now: number): boolean {
    return now >= state.endsAt
  }

  getResult(state: AsteroidsState): NormalizedResult {
    const cmp = (x: Ship, y: Ship): number => y.score - x.score || y.kills - x.kills
    const sorted = [...state.ships].sort(cmp)
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((s, i) => {
      const prev = sorted[i - 1]
      ranks[s.id] = prev && cmp(prev, s) === 0 ? (ranks[prev.id] ?? i) : i
      stats[s.id] = `${s.score}`
    })
    return { placements: sorted.map((s) => s.id), ranks, stats }
  }

  snapshot(state: AsteroidsState, now: number): AsteroidsSnapshot {
    // Ships that left drop off the wire; bullets name their owner by index into the sent list.
    const ships = state.ships.filter((s) => !s.gone)
    const wireIdx = new Map(ships.map((s, i) => [s.idx, i]))
    return {
      ships: ships.map((s) => ({
        id: s.id,
        x: round(s.x),
        y: round(s.y),
        vx: round(s.vx),
        vy: round(s.vy),
        a: round(s.a),
        rot: s.rot,
        thrust: s.thrust && s.alive,
        alive: s.alive,
        shield: s.alive && s.piloted && now < s.shieldUntil,
        idle: !s.piloted,
        score: s.score,
        kills: s.kills,
      })),
      rocks: state.rocks.map(
        (r): AsteroidsRock => [r.id, round(r.x), round(r.y), round(r.vx), round(r.vy), r.size],
      ),
      bullets: state.bullets.map(
        (b): AsteroidsBullet => [
          round(b.x),
          round(b.y),
          round(b.vx),
          round(b.vy),
          wireIdx.get(b.owner) ?? -1,
        ],
      ),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
