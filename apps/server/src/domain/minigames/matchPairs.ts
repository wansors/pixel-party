import type { MatchInput, MatchSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const COLS = 4
const ROWS = 4
const PAIRS = 8
const CARDS = COLS * ROWS
const DEFAULT_DURATION_MS = 60_000

export interface MatchPairsState {
  players: PlayerId[]
  // Shared seeded layout: card index -> pairId (each pairId 0..PAIRS-1 appears exactly twice).
  values: number[]
  cols: number
  rows: number
  pairs: number
  startedAt: number
  endsAt: number
  matched: Map<PlayerId, Set<number>>
  up: Map<PlayerId, number[]>
  attempts: Map<PlayerId, number>
  // 0 = not finished; otherwise the server time the player cleared the board.
  doneAt: Map<PlayerId, number>
}

// Real-time FFA memory game. One seeded board of face-down cards (pairs) is shared by everyone; each
// player flips on their own board. A matching pair locks, a mismatch stays shown until the next flip.
// Pure domain logic: the layout is drawn from the injected Random port and time arrives as `now`.
export class MatchPairs implements MiniGame<MatchPairsState, MatchInput> {
  readonly id = 'match-pairs'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): MatchPairsState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const values: number[] = []
    for (let pairId = 0; pairId < PAIRS; pairId++) {
      values.push(pairId, pairId)
    }
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1))
      const tmp = values[i] as number
      values[i] = values[j] as number
      values[j] = tmp
    }
    return {
      players: [...ctx.players],
      values,
      cols: COLS,
      rows: ROWS,
      pairs: PAIRS,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      matched: new Map(ctx.players.map((pid) => [pid, new Set<number>()])),
      up: new Map(ctx.players.map((pid) => [pid, []])),
      attempts: new Map(ctx.players.map((pid) => [pid, 0])),
      doneAt: new Map(ctx.players.map((pid) => [pid, 0])),
    }
  }

  onInput(
    state: MatchPairsState,
    playerId: PlayerId,
    input: MatchInput,
    now: number,
  ): MatchPairsState {
    if (input.kind !== 'flip' || typeof input.index !== 'number') return state
    const index = input.index
    if (!Number.isInteger(index) || index < 0 || index >= state.values.length) return state
    const doneAt = state.doneAt.get(playerId)
    if (doneAt === undefined || doneAt > 0) return state
    if (now >= state.endsAt) return state
    const matched = state.matched.get(playerId)
    let up = state.up.get(playerId)
    if (!matched || !up) return state
    // A mismatch is being shown: clear it before treating this tap as a fresh first flip.
    if (up.length === 2) {
      up = []
      state.up.set(playerId, up)
    }
    if (matched.has(index)) return state
    if (up.length === 1 && up[0] === index) return state
    if (up.length === 0) {
      state.up.set(playerId, [index])
      return state
    }
    const first = up[0] as number
    if (state.values[first] === state.values[index]) {
      matched.add(first)
      matched.add(index)
      state.up.set(playerId, [])
      if (matched.size === state.values.length) state.doneAt.set(playerId, now)
    } else {
      state.attempts.set(playerId, (state.attempts.get(playerId) ?? 0) + 1)
      state.up.set(playerId, [first, index])
    }
    return state
  }

  tick(state: MatchPairsState, _dt: number, _now: number): MatchPairsState {
    return state
  }

  isFinished(state: MatchPairsState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((pid) => (state.doneAt.get(pid) ?? 0) > 0)
  }

  private cmp(state: MatchPairsState, a: PlayerId, b: PlayerId): number {
    const da = state.doneAt.get(a) ?? 0
    const db = state.doneAt.get(b) ?? 0
    const aDone = da > 0
    const bDone = db > 0
    if (aDone !== bDone) return aDone ? -1 : 1
    if (aDone && bDone) return da - db
    const ma = state.matched.get(a)?.size ?? 0
    const mb = state.matched.get(b)?.size ?? 0
    if (ma !== mb) return mb - ma
    return (state.attempts.get(a) ?? 0) - (state.attempts.get(b) ?? 0)
  }

  getResult(state: MatchPairsState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      const done = (state.doneAt.get(id) ?? 0) > 0
      stats[id] = done ? 'done' : `${(state.matched.get(id)?.size ?? 0) / 2} pairs`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: MatchPairsState, now: number): MatchSnapshot {
    const boards: Record<string, MatchSnapshot['boards'][string]> = {}
    const reveal: Record<string, Record<number, number>> = {}
    for (const pid of state.players) {
      const up = state.up.get(pid) ?? []
      const matched = [...(state.matched.get(pid) ?? [])]
      boards[pid] = {
        up: [...up],
        matched,
        attempts: state.attempts.get(pid) ?? 0,
        done: (state.doneAt.get(pid) ?? 0) > 0,
      }
      const shown: Record<number, number> = {}
      for (const i of up) shown[i] = state.values[i] as number
      for (const i of matched) shown[i] = state.values[i] as number
      reveal[pid] = shown
    }
    return {
      cols: state.cols,
      rows: state.rows,
      boards,
      reveal,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
