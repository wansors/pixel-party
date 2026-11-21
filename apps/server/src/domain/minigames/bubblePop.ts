import {
  BUBBLE,
  type BubblePopInput,
  type BubblePopSnapshot,
  bubbleJammed,
  bubbleNextShot,
  bubbleShoot,
  rampEase,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const { rows: ROWS, cols: COLS, colors: COLORS } = BUBBLE
const CELLS = ROWS * COLS
const QUEUE_LENGTH = 100
const DEFAULT_DURATION_MS = 60_000
// The ceiling drops: a new seeded row pushes in from the top (everything moves down a row), so a board
// left alone creeps toward the cannon. The first drop comes a sixth of the way in; then the gaps shrink
// on an ease-in (18% → 5% of the round: 10.8 s → 3 s in a minute), so the last stretch is a scramble
// to keep the stack off the floor. Fractions of the round, so any round length gets the same curve.
const FIRST_DROP_AT = 1 / 6
const DROP_GAP_START = 0.18
const DROP_GAP_END = 0.05

function randomColor(random: Random): number {
  return Math.floor(random.next() * COLORS) + 1
}

// Rows 0..3 (the top half, row 0 = ceiling) start filled with random colors; rows 4..7 stay empty.
function buildStartBoard(random: Random): number[] {
  const board = new Array<number>(CELLS).fill(0)
  for (let i = 0; i < 4 * COLS; i++) board[i] = randomColor(random)
  return board
}

function buildShotQueue(random: Random): number[] {
  return Array.from({ length: QUEUE_LENGTH }, () => randomColor(random))
}

function nextValidShot(board: number[], queue: number[], from: number) {
  return bubbleNextShot(board, (i) => queue[i % queue.length] as number, from, queue.length)
}

// When each ceiling drop comes (ms from the start).
function dropSchedule(durationMs: number): number[] {
  const out: number[] = []
  for (let p = FIRST_DROP_AT; p < 1; p += rampEase(DROP_GAP_START, DROP_GAP_END, p)) {
    out.push(Math.round(p * durationMs))
  }
  return out
}

// The ceiling drops `row` onto `board` (in place): every bubble moves down a row and `row` fills the
// top. False, with the board untouched, when a bubble already sits on the bottom row: the stack would
// be shoved through the floor.
function dropRow(board: number[], row: readonly number[]): boolean {
  for (let i = (ROWS - 1) * COLS; i < CELLS; i++) if (board[i] !== 0) return false
  board.copyWithin(COLS, 0, (ROWS - 1) * COLS)
  for (let c = 0; c < COLS; c++) board[c] = row[c] ?? 1
  return true
}

export interface BubblePopState {
  players: PlayerId[]
  shotQueue: number[]
  // Ceiling drops: when each comes (ms from the start), the seeded row it pushes in, and how many
  // have come so far.
  dropTimes: number[]
  dropRows: number[][]
  drops: number
  startedAt: number
  endsAt: number
  boards: Map<PlayerId, number[]>
  shotIndex: Map<PlayerId, number>
  // Shots taken from each player (acknowledged on the wire, so the client stops replaying them).
  shots: Map<PlayerId, number>
  score: Map<PlayerId, number>
  // 0 = not finished; otherwise the server time the player fully cleared their board.
  doneAt: Map<PlayerId, number>
  // Players whose board jammed (every column blocked at the bottom, or a ceiling drop shoved the stack
  // through the floor): out of shots, done for the round.
  jammed: Set<PlayerId>
  // Players gone mid-round: the race doesn't wait for them.
  left: Set<PlayerId>
}

// Self-paced FFA puzzle race, structurally like Sudoku Race: one seeded starting cluster and shot queue
// shared by everyone, each player mutates their own copy. The shot rules live in @pp/shared, so the
// client predicts its own board with the same code. A simplified rectangular grid + "choose a
// column" aim stand in for a true hex-grid bubble-shooter, but the pop/clear rules are the real thing.
// Most bubbles popped wins; a full clear beats any score (the faster, the better). The ceiling drops a
// new row ever more often; let the stack reach the bottom of every column, or be on the bottom row
// when the ceiling drops, and the board jams: you're out of shots for the round.
export class BubblePop implements MiniGame<BubblePopState, BubblePopInput> {
  readonly id = 'bubble-pop'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BubblePopState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const startBoard = buildStartBoard(r)
    const shotQueue = buildShotQueue(r)
    const dropTimes = dropSchedule(durationMs)
    const dropRows = dropTimes.map(() => Array.from({ length: COLS }, () => randomColor(r)))
    return {
      players: [...ctx.players],
      shotQueue,
      dropTimes,
      dropRows,
      drops: 0,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      boards: new Map(ctx.players.map((pid) => [pid, [...startBoard]])),
      shotIndex: new Map(ctx.players.map((pid) => [pid, 0])),
      shots: new Map(ctx.players.map((pid) => [pid, 0])),
      score: new Map(ctx.players.map((pid) => [pid, 0])),
      doneAt: new Map(ctx.players.map((pid) => [pid, 0])),
      jammed: new Set(),
      left: new Set(),
    }
  }

  onInput(
    state: BubblePopState,
    playerId: PlayerId,
    input: BubblePopInput,
    now: number,
  ): BubblePopState {
    if (input?.kind !== 'shoot') return state
    const { col } = input
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return state
    const shots = state.shots.get(playerId)
    if (shots === undefined) return state
    state.shots.set(playerId, shots + 1)
    const doneAt = state.doneAt.get(playerId)
    if (doneAt === undefined || doneAt > 0 || state.jammed.has(playerId)) return state
    if (now >= state.endsAt) return state
    const board = state.boards.get(playerId)
    const shotIndex = state.shotIndex.get(playerId)
    if (!board || shotIndex === undefined) return state
    const { index, color } = nextValidShot(board, state.shotQueue, shotIndex)
    state.shotIndex.set(playerId, index + 1)
    const shot = bubbleShoot(board, col, color)
    if (shot.row === -1) return state
    const removed = shot.popped.length + shot.dropped.length
    if (removed > 0) {
      state.score.set(playerId, (state.score.get(playerId) ?? 0) + removed)
    }
    if (board.every((c) => c === 0)) state.doneAt.set(playerId, now)
    else if (bubbleJammed(board)) state.jammed.add(playerId)
    return state
  }

  // Ceiling drops that have come due land on every board still in play.
  tick(state: BubblePopState, _dt: number, now: number): BubblePopState {
    while (
      state.drops < state.dropTimes.length &&
      state.startedAt + (state.dropTimes[state.drops] as number) <= now &&
      now < state.endsAt
    ) {
      const row = state.dropRows[state.drops] as number[]
      for (const pid of state.players) {
        if ((state.doneAt.get(pid) ?? 0) > 0 || state.jammed.has(pid) || state.left.has(pid))
          continue
        const board = state.boards.get(pid)
        if (!board) continue
        if (!dropRow(board, row) || bubbleJammed(board)) state.jammed.add(pid)
      }
      state.drops += 1
    }
    return state
  }

  leave(state: BubblePopState, playerId: PlayerId, _now: number): BubblePopState {
    state.left.add(playerId)
    return state
  }

  // Over at the timer, or once no board can still change: every player cleared, jammed or gone.
  isFinished(state: BubblePopState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every(
      (pid) => (state.doneAt.get(pid) ?? 0) > 0 || state.jammed.has(pid) || state.left.has(pid),
    )
  }

  // Full clears first (fastest first); then most points, a jammed board below a live one on equal points.
  private cmp(state: BubblePopState, a: PlayerId, b: PlayerId): number {
    const da = state.doneAt.get(a) ?? 0
    const db = state.doneAt.get(b) ?? 0
    const aDone = da > 0
    const bDone = db > 0
    if (aDone !== bDone) return aDone ? -1 : 1
    if (aDone && bDone) return da - db
    return (
      (state.score.get(b) ?? 0) - (state.score.get(a) ?? 0) ||
      Number(state.jammed.has(a)) - Number(state.jammed.has(b))
    )
  }

  getResult(state: BubblePopState): NormalizedResult {
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
      stats[id] = done ? 'cleared!' : `${state.score.get(id) ?? 0} pts`
    }
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: BubblePopState, now: number): BubblePopSnapshot {
    const boards: Record<string, BubblePopSnapshot['boards'][string]> = {}
    const scores: Record<string, number> = {}
    for (const pid of state.players) {
      const score = state.score.get(pid) ?? 0
      boards[pid] = {
        grid: (state.boards.get(pid) ?? []).join(''),
        score,
        shot: state.shotIndex.get(pid) ?? 0,
        shots: state.shots.get(pid) ?? 0,
        done: (state.doneAt.get(pid) ?? 0) > 0,
        jammed: state.jammed.has(pid),
      }
      scores[pid] = score
    }
    const nextDrop = state.dropTimes[state.drops]
    return {
      rows: ROWS,
      cols: COLS,
      queue: state.shotQueue.join(''),
      boards,
      scores,
      drops: state.drops,
      nextDropMs:
        nextDrop === undefined ? undefined : Math.max(0, state.startedAt + nextDrop - now),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
