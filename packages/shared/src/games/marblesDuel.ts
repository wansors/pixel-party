// Marbles Duel wire shapes (duel format; the Squid Game "odd or even" game). Players are seeded-paired
// 1v1 and start with MARBLES.start marbles each. Every turn one of them HIDES some marbles in a fist
// while the other GUESSES: they bet some of their marbles and call odd or even. Right call: the guesser
// takes the bet from the hider; wrong call: the guesser pays it. Roles swap every turn. Whoever runs out
// loses; at the bell, more marbles wins (equal is a draw). Both choose at the same time — reading your
// rival is the game.
//
// The snapshot is public (a bye watches another duel from it), so the number hidden this turn never goes
// on the wire before the reveal.

export const MARBLES = {
  start: 10,
  chooseMs: 6000,
  revealMs: 2200,
} as const

export type MarblesRole = 'hide' | 'guess'

export interface MarblesReveal {
  hidden: number
  bet: number
  odd: boolean
  correct: boolean
  // Marbles that changed hands (the bet, capped by what the loser had).
  moved: number
  guesserId: string
}

export interface MarblesPlayerView {
  opponentId: string | null // null = bye (odd player out): ranks with the draws
  mine: number
  theirs: number
  role: MarblesRole
  turn: number
  phase: 'choose' | 'reveal' | 'done'
  msLeft: number
  youChose: boolean
  theyChose: boolean
  // The turn just revealed (shown during the reveal phase).
  last: MarblesReveal | null
  won: boolean | null // null = undecided / draw / bye
  oppLeft: boolean // you won because your opponent left the game
}

export interface MarblesSnapshot {
  roundRemainingMs: number
  players: Record<string, MarblesPlayerView>
}

// hide: how many marbles go in the fist (1…yours). guess: the bet (1…yours) and the call.
export type MarblesInput =
  | { kind: 'hide'; count: number }
  | { kind: 'guess'; bet: number; odd: boolean }
