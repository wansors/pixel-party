import { PANG, type PangBalloon, type PangInput, type PangSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 50_000
const G = PANG.gravity
const VX = PANG.vx
const SPLIT_VY = -0.55 // the little hop two halves get when a balloon splits
const WALK = PANG.walk
const HARPOON_SPEED = PANG.harpoonSpeed
const SHIELD_MS = 1500
const WAVE_GAP_MS = 1200
const WAVES = 12
const SPAWN_Y = 0.16

interface Balloon {
  x: number
  y: number
  vx: number
  vy: number
  size: number
}

interface WaveBalloon {
  x: number
  size: number
  dir: 1 | -1
}

interface Arena {
  id: PlayerId
  x: number
  dir: -1 | 0 | 1
  harpoon: { x: number; tip: number } | null
  balloons: Balloon[]
  pops: number
  lives: number
  shieldUntil: number
  wave: number
  // When the next wave drops in (0 = the current one is still being played).
  nextWaveAt: number
  out: boolean
  lastPopAt: number
}

export interface PangState {
  arenas: Arena[]
  waves: WaveBalloon[][]
  startedAt: number
  endsAt: number
}

const round = (v: number): number => Math.round(v * 1000) / 1000
const bounceVy = (size: number): number => -Math.sqrt(2 * G * (PANG.bounceH[size] ?? 0.2))

// Real-time FFA Pang. Deterministic: the wave list is drawn from the seeded Random at init and every
// player plays the same waves in their own arena; tick is pure physics on `dt`.
export class Pang implements MiniGame<PangState, PangInput> {
  readonly id = 'pang'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): PangState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const rng = (): number => ctx.random.next()
    const waves: WaveBalloon[][] = []
    for (let k = 0; k < WAVES; k++) {
      const wave: WaveBalloon[] = []
      const bigs = Math.min(3, 1 + Math.floor(k / 2))
      const mediums = k % 2 === 1 ? 1 + Math.floor(k / 4) : Math.floor(k / 4)
      for (let i = 0; i < bigs + mediums; i++) {
        wave.push({
          x: 0.12 + rng() * (PANG.w - 0.24),
          size: i < bigs ? 4 : 3,
          dir: rng() < 0.5 ? 1 : -1,
        })
      }
      waves.push(wave)
    }
    const state: PangState = {
      arenas: ctx.players.map((id) => ({
        id,
        x: PANG.w / 2,
        dir: 0,
        harpoon: null,
        balloons: [],
        pops: 0,
        lives: PANG.lives,
        shieldUntil: 0,
        wave: 0,
        nextWaveAt: 0,
        out: false,
        lastPopAt: 0,
      })),
      waves,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
    for (const a of state.arenas) this.spawnWave(state, a, 0)
    return state
  }

  private spawnWave(state: PangState, a: Arena, wave: number): void {
    const def = state.waves[Math.min(wave, state.waves.length - 1)] ?? []
    a.wave = wave
    a.nextWaveAt = 0
    a.balloons = def.map((b) => ({ x: b.x, y: SPAWN_Y, vx: VX * b.dir, vy: 0, size: b.size }))
  }

  onInput(state: PangState, playerId: PlayerId, input: PangInput, now: number): PangState {
    if (now >= state.endsAt) return state
    const a = state.arenas.find((x) => x.id === playerId)
    if (!a || a.out) return state
    if (input.kind === 'move') {
      if (input.dir === -1 || input.dir === 0 || input.dir === 1) a.dir = input.dir
    } else if (input.kind === 'fire' && !a.harpoon) {
      a.harpoon = { x: a.x, tip: PANG.h }
    }
    return state
  }

  tick(state: PangState, dt: number, now: number): PangState {
    const step = dt / 1000
    for (const a of state.arenas) {
      if (a.out) continue
      a.x = Math.max(
        PANG.playerHalfW,
        Math.min(PANG.w - PANG.playerHalfW, a.x + a.dir * WALK * step),
      )
      for (const b of a.balloons) this.move(b, step)
      this.harpoon(a, step, now)
      this.touch(a, now)
      if (a.balloons.length === 0) {
        if (a.nextWaveAt === 0) a.nextWaveAt = now + WAVE_GAP_MS
        else if (now >= a.nextWaveAt) this.spawnWave(state, a, a.wave + 1)
      }
    }
    return state
  }

  private move(b: Balloon, step: number): void {
    const r = PANG.radius[b.size] ?? 0.03
    b.vy += G * step
    b.x += b.vx * step
    b.y += b.vy * step
    if (b.x - r < 0) {
      b.x = r
      b.vx = Math.abs(b.vx)
    } else if (b.x + r > PANG.w) {
      b.x = PANG.w - r
      b.vx = -Math.abs(b.vx)
    }
    if (b.y + r > PANG.h) {
      b.y = PANG.h - r
      b.vy = bounceVy(b.size)
    } else if (b.y - r < 0) {
      b.y = r
      b.vy = Math.abs(b.vy)
    }
  }

  // The harpoon climbs from where it was fired; the wire (tip → floor) pops the first balloon it meets.
  private harpoon(a: Arena, step: number, now: number): void {
    const h = a.harpoon
    if (!h) return
    h.tip -= HARPOON_SPEED * step
    const hit = a.balloons.findIndex((b) => {
      const r = PANG.radius[b.size] ?? 0.03
      return Math.abs(b.x - h.x) < r && b.y + r > h.tip
    })
    if (hit !== -1) {
      const b = a.balloons[hit] as Balloon
      a.balloons.splice(hit, 1)
      if (b.size > 1) {
        for (const dir of [-1, 1]) {
          a.balloons.push({ x: b.x, y: b.y, vx: VX * dir, vy: SPLIT_VY, size: b.size - 1 })
        }
      }
      a.pops += 1
      a.lastPopAt = now
      a.harpoon = null
      return
    }
    if (h.tip <= 0) a.harpoon = null
  }

  // A balloon touching the player costs a life (unless still blinking from the last one).
  private touch(a: Arena, now: number): void {
    if (now < a.shieldUntil) return
    const left = a.x - PANG.playerHalfW
    const right = a.x + PANG.playerHalfW
    const top = PANG.h - PANG.playerH
    for (const b of a.balloons) {
      const r = PANG.radius[b.size] ?? 0.03
      const cx = Math.max(left, Math.min(right, b.x))
      const cy = Math.max(top, Math.min(PANG.h, b.y))
      if (Math.hypot(b.x - cx, b.y - cy) >= r) continue
      a.lives -= 1
      a.shieldUntil = now + SHIELD_MS
      if (a.lives <= 0) {
        a.out = true
        a.harpoon = null
        a.dir = 0
      }
      return
    }
  }

  isFinished(state: PangState, now: number): boolean {
    return now >= state.endsAt || state.arenas.every((a) => a.out)
  }

  getResult(state: PangState): NormalizedResult {
    // Most pops; then lives left; then whoever got there first.
    const cmp = (x: Arena, y: Arena): number =>
      y.pops - x.pops || y.lives - x.lives || x.lastPopAt - y.lastPopAt
    const sorted = [...state.arenas].sort(cmp)
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((a, i) => {
      const prev = sorted[i - 1]
      ranks[a.id] = prev && cmp(prev, a) === 0 ? (ranks[prev.id] ?? i) : i
      stats[a.id] = `${a.pops}`
    })
    return { placements: sorted.map((a) => a.id), ranks, stats }
  }

  snapshot(state: PangState, now: number): PangSnapshot {
    return {
      arenas: state.arenas.map((a) => ({
        id: a.id,
        x: round(a.x),
        harpoon: a.harpoon ? round(a.harpoon.tip) : null,
        harpoonX: a.harpoon ? round(a.harpoon.x) : null,
        balloons: a.balloons.map(
          (b): PangBalloon => [round(b.x), round(b.y), b.size, round(b.vx), round(b.vy)],
        ),
        pops: a.pops,
        lives: a.lives,
        shielded: now < a.shieldUntil,
        wave: a.wave,
        out: a.out,
      })),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
