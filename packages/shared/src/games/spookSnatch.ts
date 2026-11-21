import { compound } from '../difficulty'

// Spook Snatch wire shapes and rules shared by the server and the client (D46). Five objects sit in a
// row, each with its own shape AND colour (shape i is drawn in colour i): a blue cube, a red ball, a
// green star, a yellow triangle and a purple heart. A card — a snapshot the ghost took — shows two
// figures with shapes and colours mixed up. The object to grab: the one shown EXACTLY (its shape in its
// own colour) if there is one; otherwise the one whose shape and colour appear nowhere on the card.
// Everyone races the same card: the first right answers score, a wrong grab locks you out for a moment.
// Cards come faster, and turn and shrink, as the round goes on (D40).

export const SPOOK_SHAPES = ['cube', 'ball', 'star', 'triangle', 'heart'] as const
export const SPOOK_COLORS = ['blue', 'red', 'green', 'yellow', 'purple'] as const
export type SpookShape = (typeof SPOOK_SHAPES)[number]
export type SpookColor = (typeof SPOOK_COLORS)[number]
export const SPOOK_ITEMS = SPOOK_SHAPES.length

export const SPOOK = {
  // Everyone gets ready this long before the first card.
  startDelayMs: 1500,
  // A card's window: 4.2 s, ×0.93 per card, never under 1.9 s.
  windowMs: 4200,
  windowFactor: 0.93,
  windowMinMs: 1900,
  // The answer stays up this long after a card closes.
  revealMs: 1500,
  // A wrong grab locks you out this long (it can run into the next card).
  lockMs: 2000,
  // Points for the first right answers; every later right answer scores the last value.
  award: [3, 2, 1] as readonly number[],
  // Cards turn and shrink from this card on.
  twistFrom: 6,
} as const

export interface SpookFigure {
  shape: number
  color: number
  // Drawing only: turn (degrees) and size (1 = normal).
  rot: number
  scale: number
}

// The object to grab for these figures: an exact one (shape in its own colour) if shown, else the one
// whose shape and colour are both absent. -1 if the card has no single answer (never dealt).
export function spookAnswer(figures: readonly SpookFigure[]): number {
  const exact = figures.filter((f) => f.shape === f.color)
  if (exact.length === 1) return (exact[0] as SpookFigure).shape
  if (exact.length > 1) return -1
  const free: number[] = []
  for (let i = 0; i < SPOOK_ITEMS; i++) {
    if (figures.every((f) => f.shape !== i && f.color !== i)) free.push(i)
  }
  return free.length === 1 ? (free[0] as number) : -1
}

// How long card `n` (1-based) stays open.
export function spookWindowMs(n: number): number {
  return Math.round(compound(SPOOK.windowMs, SPOOK.windowFactor, n - 1, SPOOK.windowMinMs))
}

// Points for the `place`-th right answer (1-based).
export function spookAward(place: number): number {
  return SPOOK.award[Math.min(place, SPOOK.award.length) - 1] ?? 1
}

export interface SpookPlayerView {
  points: number
  // Ms of lock-out left (0 = free).
  lockedMs: number
  // On this card: answered, and if right, in which place (0 = not right / not yet).
  answered: boolean
  place: number
}

export interface SpookSnapshot {
  phase: 'ready' | 'card' | 'reveal'
  // The card in play (1-based) and its figures (absent before the first card).
  cardNo: number
  figures: SpookFigure[]
  // Only during the reveal: the object that was right.
  answer?: number
  // Ms left in this phase, and the card's whole window.
  phaseMs: number
  windowMs: number
  players: Record<string, SpookPlayerView>
  // playerId -> points, for the live standings.
  scores: Record<string, number>
  remainingMs: number
}

// Grab object `item` (0..4) for card `card`.
export interface SpookInput {
  kind: 'grab'
  item: number
  card: number
}
