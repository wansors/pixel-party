// Sumo Push (B3) wire shapes. A real-time FFA arena: every player is a sumo in one shared ring, shoving
// the others. Steer with a direction vector; bodies collide and transfer momentum; leave the ring and
// you are out. Last standing wins (survival time ranks the rest). The server owns the physics; the
// client renders all bodies from the snapshot, smoothed by the interpolator. Positions normalized to
// [0,1] with the ring centred at (0.5, 0.5).

export interface SumoBody {
  id: string
  x: number
  y: number
  alive: boolean
}

export interface SumoSnapshot {
  // Ring radius in normalized units (for the client to draw the arena).
  ring: number
  bodies: SumoBody[]
  remainingMs: number
}

// Steer: a direction vector (need not be unit; the server normalizes). {0,0} = stop pushing.
export interface SumoInput {
  kind: 'move'
  dx: number
  dy: number
}
