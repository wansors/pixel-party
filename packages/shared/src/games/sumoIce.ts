// Sumo ICE wire shapes. A real-time FFA battle royale: Sumo Push on an ice floe that melts. The floe is
// a SUMO_ICE.grid × grid patch of ice tiles inside a circle; a seeded melt order eats it from the
// edge inward (irregularly), each tile cracking for SUMO_ICE.crackMs before it sinks. Physics is sumo's
// shove-and-bounce but on ice — little grip, long slides. A body whose centre is over open water falls
// in: the first time a lifebuoy fishes it back out onto the floe's core (a short ghost spell without
// collisions follows), the second time it is out. Last one standing wins; survival time ranks the rest.
// Positions are normalized to [0,1].

export const SUMO_ICE = {
  grid: 13,
  // Tiles whose centre lies within this radius of (0.5, 0.5) make up the floe.
  floeR: 0.47,
  playerR: 0.04,
  crackMs: 1500,
  lives: 2,
  ghostMs: 1200,
} as const

// Tile states as one character each, row-major (y * grid + x): '.' water · '#' ice · '%' cracking.
export type SumoIceTiles = string

export interface SumoIceBody {
  id: string
  x: number
  y: number
  alive: boolean
  // Falls left before elimination (the lifebuoy is the first), and whether it just respawned.
  lives: number
  ghost: boolean
}

export interface SumoIceSnapshot {
  tiles: SumoIceTiles
  bodies: SumoIceBody[]
  remainingMs: number
}

// Steer: a direction vector (normalized server-side). {0,0} = coast.
export interface SumoIceInput {
  kind: 'move'
  dx: number
  dy: number
}
