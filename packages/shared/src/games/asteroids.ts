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
  // Ship handling, shared so the client predicts its own ship with the server's physics: rotation
  // (rad/s), thrust (units/s²), drag (fraction of speed lost per second), top speed, the gun's cadence
  // and how many of your bullets may fly at once.
  turn: 3.8,
  thrust: 0.95,
  drag: 0.35,
  maxSpeed: 0.75,
  fireMs: 220,
  maxBullets: 4,
} as const

// One step of a ship's flight (the server's tick and the client's prediction share it): turn, thrust,
// drag, the speed cap, then move (wrapping round the arena).
export function asteroidsFly(
  s: { x: number; y: number; vx: number; vy: number; a: number },
  rot: number,
  thrust: boolean,
  step: number,
): void {
  s.a += rot * ASTEROIDS.turn * step
  if (thrust) {
    s.vx += Math.cos(s.a) * ASTEROIDS.thrust * step
    s.vy += Math.sin(s.a) * ASTEROIDS.thrust * step
  }
  const drag = Math.max(0, 1 - ASTEROIDS.drag * step)
  s.vx *= drag
  s.vy *= drag
  const sp = Math.hypot(s.vx, s.vy)
  if (sp > ASTEROIDS.maxSpeed) {
    s.vx = (s.vx / sp) * ASTEROIDS.maxSpeed
    s.vy = (s.vy / sp) * ASTEROIDS.maxSpeed
  }
  s.x = (((s.x + s.vx * step) % ASTEROIDS.w) + ASTEROIDS.w) % ASTEROIDS.w
  s.y = (((s.y + s.vy * step) % ASTEROIDS.h) + ASTEROIDS.h) % ASTEROIDS.h
}

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
