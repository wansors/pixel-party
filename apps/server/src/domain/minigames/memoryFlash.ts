import type {
  MemoryFlashBoard,
  MemoryFlashInput,
  MemoryFlashPixel,
  MemoryFlashSnapshot,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 40_000
const LEVELS = 20
const PALETTE = [
  { name: 'RED', hex: 0xe63946 },
  { name: 'GREEN', hex: 0x2a9d3f },
  { name: 'BLUE', hex: 0x3a7bd5 },
  { name: 'YELLOW', hex: 0xf4c20d },
]

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
      const target = PALETTE[Math.floor(r.next() * PALETTE.length)] as (typeof PALETTE)[number]
      // Fill a growing share of the grid with random palette colours; count the target among them.
      const fill = Math.min(cellCount, 4 + level + Math.floor(r.next() * 3))
      const cells = Array.from({ length: cellCount }, (_, i) => i)
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(r.next() * (i + 1))
        ;[cells[i], cells[j]] = [cells[j] as number, cells[i] as number]
      }
      const pixels: MemoryFlashPixel[] = []
      let trueCount = 0
      for (let i = 0; i < fill; i++) {
        const cell = cells[i] as number
        const color = PALETTE[Math.floor(r.next() * PALETTE.length)] as (typeof PALETTE)[number]
        if (color.hex === target.hex) trueCount++
        pixels.push({ x: cell % side, y: Math.floor(cell / side), color: color.hex })
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
        pixels,
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
    }
    state.pointer.set(playerId, ptr + 1)
    state.lastClearMs.set(playerId, now - state.startedAt)
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
    return { placements: sorted, ranks }
  }

  snapshot(state: MemoryFlashState, now: number): MemoryFlashSnapshot {
    const boards: Record<PlayerId, MemoryFlashBoard | null> = {}
    for (const id of state.players) {
      const ptr = state.pointer.get(id) ?? 0
      boards[id] = state.boards[ptr] ?? null
    }
    return {
      boards,
      scores: Object.fromEntries(state.correct),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
