import type { OddOneOutBoard, OddOneOutInput, OddOneOutSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
const LEVELS = 30

export interface OddOneOutState {
  players: PlayerId[]
  boards: OddOneOutBoard[]
  startedAt: number
  endsAt: number
  // playerId -> level the player is currently on (also the count cleared).
  level: Map<PlayerId, number>
  // playerId -> ms at the player's last clear, to break ties (faster = better).
  lastClearMs: Map<PlayerId, number>
}

// Real-time FFA "spot the different tile". A seeded sequence of boards (grid grows, brightness gap
// shrinks) is shared by everyone; each player advances at their own pace. The odd tile differs in
// brightness — not hue alone — so it is solvable without color discrimination. Pure domain logic.
export class OddOneOut implements MiniGame<OddOneOutState, OddOneOutInput> {
  readonly id = 'odd-one-out'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): OddOneOutState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const boards: OddOneOutBoard[] = []
    for (let level = 0; level < LEVELS; level++) {
      const side = Math.min(2 + Math.floor(level / 2), 6)
      // Mid-brightness base hue; the odd tile is lightened by a delta that shrinks as levels rise.
      const hue = {
        r: 60 + Math.floor(r.next() * 120),
        g: 60 + Math.floor(r.next() * 120),
        b: 60 + Math.floor(r.next() * 120),
      }
      const delta = Math.max(70 - level * 4, 14)
      const clamp = (v: number): number => Math.max(0, Math.min(255, v))
      const base = (hue.r << 16) | (hue.g << 8) | hue.b
      const odd = (clamp(hue.r + delta) << 16) | (clamp(hue.g + delta) << 8) | clamp(hue.b + delta)
      boards.push({
        level,
        cols: side,
        rows: side,
        base,
        odd,
        oddCell: Math.floor(r.next() * side * side),
      })
    }
    return {
      players: [...ctx.players],
      boards,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      level: new Map(ctx.players.map((id) => [id, 0])),
      lastClearMs: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  onInput(
    state: OddOneOutState,
    playerId: PlayerId,
    input: OddOneOutInput,
    now: number,
  ): OddOneOutState {
    if (input.kind !== 'tap' || typeof input.level !== 'number' || typeof input.cell !== 'number')
      return state
    if (now >= state.endsAt) return state
    const lvl = state.level.get(playerId)
    if (lvl === undefined || lvl >= state.boards.length || input.level !== lvl) return state
    const board = state.boards[lvl] as OddOneOutBoard
    // Wrong tile is ignored — no penalty, just keep hunting.
    if (input.cell !== board.oddCell) return state
    state.level.set(playerId, lvl + 1)
    state.lastClearMs.set(playerId, now - state.startedAt)
    return state
  }

  isFinished(state: OddOneOutState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((id) => (state.level.get(id) ?? 0) >= state.boards.length)
  }

  getResult(state: OddOneOutState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => {
      const la = state.level.get(a) ?? 0
      const lb = state.level.get(b) ?? 0
      if (lb !== la) return lb - la
      return (state.lastClearMs.get(a) ?? 0) - (state.lastClearMs.get(b) ?? 0)
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: { l: number; t: number } | undefined
    sorted.forEach((id, idx) => {
      const l = state.level.get(id) ?? 0
      const t = state.lastClearMs.get(id) ?? 0
      if (idx > 0 && prev && (l !== prev.l || t !== prev.t)) rank = idx
      ranks[id] = rank
      prev = { l, t }
    })
    return { placements: sorted, ranks }
  }

  snapshot(state: OddOneOutState, now: number): OddOneOutSnapshot {
    const boards: Record<PlayerId, OddOneOutBoard | null> = {}
    for (const id of state.players) {
      const lvl = state.level.get(id) ?? 0
      boards[id] = state.boards[lvl] ?? null
    }
    return {
      boards,
      scores: Object.fromEntries(state.level),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
