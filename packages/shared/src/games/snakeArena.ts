// Snake Arena wire shapes and the step rule shared by the server and the client's prediction. Classic
// grid snake: every player has their own independent board of the same size and the same seeded food
// sequence, and turns their snake with direction inputs. Eating food grows the snake; crashing into a
// wall or your own body kills it. The server owns the timeline (`snakeStepsAt`: steps come quicker and
// quicker over the round) and the boards; the client predicts its OWN snake with the same `snakeStep`
// and `snakeStepsAt`, so a turn shows on the very next step instead of a snapshot later, and draws the
// rivals from the snapshot.

export const SNAKE = {
  grid: 15,
  // A step's length at the start of the round, and by its end: the snake speeds up ~1.6×.
  stepMs: 160,
  endStepMs: 100,
  startLen: 3,
  // Turns buffered ahead of the next steps: two quick taps inside one step (a U-turn) both apply.
  turnQueue: 2,
  // A snake waits for its player's first direction (a still snake can't crash), but no longer than
  // this: then it sets off the way it faces.
  autoStartMs: 2000,
} as const

export type SnakeDir = 'up' | 'down' | 'left' | 'right'

export const SNAKE_OPPOSITE: Record<SnakeDir, SnakeDir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}
const DELTA: Record<SnakeDir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

export interface Cell {
  x: number
  y: number
}

// A queued turn: the direction and the step (1-based count since the start) it applies on.
export interface SnakeTurn {
  dir: SnakeDir
  at: number
}

// One snake's simulation state, the same on both sides.
export interface SnakeSim {
  body: number[] // head-first cell indices (y * grid + x)
  dir: SnakeDir
  turns: SnakeTurn[] // oldest first, `at` ascending
  alive: boolean
  waiting: boolean // hasn't set off yet
}

export type SnakeStepResult = 'idle' | 'moved' | 'ate' | 'crashed'

// Steps taken by round time `t` (ms) in a round of `durationMs`. The step rate climbs on an ease-in,
// rampEase(1 / stepMs, 1 / endStepMs, t / durationMs) — barely faster at first, sharply so in the last
// stretch — and this is its integral, so both sides count the very same steps for the same `t`.
export function snakeStepsAt(t: number, durationMs: number): number {
  const d = Math.max(1, durationMs)
  const x = Math.max(0, Math.min(t, d))
  const r0 = 1 / SNAKE.stepMs
  const r1 = 1 / SNAKE.endStepMs
  const steps = r0 * x + ((r1 - r0) * x ** 3) / (3 * d * d) + Math.max(0, t - d) * r1
  return Math.floor(steps + 1e-9)
}

export const snakeCell = (i: number, grid: number = SNAKE.grid): Cell => ({
  x: i % grid,
  y: Math.floor(i / grid),
})

// Executes step `k` (the k-th since the round started) on one snake, with `food` its current food cell
// (null when unknown — client prediction after an apple). A waiting snake sets off on its first turn or
// once the auto-start time has come; a turn due by this step changes the heading (a waiting snake may
// even reverse: its body is straight).
export function snakeStep(
  s: SnakeSim,
  k: number,
  food: number | null,
  grid: number = SNAKE.grid,
  stepMs: number = SNAKE.stepMs,
): SnakeStepResult {
  if (!s.alive) return 'idle'
  const turn = s.turns[0] && s.turns[0].at <= k ? s.turns.shift() : undefined
  if (s.waiting) {
    if (!turn && k * stepMs < SNAKE.autoStartMs) return 'idle'
    s.waiting = false
    if (turn && turn.dir === SNAKE_OPPOSITE[s.dir]) s.body.reverse()
  }
  if (turn) s.dir = turn.dir
  const head = s.body[0] ?? 0
  const [dx, dy] = DELTA[s.dir]
  const x = (head % grid) + dx
  const y = Math.floor(head / grid) + dy
  const next = y * grid + x
  // Moving into the tail's cell is a crash too: the tail only leaves after the head arrives.
  if (x < 0 || x >= grid || y < 0 || y >= grid || s.body.includes(next)) {
    s.alive = false
    return 'crashed'
  }
  s.body.unshift(next)
  if (next === food) return 'ate'
  s.body.pop()
  return 'moved'
}

// Whether `dir` can be queued now: the snake's heading once its queued turns have run (any direction
// for a snake that hasn't set off and has nothing queued), never the same or straight back.
export function snakeCanTurn(s: SnakeSim, dir: SnakeDir): boolean {
  if (!s.alive || s.turns.length >= SNAKE.turnQueue) return false
  if (s.waiting && s.turns.length === 0) return true
  const heading = s.turns.at(-1)?.dir ?? s.dir
  return dir !== heading && dir !== SNAKE_OPPOSITE[heading]
}

export interface SnakeView {
  // Head-first cell indices (y * grid + x).
  body: number[]
  alive: boolean
  len: number
  dir: SnakeDir
  // Turns queued for later steps, as [dir, step].
  turns: [SnakeDir, number][]
  waiting: boolean
  // The last input `seq` the server has taken (0 = none): the client replays only later ones.
  ack: number
}

export interface SnakeSnapshot {
  // playerId -> that player's snake. Every board is present; the client renders its own big.
  snakes: Record<string, SnakeView>
  // playerId -> that player's current food cell index.
  food: Record<string, number>
  // Board side length (grid is grid x grid).
  grid: number
  // Steps taken so far, the opening step length, and the round's elapsed ms at this snapshot: the
  // client keeps stepping its own snake on the server's clock between snapshots.
  step: number
  stepMs: number
  t: number
  // The round length the speed-up spans: steps due by `t` are snakeStepsAt(t, rampMs). Absent = a
  // constant step of `stepMs`.
  rampMs?: number
  // playerId -> length, for the live standings.
  progress: Record<string, number>
  remainingMs: number
}

// Turn the snake. `at` asks for the step to turn on (the client's next step, as it sees it): the server
// honours it when it's still ahead, or turns on its next step when the request arrives late.
export interface SnakeInput {
  kind: 'turn'
  dir: SnakeDir
  at?: number
  seq?: number
}
