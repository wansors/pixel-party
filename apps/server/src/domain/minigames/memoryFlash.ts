import {
  MEMORY_FLASH_COLORS,
  type MemoryFlashBoard,
  type MemoryFlashInput,
  type MemoryFlashSnapshot,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
const LEVELS = 20
const COLORS = MEMORY_FLASH_COLORS.length
type FlashColor = (typeof MEMORY_FLASH_COLORS)[number]

export interface MemoryFlashState {
  players: PlayerId[]
  boards: MemoryFlashBoard[]
  // Parallel to boards: the true count of the target color on each board (never sent to clients).
  answers: number[]
  startedAt: number
  endsAt: number
  // playerId -> board index the player is on (also how many puzzles they have seen).
  pointer: Map<PlayerId, number>
  correct: Map<PlayerId, number>
  // ms into the round of the player's last CORRECT answer — the tiebreak (sooner wins). A wrong answer
  // doesn't move it, so missing faster never beats matching the score.
  lastClearMs: Map<PlayerId, number>
}

// Real-time FFA memory/estimation. A seeded sequence of "flash" boards is shared by everyone; each
// player advances at their own pace, counting the target color before the burst hides. Pure domain
// logic: boards come from the injected Random port (seeded per round) and time arrives as `now`.
export class MemoryFlash implements MiniGame<MemoryFlashState, MemoryFlashInput> {
  readonly id = 'memory-flash'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): MemoryFlashState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const boards: MemoryFlashBoard[] = []
    const answers: number[] = []
    for (let level = 0; level < LEVELS; level++) {
      const side = Math.min(4 + Math.floor(level / 3), 8)
      const cellCount = side * side
      const target = MEMORY_FLASH_COLORS[Math.floor(r.next() * COLORS)] as FlashColor
      // Fill a growing share of the grid with random palette colours; count the target among them.
      const fill = Math.min(cellCount, 4 + level + Math.floor(r.next() * 3))
      const cells = Array.from({ length: cellCount }, (_, i) => i)
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(r.next() * (i + 1))
        ;[cells[i], cells[j]] = [cells[j] as number, cells[i] as number]
      }
      // One character per cell on the wire: '.' empty, else the colour's index.
      const burst = new Array<string>(cellCount).fill('.')
      let trueCount = 0
      for (let i = 0; i < fill; i++) {
        const color = Math.floor(r.next() * COLORS)
        if (MEMORY_FLASH_COLORS[color]?.hex === target.hex) trueCount++
        burst[cells[i] as number] = String(color)
      }
      // Four distinct answer options bracketing the true count (never below zero).
      const opts = new Set<number>([trueCount])
      let spread = 1
      while (opts.size < 4) {
        const cand = trueCount + (Math.floor(r.next() * spread) + 1) * (r.next() < 0.5 ? -1 : 1)
        if (cand >= 0) opts.add(cand)
        spread++
      }
      const choices = [...opts]
      for (let i = choices.length - 1; i > 0; i--) {
        const j = Math.floor(r.next() * (i + 1))
        ;[choices[i], choices[j]] = [choices[j] as number, choices[i] as number]
      }
      boards.push({
        level,
        cols: side,
        rows: side,
        cells: burst.join(''),
        targetColor: target.hex,
        targetName: target.name,
        flashMs: Math.max(1600 - level * 80, 550),
        choices,
      })
      answers.push(trueCount)
    }
    return {
      players: [...ctx.players],
      boards,
      answers,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      pointer: new Map(ctx.players.map((id) => [id, 0])),
      correct: new Map(ctx.players.map((id) => [id, 0])),
      lastClearMs: new Map(ctx.players.map((id) => [id, 0])),
    }
  }

  onInput(
    state: MemoryFlashState,
    playerId: PlayerId,
    input: MemoryFlashInput,
    now: number,
  ): MemoryFlashState {
    if (
      input.kind !== 'answer' ||
      typeof input.level !== 'number' ||
      typeof input.value !== 'number'
    )
      return state
    if (now >= state.endsAt) return state
    const ptr = state.pointer.get(playerId)
    if (ptr === undefined || ptr >= state.boards.length || input.level !== ptr) return state
    if (input.value === state.answers[ptr]) {
      state.correct.set(playerId, (state.correct.get(playerId) ?? 0) + 1)
      state.lastClearMs.set(playerId, now - state.startedAt)
    }
    state.pointer.set(playerId, ptr + 1)
    return state
  }

  // A player who left is done: skip them to the end so the round can finish once everyone else is.
  leave(state: MemoryFlashState, playerId: PlayerId, _now: number): MemoryFlashState {
    if (state.pointer.has(playerId)) state.pointer.set(playerId, state.boards.length)
    return state
  }

  isFinished(state: MemoryFlashState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((id) => (state.pointer.get(id) ?? 0) >= state.boards.length)
  }

  getResult(state: MemoryFlashState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => {
      const ca = state.correct.get(a) ?? 0
      const cb = state.correct.get(b) ?? 0
      if (cb !== ca) return cb - ca
      return (state.lastClearMs.get(a) ?? 0) - (state.lastClearMs.get(b) ?? 0)
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: { c: number; t: number } | undefined
    sorted.forEach((id, idx) => {
      const c = state.correct.get(id) ?? 0
      const t = state.lastClearMs.get(id) ?? 0
      if (idx > 0 && prev && (c !== prev.c || t !== prev.t)) rank = idx
      ranks[id] = rank
      prev = { c, t }
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.correct.get(id) ?? 0} correct`
    return { placements: sorted, ranks, stats }
  }

  // Each board in play goes on the wire once, however many players are on it (it's static per level).
  snapshot(state: MemoryFlashState, now: number): MemoryFlashSnapshot {
    const at: Record<PlayerId, number | null> = {}
    const boards: MemoryFlashBoard[] = []
    for (const id of state.players) {
      const board = state.boards[state.pointer.get(id) ?? 0]
      at[id] = board ? board.level : null
      if (board && !boards.includes(board)) boards.push(board)
    }
    return {
      boards: boards.sort((a, b) => a.level - b.level),
      at,
      scores: Object.fromEntries(state.correct),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
