// Higher or Lower wire shapes. A single seeded deck is shared by everyone; each player builds a streak
// by guessing whether the next card is higher or lower. One wrong guess locks the player out for the
// round. The server owns the deck, so upcoming cards are never revealed early.

export interface HigherLowerCard {
  // The face-up card value (deck range documented server-side).
  current: number
  // Index of the current card in the shared deck; echoed back on guess to drop stale taps.
  index: number
  // False once the player misses — their run is over.
  alive: boolean
}

export interface HigherLowerSnapshot {
  // playerId -> that player's current card + run state.
  cards: Record<string, HigherLowerCard>
  // playerId -> streak length (also the banked score).
  scores: Record<string, number>
  remainingMs: number
}

export interface HigherLowerInput {
  kind: 'guess'
  index: number
  dir: 'higher' | 'lower'
}
