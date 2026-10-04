// Sumo Push (B3) wire shapes and physics. A real-time FFA arena: every player is a sumo in one shared
// ring, shoving the others. Steer with a direction vector and DASH (a burst of speed with a cooldown) to
// slam into someone; bodies collide and transfer momentum; the ring shrinks over the round; leave it and
// you are out. Last standing wins (survival time ranks the rest). The server owns the physics; the
// client runs the SAME `sumoStep` forward from each snapshot (its own wrestler with the keys it holds
// right now, everyone else with their last push), so your sumo answers on the frame you press and
// everyone is drawn where they are now, not a snapshot ago. Positions normalized to [0,1] with the ring
// centred at (0.5, 0.5).

export const SUMO = {
  center: 0.5,
  // The ring holds its size for the first `shrinkFrom` of the round, then closes in linearly to
  // `ringEnd` — narrower than a wrestler, so even a bout of centre-huggers ends with one left.
  ringR: 0.42,
  ringEnd: 0.04,
  shrinkFrom: 0.4,
  playerR: 0.05,
  spawnR: 0.22, // players start on a circle this far from the centre
  accel: 1.4, // normalized units / s²
  // Top speed under your own steam. A shove or a dash can carry you faster (friction bleeds it off), up
  // to hardMaxSpeed.
  maxSpeed: 0.7,
  hardMaxSpeed: 1.4,
  // Collisions swap the bodies' approach speeds (equal masses, elastic): a dash's momentum goes into
  // the one it hits. Above 1 they'd add energy, and two dashers would launch each other out.
  restitution: 1.0,
  friction: 2.0, // velocity decay coefficient (per second)
  // Dash: a burst to dashSpeed toward where you push, once per dashCooldownMs — the way to knock a
  // centre-holder out (and to fly out yourself if you miss). dashMs is how long it shows as a dash.
  dashSpeed: 1.2,
  dashCooldownMs: 1500,
  dashMs: 250,
} as const

// The physical state of one wrestler, the same on both sides.
export interface SumoPhys {
  x: number
  y: number
  vx: number
  vy: number
  // Push direction (unit vector, or 0,0).
  ax: number
  ay: number
  alive: boolean
}

// Advances every live body by `dt` ms: steering (capped at maxSpeed, momentum beyond it isn't clipped,
// friction bleeds it), then pairwise elastic collisions.
export function sumoStep(bodies: readonly SumoPhys[], dt: number): void {
  const step = dt / 1000
  const live = bodies.filter((b) => b.alive)
  for (const b of live) {
    const before = Math.hypot(b.vx, b.vy)
    b.vx += b.ax * SUMO.accel * step
    b.vy += b.ay * SUMO.accel * step
    const sp = Math.hypot(b.vx, b.vy)
    const cap = Math.min(SUMO.hardMaxSpeed, Math.max(SUMO.maxSpeed, before))
    if (sp > cap) {
      b.vx = (b.vx / sp) * cap
      b.vy = (b.vy / sp) * cap
    }
    const drag = Math.max(0, 1 - SUMO.friction * step)
    b.vx *= drag
    b.vy *= drag
    b.x += b.vx * step
    b.y += b.vy * step
  }
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) collide(live[i] as SumoPhys, live[j] as SumoPhys)
  }
}

function collide(a: SumoPhys, b: SumoPhys): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const min = SUMO.playerR * 2
  if (d <= 0 || d >= min) return
  const nx = dx / d
  const ny = dy / d
  // Separate the overlap so bodies don't stick.
  const overlap = (min - d) / 2
  a.x -= nx * overlap
  a.y -= ny * overlap
  b.x += nx * overlap
  b.y += ny * overlap
  // Exchange the normal velocity components only when they are approaching.
  const va = a.vx * nx + a.vy * ny
  const vb = b.vx * nx + b.vy * ny
  if (va - vb <= 0) return
  const imp = (vb - va) * SUMO.restitution
  a.vx += imp * nx
  a.vy += imp * ny
  b.vx -= imp * nx
  b.vy -= imp * ny
}

// A dash: launched toward where the body pushes (no push direction, no dash).
export function sumoDash(b: SumoPhys): boolean {
  if (!b.alive || (b.ax === 0 && b.ay === 0)) return false
  b.vx = b.ax * SUMO.dashSpeed
  b.vy = b.ay * SUMO.dashSpeed
  return true
}

// A push vector as the server stores it: unit length, or 0,0 for "not pushing".
export function sumoAim(dx: number, dy: number): { ax: number; ay: number } {
  const mag = Math.hypot(dx, dy)
  return mag < 0.001 ? { ax: 0, ay: 0 } : { ax: dx / mag, ay: dy / mag }
}

export interface SumoBody extends SumoPhys {
  id: string
  // Mid-dash (for the speed streak).
  dashing: boolean
  // The `seq` of the last dash the server took from this player (the client stops predicting it).
  dash: number
}

export interface SumoSnapshot {
  // Current ring radius in normalized units (shrinks over the round).
  ring: number
  bodies: SumoBody[]
  remainingMs: number
}

// Steer: a direction vector (need not be unit; the server normalizes). {0,0} = stop pushing. Dash: a
// burst toward where you push; ignored while it recharges or when you aren't pushing anywhere.
export type SumoInput = { kind: 'move'; dx: number; dy: number } | { kind: 'dash'; seq?: number }
