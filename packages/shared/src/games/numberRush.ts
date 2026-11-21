// Number Rush (Schulte grid) wire shapes. A single seeded grid of numbers 1..N is shared by everyone;
// each player taps them in order at their own pace. Server-authoritative progress; the client renders
// its own next-target from the snapshot.
//
// The board shuffles as a run goes on (D40): after NUMBER_RUSH_SHUFFLES[k] numbers are cleared, the
// numbers still to find swap places among the open cells (cleared cells stay put) — after 10, then 6
// more, 4 more, 3 more. A plain Schulte grid gets easier the emptier it gets; this way the hunt starts
// over, more and more often, right to the end. Every player meets the same layouts at the same
// milestones (seeded server side), and the client switches layout the moment it counts the milestone.

import { compound } from '../difficulty'

// A wrong number locks that player's taps for this long: hunting by sweeping every cell in reading order
// (≈ 150 wrong taps a grid) is then hopeless, while an honest misclick costs half a second.
export const NUMBER_RUSH_WRONG_COOLDOWN_MS = 500

// Cleared counts after which the open numbers reshuffle (25-cell grid): the gaps compound down —
// 10, 6, 4, 3 — so the reshuffles come faster and faster.
export const NUMBER_RUSH_SHUFFLES: readonly number[] = (() => {
  const at: number[] = []
  for (let k = 0, cleared = 0; ; k++) {
    cleared += Math.round(compound(10, 0.62, k, 3))
    if (cleared >= 25) return at
    at.push(cleared)
  }
})()

// Which layout a player whose next number is `next` (1-based) is on: 0 until the first reshuffle.
export function numberRushStage(next: number): number {
  let stage = 0
  while (stage < NUMBER_RUSH_SHUFFLES.length && next > (NUMBER_RUSH_SHUFFLES[stage] as number))
    stage++
  return stage
}

export interface NumberRushSnapshot {
  // Shared seeded layout: grid[cell] = the number printed on that cell. Length = size * size.
  grid: number[]
  // The layout at each stage (layouts[0] === grid; see numberRushStage): a player's taps are judged on
  // layouts[numberRushStage(their progress)].
  layouts?: number[][]
  size: number
  // playerId -> the next number that player must tap (1-based). size*size + 1 means finished.
  progress: Record<string, number>
  // playerId -> remaining ms of that player's wrong-number penalty (0 when none).
  cooldowns: Record<string, number>
  remainingMs: number
}

// Tap a grid cell; the server accepts it only when its number is the player's current target. A
// higher number starts the wrong-number penalty (taps during it are ignored); an already cleared one is
// simply ignored (a double click).
export interface NumberRushInput {
  kind: 'tap'
  cell: number
}
