// Pang wire shapes (Buster Bros style). A real-time FFA race: every player gets their own arena with the
// same seeded waves of bouncing balloons. Walk left/right along the floor and fire a harpoon straight up;
// a hit splits a balloon into two smaller ones (four sizes — the smallest just pops). Touching a balloon
// costs one of PANG.lives lives (then a short blink of invulnerability); out of lives, you're out.
// Clear a wave and the next, bigger one drops in. Ranked by balloons popped.
//
// World units: the arena is PANG.w wide and PANG.h tall, y grows downward, the floor is at y = PANG.h.

export const PANG = {
  w: 1,
  h: 0.7,
  lives: 3,
  // Balloon radius per size (index = size, 1 = tiniest … 4 = biggest).
  radius: [0, 0.022, 0.036, 0.056, 0.082],
  playerHalfW: 0.026,
  playerH: 0.07,
  // Physics, shared so the client can run the same balloon motion between snapshots.
  gravity: 1.3,
  // Bounce height (of the balloon's centre above its resting point) per size — bigger bounce higher.
  bounceH: [0, 0.2, 0.28, 0.36, 0.44],
  vx: 0.16,
  walk: 0.45,
  harpoonSpeed: 0.95,
} as const

// [x, y, size, vx, vy] per balloon, rounded for the wire.
export type PangBalloon = [number, number, number, number, number]

export interface PangArena {
  id: string
  x: number
  // Harpoon tip height and the x it was fired from, while one is flying (null = ready to fire).
  harpoon: number | null
  harpoonX: number | null
  balloons: PangBalloon[]
  pops: number
  lives: number
  // Blinking after a hit (balloons pass through).
  shielded: boolean
  wave: number
  out: boolean
}

export interface PangSnapshot {
  arenas: PangArena[]
  remainingMs: number
}

// move: -1 left · 0 stop · 1 right (held state). fire: launch the harpoon if none is flying.
export type PangInput = { kind: 'move'; dir: -1 | 0 | 1 } | { kind: 'fire' }
