// Glass Bridge wire shapes. A turn-based FFA elimination round: a bridge of rows, each with a LEFT and a
// RIGHT glass panel — one tempered (holds), one that shatters. Players cross one at a time in a seeded
// vest order: #1 steps out first, the rest wait on the start platform and learn from every fall. Rows
// already solved are auto-walked; each unknown row is a timed LEFT/RIGHT jump. A lightning flash every
// few seconds briefly shows a glint on the tempered panel of the row being decided, and everyone who is
// not jumping can point LEFT/RIGHT at it ("heckle arrows" — honest advice or a lie).
//
// The server owns the bridge: a row's tempered side only goes on the wire once it is revealed (someone
// landed on it or fell through the other one), plus the glint during a flash.

export type GlassSide = 'L' | 'R'

export interface GlassBridgeRow {
  // Revealed tempered panel (null while nobody knows).
  safe: GlassSide | null
  // The panel someone fell through (null = both still intact).
  broken: GlassSide | null
}

export type GlassBridgeStatus = 'queue' | 'active' | 'crossed' | 'fallen'

export interface GlassBridgePlayer {
  id: string
  // Vest number (1 = first to cross).
  vest: number
  status: GlassBridgeStatus
  // Row the player stands on: -1 = start platform, `rows` = finish platform. A fallen player keeps the
  // row they fell through.
  pos: number
}

// What the bridge is doing right now (drives the client animation).
// walk = the next player is auto-walking the known rows · decide = the active player must jump ·
// jump = in the air toward `jumpSide` · fall = the panel shattered under them · done = round over.
export type GlassBridgePhase = 'walk' | 'decide' | 'jump' | 'fall' | 'done'

export interface GlassBridgeSnapshot {
  rows: GlassBridgeRow[]
  // In vest order.
  players: GlassBridgePlayer[]
  active: string | null
  phase: GlassBridgePhase
  // Row the active player is deciding / jumping to (null when nobody is on the bridge).
  target: number | null
  jumpSide: GlassSide | null
  // Time left in the current decide window (the jump timer) and its full length.
  decideMs: number
  decideTotalMs: number
  // Present only while a lightning flash is lit: the tempered side of the row being decided. `id`
  // increments per flash so the client plays each one exactly once.
  glint: { id: number; row: number; side: GlassSide } | null
  // Heckle arrows for the current target row (everyone but the active player may point).
  pointers: { id: string; side: GlassSide }[]
  remainingMs: number
}

// jump: the active player picks a panel for the target row. point: anyone else points at one (null
// lowers the arrow).
export type GlassBridgeInput =
  | { kind: 'jump'; side: GlassSide }
  | { kind: 'point'; side: GlassSide | null }
