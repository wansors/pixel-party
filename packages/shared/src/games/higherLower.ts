// Higher or Lower wire shapes. Each player gets their own seeded deck and builds a streak by guessing
// whether the next card is higher or lower. BANK stops the run and keeps the streak; a miss ends it and
// halves the streak. The server owns the decks, so upcoming cards are never revealed early — and since
// the decks are independent, another player's face-up card says nothing about yours.

export type HigherLowerStatus = 'playing' | 'banked' | 'bust'

export interface HigherLowerCard {
  // The face-up card value (deck range documented server-side).
  current: number
  // Index of the current card in the player's deck; echoed back on guess to drop stale taps.
  index: number
  status: HigherLowerStatus
  // The card that came next, turned over once the run is over (null while playing, or when the deck
  // ran out). On a bust it's the card that beat the guess; after a bank, the one that wasn't risked.
  next: number | null
}

export interface HigherLowerSnapshot {
  // playerId -> that player's current card + run state (scenes show rivals' status only).
  cards: Record<string, HigherLowerCard>
  // playerId -> the streak, i.e. the score (halved by a miss).
  scores: Record<string, number>
  remainingMs: number
}

export type HigherLowerInput =
  | { kind: 'guess'; index: number; dir: 'higher' | 'lower' }
  | { kind: 'bank' }
