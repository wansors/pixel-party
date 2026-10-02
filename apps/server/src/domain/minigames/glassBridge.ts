import type {
  GlassBridgeInput,
  GlassBridgePhase,
  GlassBridgeSnapshot,
  GlassBridgeStatus,
  GlassSide,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 75_000
// Rows ≈ players + 2: every unknown row costs one fall half of the time (expected falls ≈ rows / 2),
// so roughly a third of the field makes it across (8 players → 10 rows → ~3 survivors).
const MIN_ROWS = 4
const MAX_ROWS = 12
const LEAD_IN_MS = 800 // #1 steps up to the bridge before the first jump timer starts
const DECIDE_MS = 4000 // jump timer per unknown row; hesitating past it forces a (seeded) jump
const JUMP_MS = 450
const FALL_MS = 1200
const WALK_STEP_MS = 160 // auto-walk pace across already-solved rows
// Lightning: a flash lights the bridge every few seconds (seeded); while lit (≥ 2 snapshots at the
// default cadence) the snapshot carries the tempered side of the row being decided.
const GLINT_MS = 320
const GLINT_FIRST_MS = [1800, 3400] as const
const GLINT_GAP_MS = [3000, 5600] as const

interface Runner {
  id: PlayerId
  vest: number
  status: GlassBridgeStatus
  pos: number
  // Rows stood on (the ranking measure); a crossed runner counts rows + 1.
  reached: number
}

export interface GlassBridgeState {
  order: PlayerId[]
  runners: Map<PlayerId, Runner>
  // Hidden truth: the tempered panel of each row. Only revealed rows go on the wire.
  safe: GlassSide[]
  revealed: boolean[]
  broken: (GlassSide | null)[]
  // Seeded side for a forced jump on each row (the jump timer ran out).
  forced: GlassSide[]
  glints: number[]
  active: PlayerId | null
  phase: GlassBridgePhase
  phaseEndsAt: number
  target: number | null
  jumpSide: GlassSide | null
  pointers: Map<PlayerId, GlassSide>
  startedAt: number
  endsAt: number
}

const side = (r: number): GlassSide => (r < 0.5 ? 'L' : 'R')
const isSide = (v: unknown): v is GlassSide => v === 'L' || v === 'R'
const between = (r: number, [lo, hi]: readonly [number, number]): number => lo + r * (hi - lo)

// Turn-based FFA elimination (Squid Game-style glass bridge). Deterministic: the vest order, the
// tempered panels, the forced-jump sides and the lightning schedule are all drawn from the seeded Random
// at init; tick only advances timers. Ranked by rows reached; everyone who crosses shares 1st.
export class GlassBridge implements MiniGame<GlassBridgeState, GlassBridgeInput> {
  readonly id = 'glass-bridge'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): GlassBridgeState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const rng = (): number => ctx.random.next()
    // Seeded Fisher–Yates over the round's players: vest #1 crosses first.
    const order = [...ctx.players]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j] as PlayerId, order[i] as PlayerId]
    }
    const rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, order.length + 2))
    const safe = Array.from({ length: rows }, () => side(rng()))
    const forced = Array.from({ length: rows }, () => side(rng()))
    const endsAt = ctx.now + durationMs
    const glints: number[] = []
    for (let t = ctx.now + between(rng(), GLINT_FIRST_MS); t < endsAt; ) {
      glints.push(Math.round(t))
      t += between(rng(), GLINT_GAP_MS)
    }
    const runners = new Map<PlayerId, Runner>()
    order.forEach((id, i) =>
      runners.set(id, { id, vest: i + 1, status: 'queue', pos: -1, reached: 0 }),
    )
    const state: GlassBridgeState = {
      order,
      runners,
      safe,
      revealed: safe.map(() => false),
      broken: safe.map(() => null),
      forced,
      glints,
      active: null,
      phase: 'walk',
      phaseEndsAt: ctx.now + LEAD_IN_MS,
      target: null,
      jumpSide: null,
      pointers: new Map(),
      startedAt: ctx.now,
      endsAt,
    }
    this.nextRunner(state, ctx.now, LEAD_IN_MS)
    return state
  }

  onInput(
    state: GlassBridgeState,
    playerId: PlayerId,
    input: GlassBridgeInput,
    now: number,
  ): GlassBridgeState {
    if (state.phase === 'done' || now >= state.endsAt) return state
    if (!state.runners.has(playerId)) return state
    if (input.kind === 'jump') {
      if (playerId !== state.active || state.phase !== 'decide' || !isSide(input.side)) return state
      this.jump(state, input.side, now)
    } else if (input.kind === 'point') {
      if (playerId === state.active) return state
      if (isSide(input.side)) state.pointers.set(playerId, input.side)
      else if (input.side === null) state.pointers.delete(playerId)
    }
    return state
  }

  tick(state: GlassBridgeState, _dt: number, now: number): GlassBridgeState {
    if (state.phase === 'done') return state
    if (now >= state.endsAt) {
      state.phase = 'done'
      return state
    }
    // A late tick may owe several steps (walk) — resolve every phase boundary that has passed.
    for (let guard = 0; guard < 64 && now >= state.phaseEndsAt; guard++) {
      this.advance(state, state.phaseEndsAt)
      if (this.isFinished(state, now)) break
    }
    return state
  }

  isFinished(state: GlassBridgeState, now: number): boolean {
    return state.phase === 'done' || now >= state.endsAt
  }

  getResult(state: GlassBridgeState): NormalizedResult {
    const rows = state.safe.length
    const score = (id: PlayerId): number => {
      const r = state.runners.get(id)
      if (!r) return 0
      return r.status === 'crossed' ? rows + 1 : r.reached
    }
    // Stable on vest order for equal scores (they share the rank anyway).
    const placements = [...state.order].sort((a, b) => score(b) - score(a))
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    placements.forEach((id, i) => {
      const prev = placements[i - 1]
      ranks[id] = prev !== undefined && score(prev) === score(id) ? (ranks[prev] ?? i) : i
      stats[id] = `${Math.min(rows, score(id))}/${rows}`
    })
    return { placements, ranks, stats }
  }

  snapshot(state: GlassBridgeState, now: number): GlassBridgeSnapshot {
    return {
      rows: state.safe.map((s, i) => ({
        safe: state.revealed[i] ? s : null,
        broken: state.broken[i] ?? null,
      })),
      players: state.order.map((id) => {
        const r = state.runners.get(id) as Runner
        return { id, vest: r.vest, status: r.status, pos: r.pos }
      }),
      active: state.active,
      phase: state.phase,
      target: state.target,
      jumpSide: state.jumpSide,
      decideMs: state.phase === 'decide' ? Math.max(0, state.phaseEndsAt - now) : 0,
      decideTotalMs: DECIDE_MS,
      glint: this.glintAt(state, now),
      pointers: [...state.pointers].map(([id, s]) => ({ id, side: s })),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }

  // The flash lit at `now`, if any — only meaningful (and only sent) while a row is being decided.
  private glintAt(state: GlassBridgeState, now: number): GlassBridgeSnapshot['glint'] {
    if (state.phase !== 'decide' || state.target === null) return null
    const row = state.target
    if (state.revealed[row]) return null
    for (let i = state.glints.length - 1; i >= 0; i--) {
      const at = state.glints[i] as number
      if (at > now) continue
      if (now - at >= GLINT_MS) return null
      return { id: i + 1, row, side: state.safe[row] as GlassSide }
    }
    return null
  }

  private jump(state: GlassBridgeState, s: GlassSide, now: number): void {
    state.jumpSide = s
    state.phase = 'jump'
    state.phaseEndsAt = now + JUMP_MS
  }

  // Resolves the phase that ended at `at`.
  private advance(state: GlassBridgeState, at: number): void {
    const runner = state.active ? state.runners.get(state.active) : undefined
    switch (state.phase) {
      case 'walk': {
        if (!runner) {
          this.nextRunner(state, at)
          return
        }
        const known = this.knownRows(state)
        if (runner.pos < known - 1) {
          runner.pos += 1
          runner.reached = Math.max(runner.reached, runner.pos + 1)
          state.phaseEndsAt = at + WALK_STEP_MS
        } else if (known === state.safe.length) {
          this.cross(state, runner, at)
        } else {
          this.decide(state, runner.pos + 1, at)
        }
        return
      }
      case 'decide':
        // The jump timer ran out: the runner is pushed onto the seeded side.
        this.jump(state, state.forced[state.target ?? 0] ?? 'L', at)
        return
      case 'jump': {
        const row = state.target
        if (!runner || row === null) {
          this.nextRunner(state, at)
          return
        }
        state.revealed[row] = true
        runner.pos = row
        if (state.jumpSide === state.safe[row]) {
          runner.reached = row + 1
          if (row === state.safe.length - 1) this.cross(state, runner, at)
          else this.decide(state, row + 1, at)
        } else {
          state.broken[row] = state.jumpSide
          runner.status = 'fallen'
          state.phase = 'fall'
          state.phaseEndsAt = at + FALL_MS
        }
        return
      }
      case 'fall':
        this.nextRunner(state, at)
        return
      case 'done':
        return
    }
  }

  // Rows are solved strictly in order from the start, so the revealed ones are always a prefix.
  private knownRows(state: GlassBridgeState): number {
    const first = state.revealed.indexOf(false)
    return first === -1 ? state.revealed.length : first
  }

  private decide(state: GlassBridgeState, row: number, at: number): void {
    state.phase = 'decide'
    state.target = row
    state.jumpSide = null
    state.phaseEndsAt = at + DECIDE_MS
    state.pointers.clear()
  }

  private cross(state: GlassBridgeState, runner: Runner, at: number): void {
    runner.status = 'crossed'
    runner.pos = state.safe.length
    runner.reached = state.safe.length
    this.nextRunner(state, at)
  }

  // Hands the bridge to the next vest in the queue (auto-walking the solved rows), or ends the round.
  private nextRunner(state: GlassBridgeState, at: number, delayMs = WALK_STEP_MS): void {
    const next = state.order.find((id) => state.runners.get(id)?.status === 'queue')
    state.target = null
    state.jumpSide = null
    state.pointers.clear()
    if (!next) {
      state.active = null
      state.phase = 'done'
      return
    }
    const runner = state.runners.get(next) as Runner
    runner.status = 'active'
    state.active = next
    state.phase = 'walk'
    state.phaseEndsAt = at + delayMs
  }
}
