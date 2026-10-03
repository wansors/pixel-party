// Sumo Push (B3) wire shapes. A real-time FFA arena: every player is a sumo in one shared ring, shoving
// the others. Steer with a direction vector and DASH (a burst of speed with a cooldown) to slam into
// someone; bodies collide and transfer momentum; the ring shrinks over the round; leave it and you are
// out. Last standing wins (survival time ranks the rest). The server owns the physics; the client
// renders all bodies from the snapshot, smoothed by the interpolator. Positions normalized to [0,1] with
// the ring centred at (0.5, 0.5).

export interface SumoBody {
  id: string
  x: number
  y: number
  alive: boolean
  // Mid-dash (for the speed streak).
  dashing: boolean
}

export interface SumoSnapshot {
  // Current ring radius in normalized units (shrinks over the round).
  ring: number
  bodies: SumoBody[]
  remainingMs: number
}

// Steer: a direction vector (need not be unit; the server normalizes). {0,0} = stop pushing. Dash: a
// burst toward where you push; ignored while it recharges or when you aren't pushing anywhere.
export type SumoInput = { kind: 'move'; dx: number; dy: number } | { kind: 'dash' }
