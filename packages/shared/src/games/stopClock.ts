// Stop the Clock (timing) wire shapes. A needle sweeps a bar; stop it as close to the seeded target as
// possible, over several attempts. The needle is animated + reported client-side (a friendly timing
// game tolerant to latency); the server owns the seeded targets and the error/ranking.

export interface StopClockSnapshot {
  // Seeded target positions in [0,1], one per attempt (shared by everyone).
  targets: number[]
  attempts: number
  // playerId -> attempts already taken.
  attemptsDone: Record<string, number>
  // playerId -> accumulated absolute error so far (lower is better).
  totalError: Record<string, number>
  remainingMs: number
}

// Lock the needle for `attempt` at position `pos` (0..1). The server scores it against targets[attempt].
export interface StopClockInput {
  kind: 'stop'
  attempt: number
  pos: number
}
