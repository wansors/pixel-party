// Bomber Express wire shapes (Bomberman style). A real-time FFA on a BOMBER.w × BOMBER.h grid: border
// walls, a pillar on every even/even cell and a seeded scatter of crates. Everyone starts FULLY POWERED
// (long fire, a pocketful of bombs, fast boots) — chaos from the first second — and crates drop more
// power-ups. Bombs explode after a fuse in a cross that stops at walls (and at the first crate, which it
// breaks), setting off any bomb in its path. Caught in the flames, you're knocked out. Last one standing
// wins; the rest rank by knock-outs scored, then time survived, then crates broken (also the tiebreak
// between survivors at the buzzer). Spawn cells (up to 12) are dealt with the round's seed.
//
// Movement is tile to tile (held direction); the client interpolates each step.

export const BOMBER = {
  w: 17,
  h: 13,
  fuseMs: 2200,
  flameMs: 550,
  startRange: 5,
  startBombs: 5,
  maxRange: 9,
  maxBombs: 8,
  // Milliseconds per tile at speed level 0, 1, 2, 3 (everyone starts at 1).
  stepMs: [190, 150, 125, 105],
} as const

// Grid cells, row-major: '#' wall/pillar · 'c' crate · '.' floor · power-ups on the floor:
// 'r' +1 fire range · 'b' +1 bomb · 's' faster boots.
export type BomberGrid = string

export type BomberDir = 'up' | 'down' | 'left' | 'right'

export interface BomberPlayer {
  id: string
  // The tile they stand on, and the one they're stepping to (same when idle) with step progress 0…1.
  x: number
  y: number
  tx: number
  ty: number
  step: number
  stepMs: number
  alive: boolean
  range: number
  bombs: number
  speed: number
  kos: number
  // Out because they disconnected (not a knock-out).
  left: boolean
}

export interface BomberSnapshot {
  grid: BomberGrid
  // [x, y, fuseLeftMs, ownerIndex]
  bombs: [number, number, number, number][]
  // [x, y, msLeft] per burning cell.
  flames: [number, number, number][]
  players: BomberPlayer[]
  remainingMs: number
}

// move: the held direction (null = stand still). bomb: drop one where you stand.
export type BomberInput = { kind: 'move'; dir: BomberDir | null } | { kind: 'bomb' }
