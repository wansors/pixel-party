import {
  ROOM_RUSH,
  type RoomRushInput,
  type RoomRushPhase,
  type RoomRushSnapshot,
  roomRushSlotAngle,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 75_000
const CENTER = 0.5
const R = ROOM_RUSH.playerR
// Movement (normalized arena units): sumo-style steering with bouncy body-to-body collisions.
const ACCEL = 1.6
const MAX_SPEED = 0.42
const FRICTION = 2.6
const RESTITUTION = 1.2
const WALL_BOUNCE = 0.3
const DASH_SPEED = 0.85
const DASH_COOLDOWN_MS = 1000
const DASH_MS = 250 // a dash may exceed the steering speed cap this long (friction bleeds it off)
const SUBSTEPS = 4 // keeps a dashing body (≤ 0.011 per substep) from tunnelling through a wall
const OMEGA = 0.45 // carousel spin (rad/s)
const FIRST_MUSIC_MS = 4000
const MUSIC_MS = [3800, 5600] as const
const CALL_MS = 6500
const REVEAL_MS = 1600
const SPAWN_R = 0.1

type Seg = readonly [number, number, number, number]

// Fixed room geometry per slot: three walls + the two halves of the inner wall (the door gap between
// them faces the centre), and the door that closes the gap.
const ROOMS = Array.from({ length: ROOM_RUSH.slots }, (_, slot) => {
  const a = roomRushSlotAngle(slot)
  const u = [Math.cos(a), Math.sin(a)] as const
  const v = [-Math.sin(a), Math.cos(a)] as const
  const c = [CENTER + ROOM_RUSH.roomR * u[0], CENTER + ROOM_RUSH.roomR * u[1]] as const
  const h = ROOM_RUSH.half
  const P = (su: number, sv: number): [number, number] => [
    c[0] + su * u[0] + sv * v[0],
    c[1] + su * u[1] + sv * v[1],
  ]
  const seg = (p: [number, number], q: [number, number]): Seg => [p[0], p[1], q[0], q[1]]
  const d = ROOM_RUSH.door
  return {
    c,
    u,
    v,
    walls: [
      seg(P(h, -h), P(h, h)),
      seg(P(-h, -h), P(h, -h)),
      seg(P(-h, h), P(h, h)),
      seg(P(-h, -h), P(-h, -d)),
      seg(P(-h, d), P(-h, h)),
    ],
    door: seg(P(-h, -d), P(-h, d)),
  }
})

interface Body {
  id: PlayerId
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
  // Last non-zero steering direction (the dash goes this way when the stick is idle).
  fx: number
  fy: number
  alive: boolean
  safe: boolean
  outAt: number
  outCall: number
  dashReadyAt: number
  dashUntil: number
}

interface Room {
  slot: number
  count: number
  holdMs: number
  locked: boolean
}

export interface RoomRushState {
  bodies: Body[]
  phase: RoomRushPhase
  phaseFrom: number
  phaseEndsAt: number
  call: number
  n: number
  rooms: Room[]
  carouselAngle: number
  outThisCall: PlayerId[]
  // mulberry32 state, seeded from the round's Random at init (calls are drawn as the round unfolds).
  rng: number
  done: boolean
  endedAt: number
  startedAt: number
  endsAt: number
}

function nextRand(state: RoomRushState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0
  let t = state.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Real-time FFA elimination ("Mingle"). Deterministic: a mulberry32 stream seeded from the round's
// Random draws every call (music length, the number, which rooms open, spawn spin); physics is pure
// integration of `dt`. Ranked by elimination order — survivors share 1st, a call's victims tie.
export class RoomRush implements MiniGame<RoomRushState, RoomRushInput> {
  readonly id = 'room-rush'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): RoomRushState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const state: RoomRushState = {
      bodies: ctx.players.map((id) => ({
        id,
        x: CENTER,
        y: CENTER,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        fx: 0,
        fy: -1,
        alive: true,
        safe: false,
        outAt: 0,
        outCall: 0,
        dashReadyAt: 0,
        dashUntil: 0,
      })),
      phase: 'music',
      phaseFrom: ctx.now,
      phaseEndsAt: ctx.now + FIRST_MUSIC_MS,
      call: 1,
      n: 0,
      rooms: [],
      carouselAngle: 0,
      outThisCall: [],
      rng: Math.floor(ctx.random.next() * 4294967296) | 0,
      done: false,
      endedAt: 0,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
    this.spawn(state)
    return state
  }

  onInput(
    state: RoomRushState,
    playerId: PlayerId,
    input: RoomRushInput,
    now: number,
  ): RoomRushState {
    if (state.done || now >= state.endsAt) return state
    const b = state.bodies.find((x) => x.id === playerId)
    if (!b?.alive) return state
    if (input.kind === 'move') {
      if (!isNum(input.dx) || !isNum(input.dy)) return state
      const mag = Math.hypot(input.dx, input.dy)
      b.ax = mag < 0.001 ? 0 : input.dx / mag
      b.ay = mag < 0.001 ? 0 : input.dy / mag
      if (mag >= 0.001) {
        b.fx = b.ax
        b.fy = b.ay
      }
    } else if (input.kind === 'dash') {
      if (now < b.dashReadyAt || state.phase === 'reveal') return state
      const [dx, dy] = b.ax || b.ay ? [b.ax, b.ay] : [b.fx, b.fy]
      b.vx = dx * DASH_SPEED
      b.vy = dy * DASH_SPEED
      b.dashReadyAt = now + DASH_COOLDOWN_MS
      b.dashUntil = now + DASH_MS
    }
    return state
  }

  tick(state: RoomRushState, dt: number, now: number): RoomRushState {
    if (state.done) return state
    if (now >= state.endsAt) {
      this.finish(state, state.endsAt)
      return state
    }
    this.physics(state, dt / 1000, now)
    if (state.phase === 'call') this.updateRooms(state, dt)
    if (now >= state.phaseEndsAt || (state.phase === 'call' && this.allLocked(state))) {
      this.advance(state, now)
    }
    return state
  }

  isFinished(state: RoomRushState, now: number): boolean {
    return state.done || now >= state.endsAt
  }

  getResult(state: RoomRushState): NormalizedResult {
    // Survivors first (they share the top spot), then by the call they fell in, latest first.
    const score = (b: Body): number => (b.alive ? Number.POSITIVE_INFINITY : b.outCall)
    const sorted = [...state.bodies].sort((a, b) => score(b) - score(a))
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    const end = state.done ? state.endedAt : state.endsAt
    sorted.forEach((b, i) => {
      const prev = sorted[i - 1]
      ranks[b.id] = prev && score(prev) === score(b) ? (ranks[prev.id] ?? i) : i
      stats[b.id] = `${Math.round(((b.alive ? end : b.outAt) - state.startedAt) / 1000)}s`
    })
    return { placements: sorted.map((b) => b.id), ranks, stats }
  }

  snapshot(state: RoomRushState, now: number): RoomRushSnapshot {
    return {
      phase: state.phase,
      phaseMs: Math.max(0, state.phaseEndsAt - now),
      phaseTotalMs: state.phaseEndsAt - state.phaseFrom,
      call: state.call,
      n: state.n,
      carouselAngle: state.carouselAngle,
      rooms: state.rooms.map((r) => ({ ...r })),
      players: state.bodies.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        alive: b.alive,
        safe: b.safe,
        dashMs: Math.max(0, b.dashReadyAt - now),
      })),
      outThisCall: [...state.outThisCall],
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }

  // --- phases ---------------------------------------------------------------------------------------

  private advance(state: RoomRushState, now: number): void {
    state.phaseFrom = now
    if (state.phase === 'music') {
      this.openCall(state)
      state.phase = 'call'
      state.phaseEndsAt = now + CALL_MS
    } else if (state.phase === 'call') {
      this.buzzer(state, now)
      state.phase = 'reveal'
      state.phaseEndsAt = now + REVEAL_MS
    } else {
      const alive = state.bodies.filter((b) => b.alive).length
      if (alive === 0 || (alive === 1 && state.bodies.length > 1)) {
        this.finish(state, now)
        return
      }
      state.call += 1
      state.n = 0
      state.rooms = []
      state.outThisCall = []
      state.phase = 'music'
      state.phaseEndsAt =
        now + Math.round(MUSIC_MS[0] + nextRand(state) * (MUSIC_MS[1] - MUSIC_MS[0]))
      this.spawn(state)
    }
  }

  private finish(state: RoomRushState, at: number): void {
    state.done = true
    state.endedAt = at
  }

  // The number and the rooms: capacity rooms × N always stays below the survivor count.
  private openCall(state: RoomRushState): void {
    const alive = state.bodies.filter((b) => b.alive).length
    const maxN = Math.max(1, Math.min(4, alive - 1))
    const n = 1 + Math.floor(nextRand(state) * maxN)
    const count = Math.max(1, Math.min(ROOM_RUSH.slots, Math.floor((alive - 1) / n)))
    const offset = Math.floor(nextRand(state) * ROOM_RUSH.slots)
    const slots = new Set<number>()
    for (let i = 0; i < count; i++) {
      slots.add((offset + Math.round((i * ROOM_RUSH.slots) / count)) % ROOM_RUSH.slots)
    }
    state.n = n
    state.rooms = [...slots]
      .sort((a, b) => a - b)
      .map((slot) => ({ slot, count: 0, holdMs: 0, locked: false }))
  }

  private buzzer(state: RoomRushState, now: number): void {
    state.outThisCall = []
    for (const b of state.bodies) {
      if (!b.alive) continue
      const room = state.rooms.find((r) => this.inside(b, r.slot))
      if (room && (room.locked || room.count === state.n)) {
        b.safe = true
        continue
      }
      b.alive = false
      b.outAt = now
      b.outCall = state.call
      state.outThisCall.push(b.id)
    }
  }

  // Survivors back onto the carousel, evenly around a small ring at a seeded spin.
  private spawn(state: RoomRushState): void {
    const live = state.bodies.filter((b) => b.alive)
    const spin = nextRand(state) * Math.PI * 2
    live.forEach((b, i) => {
      const a = spin + (i * Math.PI * 2) / Math.max(1, live.length)
      b.x = CENTER + Math.cos(a) * SPAWN_R
      b.y = CENTER + Math.sin(a) * SPAWN_R
      b.vx = 0
      b.vy = 0
      b.safe = false
    })
  }

  private updateRooms(state: RoomRushState, dt: number): void {
    for (const room of state.rooms) {
      if (room.locked) continue
      room.count = state.bodies.filter((b) => b.alive && this.inside(b, room.slot)).length
      room.holdMs = room.count === state.n ? room.holdMs + dt : 0
      if (room.holdMs >= ROOM_RUSH.lockMs) {
        room.holdMs = ROOM_RUSH.lockMs
        room.locked = true
        for (const b of state.bodies) if (b.alive && this.inside(b, room.slot)) b.safe = true
      }
    }
  }

  private allLocked(state: RoomRushState): boolean {
    return state.rooms.length > 0 && state.rooms.every((r) => r.locked)
  }

  private inside(b: Body, slot: number): boolean {
    const room = ROOMS[slot]
    if (!room) return false
    const px = b.x - room.c[0]
    const py = b.y - room.c[1]
    const lu = px * room.u[0] + py * room.u[1]
    const lv = px * room.v[0] + py * room.v[1]
    return Math.abs(lu) < ROOM_RUSH.half && Math.abs(lv) < ROOM_RUSH.half
  }

  // --- physics --------------------------------------------------------------------------------------

  private physics(state: RoomRushState, step: number, now: number): void {
    const live = state.bodies.filter((b) => b.alive)
    const open = new Set(
      state.phase === 'call' ? state.rooms.filter((r) => !r.locked).map((r) => r.slot) : [],
    )
    const walls: Seg[] = []
    ROOMS.forEach((room, slot) => {
      walls.push(...room.walls)
      if (!open.has(slot)) walls.push(room.door)
    })
    const h = step / SUBSTEPS
    const spin = OMEGA * h
    for (let s = 0; s < SUBSTEPS; s++) {
      state.carouselAngle = (state.carouselAngle + spin) % (Math.PI * 2)
      for (const b of live) {
        b.vx = (b.vx + b.ax * ACCEL * h) * Math.max(0, 1 - FRICTION * h)
        b.vy = (b.vy + b.ay * ACCEL * h) * Math.max(0, 1 - FRICTION * h)
        // Steering is capped at MAX_SPEED; a fresh dash may go faster for a moment.
        const cap = now < b.dashUntil ? DASH_SPEED : MAX_SPEED
        const sp = Math.hypot(b.vx, b.vy)
        if (sp > cap) {
          b.vx = (b.vx / sp) * cap
          b.vy = (b.vy / sp) * cap
        }
        b.x += b.vx * h
        b.y += b.vy * h
        // Riders on the carousel turn with it.
        const dx = b.x - CENTER
        const dy = b.y - CENTER
        const d = Math.hypot(dx, dy)
        if (d < ROOM_RUSH.carouselR) {
          const c = Math.cos(spin)
          const sn = Math.sin(spin)
          b.x = CENTER + dx * c - dy * sn
          b.y = CENTER + dx * sn + dy * c
        }
        // During the music everyone stays on the carousel.
        if (state.phase === 'music') {
          const lim = ROOM_RUSH.carouselR - R * 0.5
          const d2 = Math.hypot(b.x - CENTER, b.y - CENTER)
          if (d2 > lim) {
            const nx = (b.x - CENTER) / d2
            const ny = (b.y - CENTER) / d2
            b.x = CENTER + nx * lim
            b.y = CENTER + ny * lim
            const vn = b.vx * nx + b.vy * ny
            if (vn > 0) {
              b.vx -= vn * nx
              b.vy -= vn * ny
            }
          }
        }
      }
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) this.collide(live[i] as Body, live[j] as Body)
      }
      for (const b of live) {
        for (const w of walls) this.wall(b, w)
        this.bounds(b)
      }
    }
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

  private wall(b: Body, [ax, ay, bx, by]: Seg): void {
    const ex = bx - ax
    const ey = by - ay
    const len2 = ex * ex + ey * ey
    const t = Math.max(0, Math.min(1, ((b.x - ax) * ex + (b.y - ay) * ey) / len2))
    const px = ax + t * ex
    const py = ay + t * ey
    let dx = b.x - px
    let dy = b.y - py
    let d = Math.hypot(dx, dy)
    if (d >= R) return
    if (d < 1e-9) {
      // Dead centre on the wall: push along its normal.
      const l = Math.sqrt(len2)
      dx = -ey / l
      dy = ex / l
      d = 1
    }
    const nx = dx / d
    const ny = dy / d
    const push = R - Math.min(d, R)
    b.x += nx * push
    b.y += ny * push
    const vn = b.vx * nx + b.vy * ny
    if (vn < 0) {
      b.vx -= (1 + WALL_BOUNCE) * vn * nx
      b.vy -= (1 + WALL_BOUNCE) * vn * ny
    }
  }

  private bounds(b: Body): void {
    if (b.x < R) {
      b.x = R
      b.vx = Math.abs(b.vx) * WALL_BOUNCE
    } else if (b.x > 1 - R) {
      b.x = 1 - R
      b.vx = -Math.abs(b.vx) * WALL_BOUNCE
    }
    if (b.y < R) {
      b.y = R
      b.vy = Math.abs(b.vy) * WALL_BOUNCE
    } else if (b.y > 1 - R) {
      b.y = 1 - R
      b.vy = -Math.abs(b.vy) * WALL_BOUNCE
    }
  }
}
