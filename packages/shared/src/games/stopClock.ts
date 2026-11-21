// Stop the Clock wire shapes (D55): a blind stopwatch. Each try asks you to stop a hidden stopwatch at a
// whole number of seconds — "stop at 7 s" — and shows nothing ticking: no needle, no bar, no digits. You
// press when you feel the time has come, and only then see the time you made. The targets are seeded
// (the same for everyone) and get longer try by try (D40) — the longer the wait, the harder to judge.
// The stopwatch runs on each player's own device (a friendly timing game, tolerant to latency); the
// server owns the targets and the error/ranking.

export const STOP_CLOCK = {
  attempts: 3,
  // The whole seconds each try may ask for (inclusive), try by try.
  ranges: [
    [3, 5],
    [5, 8],
    [7, 11],
  ] as readonly (readonly [number, number])[],
  // GET READY this long before each try's stopwatch starts (no countdown: no rhythm to lean on).
  readyMs: 1300,
  // Your time stays on screen this long before the next try.
  revealMs: 2200,
  // A try you never get to (the clock ran out, you left) costs this many seconds of error.
  missPenaltySec: 5,
  // The longest time a stop may report.
  maxMs: 60_000,
} as const

// Not stopped by then, the stopwatch stops itself (the try counts that late): twice the target + 2 s.
export function stopClockTimeoutMs(targetSec: number): number {
  return targetSec * 2000 + 2000
}

export interface StopClockSnapshot {
  // Seeded target per try, in whole seconds (shared by everyone).
  targets: number[]
  attempts: number
  // playerId -> tries already taken.
  attemptsDone: Record<string, number>
  // playerId -> the time each taken try was stopped at (ms).
  times: Record<string, number[]>
  // playerId -> accumulated absolute error so far, in seconds (lower is better).
  totalError: Record<string, number>
  remainingMs: number
}

// Stop try `attempt` after `ms` milliseconds on the (hidden) stopwatch.
export interface StopClockInput {
  kind: 'stop'
  attempt: number
  ms: number
}
