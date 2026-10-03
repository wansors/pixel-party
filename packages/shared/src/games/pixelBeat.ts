// Pixel Beat wire shapes. A shared seeded beat timeline (identical for every player) plays out over
// the round; tapping near a beat scores, tapping near nothing breaks the streak. The server owns the
// timeline and scoring; the client only renders upcoming beats and its own score/streak.

export interface PixelBeatSnapshot {
  // Beat offsets (ms from round start), shared by every player, sorted ascending.
  beatTimes: number[]
  // playerId -> total score so far.
  scores: Record<string, number>
  // playerId -> current consecutive scoring streak.
  streaks: Record<string, number>
  remainingMs: number
}

// One tap. `at` is the tap's round time on the client's own timeline (ms since round start, the clock
// the notes are drawn on), so it's judged against what the player saw rather than when it reached the
// server. The server credits it only within a bounded latency window of its own measurement (and uses
// its own when `at` is absent).
export interface PixelBeatInput {
  kind: 'tap'
  at?: number
}
