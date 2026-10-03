// Jump Rope wire shapes. An FFA elimination round: everyone stands in a row while a giant rope swings
// round, faster and faster. Jump (one tap) so you're in the air when it sweeps under your feet: a
// first miss trips you (a heart), a second one sweeps you off — ELIMINATED. Last one standing wins; the
// rest rank by how many passes they cleared.

export const JUMP_ROPE = {
  // How long a jump lasts, and the stretch of it high enough to clear the rope.
  jumpMs: 480,
  clearFrom: 30,
  clearTo: 450,
  hearts: 2,
} as const

export interface JumpRopePlayer {
  id: string
  hearts: number
  alive: boolean
  // Time since the current jump started (null = on the ground).
  jumpMs: number | null
  cleared: number
}

export interface JumpRopeSnapshot {
  // Until the rope's next pass under the feet, and the current turn's length (the rope angle follows).
  nextPassMs: number
  periodMs: number
  // Passes so far (a counter so the client can play each one once).
  passes: number
  players: JumpRopePlayer[]
  remainingMs: number
}

export interface JumpRopeInput {
  kind: 'jump'
}
