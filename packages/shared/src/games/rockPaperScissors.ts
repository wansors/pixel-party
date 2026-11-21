import { compound } from '../difficulty'

// Rock Paper Scissors wire shapes (duel format, D43). Players are seeded-paired 1v1; every throw both
// pick a hand in secret and they're revealed together: rock blunts scissors, scissors cut paper, paper
// wraps rock. Not picking in time loses the throw (both idle = a draw). First to RPS.winsNeeded throws
// wins the duel; at the bell, more throws won wins (equal is a draw). The window to pick shrinks every
// throw (D40), so the duel speeds up as it goes.
//
// The snapshot is public (a bye watches another duel from it), so a hand never goes on the wire
// before its reveal — only whether it has been picked.

export type RpsHand = 'rock' | 'paper' | 'scissors'
export const RPS_HANDS: readonly RpsHand[] = ['rock', 'paper', 'scissors']

export const RPS = {
  winsNeeded: 3,
  // The pick window: 4 s for the first throw, ×0.88 each throw after, never under 1.8 s.
  chooseMs: 4000,
  chooseFactor: 0.88,
  chooseMinMs: 1800,
  revealMs: 1800,
} as const

// How long throw `n` (1-based) gives to pick.
export function rpsChooseMs(n: number): number {
  return Math.round(compound(RPS.chooseMs, RPS.chooseFactor, n - 1, RPS.chooseMinMs))
}

// Whether `a` beats `b`.
export function rpsBeats(a: RpsHand, b: RpsHand): boolean {
  return (
    (a === 'rock' && b === 'scissors') ||
    (a === 'scissors' && b === 'paper') ||
    (a === 'paper' && b === 'rock')
  )
}

export type RpsOutcome = 'win' | 'loss' | 'draw'

// A throw from one side: a hand beats nothing (null = didn't pick in time); two idles draw.
export function rpsOutcome(mine: RpsHand | null, theirs: RpsHand | null): RpsOutcome {
  if (mine === null && theirs === null) return 'draw'
  if (mine === null) return 'loss'
  if (theirs === null) return 'win'
  if (mine === theirs) return 'draw'
  return rpsBeats(mine, theirs) ? 'win' : 'loss'
}

// A revealed throw, from the viewing player's side.
export interface RpsThrow {
  mine: RpsHand | null
  theirs: RpsHand | null
  outcome: RpsOutcome
}

export interface RpsPlayerView {
  opponentId: string | null // null = bye (odd player out): ranks with the draws
  // Throws won so far.
  mine: number
  theirs: number
  // The throw being played (1-based).
  throwNo: number
  phase: 'choose' | 'reveal' | 'done'
  msLeft: number
  // This throw's whole pick window (for the timer bar).
  chooseMs: number
  youChose: boolean
  theyChose: boolean
  // Every revealed throw so far, oldest first (the last one is shown during the reveal).
  history: RpsThrow[]
  won: boolean | null // null = undecided / draw / bye
  oppLeft: boolean // you won because your opponent left the game
}

export interface RpsSnapshot {
  roundRemainingMs: number
  players: Record<string, RpsPlayerView>
}

// Pick a hand for the current throw (final once sent).
export interface RpsInput {
  kind: 'throw'
  hand: RpsHand
}
