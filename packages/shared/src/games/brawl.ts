// Brawl wire shapes (Streets of Rage style). A real-time FFA beat 'em up: everyone in one side-view
// street (walk along it and up/down its depth). PUNCH is quick (the third in a row knocks down), KICK
// reaches further and shoves, GRAB throws whoever is right next to you. Items drop onto the street on a
// seeded schedule: walk over a weapon to pick it up and PUNCH swings it instead of your fist — a pipe
// (harder, longer hits for a few swings), a baseball bat (fewer swings, each one knocks down), a bottle
// (one smashing hit) or a fuel can (thrown down the street; it blows up on the first fighter it reaches,
// or where it lands, floors everyone in the blast and sets off any other can lying in it) — and roast
// chicken heals. Drop to 0 HP and you're knocked out for good. Last one standing wins; the rest rank by
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
  // Each attack: how long it keeps the fighter busy, and when the next attack may start (ms). Shared so
  // the client can swing your own attack the moment you press (and not on a press the server refuses).
  moves: {
    punch: { ms: 180, cooldownMs: 280 },
    kick: { ms: 320, cooldownMs: 600 },
    grab: { ms: 450, cooldownMs: 1400 },
  },
  // How long a hit staggers (hurt) and a knock-down floors (down) a fighter.
  hurtMs: 260,
  downMs: 900,
  // A thrown fuel can: how fast and how far it flies, and the blast's half-extents (along the street,
  // across its depth) — shared so the client can fly it between snapshots and size the explosion.
  fuel: { speed: 1.3, range: 0.75, blastX: 0.2, blastY: 0.12 },
} as const

export type BrawlItemKind = 'pipe' | 'bat' | 'bottle' | 'fuel' | 'chicken'
// What a fighter can carry (everything but the chicken, which is eaten on the spot).
export type BrawlWeapon = Exclude<BrawlItemKind, 'chicken'>

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
  weapon: BrawlWeapon | null
  // Swings left on the pipe or bat (1 for a bottle or a fuel can).
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
  // Fuel cans in flight: [id, x, y, face].
  cans: [number, number, number, 1 | -1][]
  // Explosions of the last moment (each stays on the wire briefly so no client misses it): [id, x, y].
  blasts: [number, number, number][]
  remainingMs: number
}

// move: held direction (normalized server-side). punch / kick / grab: one attack each press.
export type BrawlInput =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'punch' }
  | { kind: 'kick' }
  | { kind: 'grab' }
