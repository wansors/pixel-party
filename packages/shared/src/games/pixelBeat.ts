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

export interface PixelBeatInput {
  kind: 'tap'
}
