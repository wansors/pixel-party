// Brawl wire shapes (Streets of Rage style). A real-time FFA beat 'em up: everyone in one side-view
// street (walk along it and up/down its depth). PUNCH is quick (the third in a row knocks down), KICK
// reaches further and shoves, GRAB throws whoever is right next to you. Items drop onto the street on a
// seeded schedule: a pipe (harder, longer punches for a few swings), a bottle (one smashing hit) and roast
// chicken (heals). Drop to 0 HP and you're knocked out for good. Last one standing wins; the rest rank by
// KO credit (the finisher takes half of each KO, the other half is split by the damage everyone dealt
// that fighter), then how long they lasted. A fighter who leaves the round drops off the wire.
//
// World units: the street is BRAWL.w long and BRAWL.depth deep (y = 0 is the back, against the wall).

export const BRAWL = {
  w: 2,
  depth: 0.4,
  hp: 100,
  // Body half-width used for spacing / pick-ups.
  bodyR: 0.035,
  speedX: 0.45,
  speedY: 0.3,
  // How far up/down the street (depth) an attack still connects.
  laneTolerance: 0.05,
} as const

export type BrawlItemKind = 'pipe' | 'bottle' | 'chicken'

export type BrawlAction = 'idle' | 'walk' | 'punch' | 'kick' | 'grab' | 'hurt' | 'down' | 'ko'

export interface BrawlFighter {
  id: string
  x: number
  y: number
  // 1 = facing right, -1 = left.
  face: 1 | -1
  hp: number
  action: BrawlAction
  // Time spent in the current action (drives the client's animation).
  actionMs: number
  weapon: 'pipe' | 'bottle' | null
  // Swings left on the pipe.
  uses: number
  // Briefly untouchable after getting up.
  guard: boolean
  // KO credit, to one decimal (a solo KO is 1; shared ones split, see above).
  kos: number
  // Held direction (for the client's prediction).
  dx: number
  dy: number
}

export interface BrawlSnapshot {
  fighters: BrawlFighter[]
  // [id, x, y, kind]
  items: [number, number, number, BrawlItemKind][]
  remainingMs: number
}

// move: held direction (normalized server-side). punch / kick / grab: one attack each press.
export type BrawlInput =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'punch' }
  | { kind: 'kick' }
  | { kind: 'grab' }
