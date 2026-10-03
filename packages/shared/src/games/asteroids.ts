// Competitive Asteroids wire shapes. A real-time FFA in ONE shared wrap-around arena: every player flies
// a ship (rotate, thrust, shoot). Asteroids split into smaller ones when shot (big → medium → small →
// gone) and pay more the smaller they are; shooting a rival pays most. A ship hit by a rock or a rival's
// bullet explodes and respawns a couple of seconds later, shielded, at the safest spot. Ranked by score.
//
// World units: the arena is ASTEROIDS.w × ASTEROIDS.h and wraps on every edge. The wire carries
// velocities so the client extrapolates everything smoothly between snapshots.

export const ASTEROIDS = {
  w: 1.6,
  h: 1,
  shipR: 0.024,
  // Rock radius and points per size (index = size: 1 small, 2 medium, 3 big).
  rockR: [0, 0.03, 0.055, 0.09],
  rockPts: [0, 100, 50, 20],
  rivalPts: 250,
  bulletSpeed: 1.25,
  bulletLifeMs: 850,
  respawnMs: 2000,
  shieldMs: 2000,
  // Rotation speed (rad/s), used by the client to predict its own ship.
  turn: 3.8,
} as const

export interface AsteroidsShip {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  // Heading in radians (0 = right, π/2 = down).
  a: number
  // Held controls (for the client's prediction / flame).
  rot: -1 | 0 | 1
  thrust: boolean
  alive: boolean
  // Shielded right after a respawn.
  shield: boolean
  // Parked: its pilot hasn't touched the controls yet. A ghost that bullets and rocks pass through.
  idle: boolean
  score: number
  kills: number
}

// [id, x, y, vx, vy, size] per rock and [x, y, vx, vy, ownerIndex] per bullet (rounded).
export type AsteroidsRock = [number, number, number, number, number, number]
export type AsteroidsBullet = [number, number, number, number, number]

export interface AsteroidsSnapshot {
  ships: AsteroidsShip[]
  rocks: AsteroidsRock[]
  bullets: AsteroidsBullet[]
  remainingMs: number
}

// Held-state controls: rotate (-1 left · 1 right), thrust and fire (fires at the gun's own cadence).
export interface AsteroidsInput {
  kind: 'controls'
  rot: -1 | 0 | 1
  thrust: boolean
  fire: boolean
}
