import {
  HONEYCOMB,
  HONEYCOMB_SHAPES,
  type HoneycombInput,
  type HoneycombShape,
  type HoneycombSnapshot,
  honeycombOutline,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 45_000
const CRACK_IMMUNE_MS = 600 // a crack doesn't chain into another one right away
// Continuous tracing: consecutive needle samples on the line cut every segment in between, as long as
// they are this close along the outline (a jump across the candy cuts nothing in between).
const MAX_SPAN = 12
const STRESS_PER_EXCESS = 3 // stress gained per (candy width / s over the limit) · s
const STRESS_RELAX = 0.8 // per second at a calm pace

interface Carver {
  id: PlayerId
  cut: boolean[]
  cracks: number
  broken: boolean
  doneAt: number | null
  lastSeg: number
  last: { x: number; y: number; t: number } | null
  stress: number
  lastCrackAt: number
}

export interface HoneycombState {
  shape: HoneycombShape
  outline: { x: number; y: number }[]
  carvers: Map<PlayerId, Carver>
  players: PlayerId[]
  startedAt: number
  endsAt: number
}

const isUnit = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

// Distance from a point to segment i of the closed outline.
function segDist(outline: { x: number; y: number }[], i: number, x: number, y: number): number {
  const a = outline[i] as { x: number; y: number }
  const b = outline[(i + 1) % outline.length] as { x: number; y: number }
  const ex = b.x - a.x
  const ey = b.y - a.y
  const len2 = ex * ex + ey * ey || 1
  const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2))
  return Math.hypot(x - a.x - ex * t, y - a.y - ey * t)
}

// FFA precision round (the dalgona candy). Deterministic: the seeded Random picks the shape; the rest is
// a pure function of the needle inputs.
export class HoneycombCut implements MiniGame<HoneycombState, HoneycombInput> {
  readonly id = 'honeycomb-cut'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): HoneycombState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const shape =
      HONEYCOMB_SHAPES[Math.floor(ctx.random.next() * HONEYCOMB_SHAPES.length)] ?? 'circle'
    const carvers = new Map<PlayerId, Carver>()
    for (const id of ctx.players) {
      carvers.set(id, {
        id,
        cut: new Array<boolean>(HONEYCOMB.segments).fill(false),
        cracks: 0,
        broken: false,
        doneAt: null,
        lastSeg: -1,
        last: null,
        stress: 0,
        lastCrackAt: Number.NEGATIVE_INFINITY,
      })
    }
    return {
      shape,
      outline: honeycombOutline(shape),
      carvers,
      players: [...ctx.players],
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(
    state: HoneycombState,
    playerId: PlayerId,
    input: HoneycombInput,
    now: number,
  ): HoneycombState {
    if (input?.kind !== 'needle' || now >= state.endsAt) return state
    const c = state.carvers.get(playerId)
    if (!c || c.broken || c.doneAt !== null) return state
    if (!isUnit(input.x) || !isUnit(input.y) || typeof input.down !== 'boolean') return state
    if (!input.down) {
      c.lastSeg = -1
      c.last = null
      return state
    }
    // Rushing the needle stresses the candy.
    if (c.last) {
      const dt = Math.max(16, now - c.last.t) / 1000
      const speed = Math.hypot(input.x - c.last.x, input.y - c.last.y) / dt
      c.stress = Math.max(
        0,
        c.stress +
          (speed > HONEYCOMB.maxSpeed
            ? (speed - HONEYCOMB.maxSpeed) * STRESS_PER_EXCESS * dt
            : -STRESS_RELAX * dt),
      )
    }
    c.last = { x: input.x, y: input.y, t: now }
    let seg = 0
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < state.outline.length; i++) {
      const d = segDist(state.outline, i, input.x, input.y)
      if (d < best) {
        best = d
        seg = i
      }
    }
    if (best > HONEYCOMB.crackTol || c.stress >= 1) {
      c.stress = 0
      c.lastSeg = -1
      this.crack(c, now)
      return state
    }
    if (best > HONEYCOMB.lineTol) {
      c.lastSeg = -1
      return state
    }
    // On the line: cut this segment, and the stretch back to the previous one if traced continuously.
    const n = state.outline.length
    c.cut[seg] = true
    if (c.lastSeg !== -1) {
      const fwd = (seg - c.lastSeg + n) % n
      const back = (c.lastSeg - seg + n) % n
      const span = Math.min(fwd, back)
      if (span <= MAX_SPAN) {
        const dir = fwd <= back ? 1 : -1
        for (let k = 0, i = c.lastSeg; k <= span; k++, i = (i + dir + n) % n) c.cut[i] = true
      }
    }
    c.lastSeg = seg
    if (c.cut.every(Boolean)) c.doneAt = now
    return state
  }

  private crack(c: Carver, now: number): void {
    if (now - c.lastCrackAt < CRACK_IMMUNE_MS) return
    c.lastCrackAt = now
    c.cracks += 1
    if (c.cracks >= HONEYCOMB.cracks) c.broken = true
  }

  isFinished(state: HoneycombState, now: number): boolean {
    if (now >= state.endsAt) return true
    return [...state.carvers.values()].every((c) => c.broken || c.doneAt !== null)
  }

  private progress(c: Carver): number {
    return c.cut.filter(Boolean).length / c.cut.length
  }

  getResult(state: HoneycombState): NormalizedResult {
    const group = (c: Carver): number => (c.doneAt !== null ? 0 : c.broken ? 2 : 1)
    const key = (c: Carver): number => (c.doneAt !== null ? c.doneAt : -this.progress(c))
    const sorted = [...state.carvers.values()].sort(
      (a, b) => group(a) - group(b) || key(a) - key(b),
    )
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((c, i) => {
      const prev = sorted[i - 1]
      const tied = prev && group(prev) === group(c) && key(prev) === key(c)
      ranks[c.id] = tied && prev ? (ranks[prev.id] ?? i) : i
      stats[c.id] =
        c.doneAt !== null
          ? `${((c.doneAt - state.startedAt) / 1000).toFixed(1)}s`
          : `${Math.floor(this.progress(c) * 100)}%`
    })
    return { placements: sorted.map((c) => c.id), ranks, stats }
  }

  snapshot(state: HoneycombState, now: number): HoneycombSnapshot {
    return {
      shape: state.shape,
      players: state.players.map((id) => {
        const c = state.carvers.get(id) as Carver
        return {
          id,
          cut: c.cut.map((b) => (b ? '1' : '0')).join(''),
          progress: Math.round(this.progress(c) * 1000) / 1000,
          cracks: c.cracks,
          broken: c.broken,
          doneMs: c.doneAt === null ? null : c.doneAt - state.startedAt,
        }
      }),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
