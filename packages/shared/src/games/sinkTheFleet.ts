// Sink the Fleet wire shapes (duel format). Simultaneous 1v1 Battleship: players are paired, each fires
// at their opponent's hidden fleet on their turn (a hit shoots again). The snapshot is PUBLIC by design
// (a bye watches another duel from it) but never carries ship positions — only the result of each shot
// (hit/miss) — so nothing exploitable is on the wire and the server stays authoritative. Your own fleet
// is auto-placed and revealed only as it takes damage.

export interface SinkTheFleetDuelView {
  opponentId: string | null // null = bye (odd player out); ranks with the draws
  yourTurn: boolean
  turnRemainingMs: number
  // Shots you have fired at your opponent's grid, in firing order, each packed as one number
  // (encodeShot / decodeShot). The damage your own fleet took is your opponent's hits.
  shots: number[]
  hitsOnOpponent: number
  hitsOnYou: number
  fleetCells: number // total ship cells per player
  done: boolean
  won: boolean | null // null = undecided / draw / bye
  oppLeft: boolean // you won because your opponent left the game
}

export interface SinkTheFleetSnapshot {
  grid: number // side length; the board has grid*grid cells
  roundRemainingMs: number
  // Per-player duel view, keyed by playerId. The scene renders the local player's view.
  players: Record<string, SinkTheFleetDuelView>
}

// A shot on the wire: `cell * 2`, plus 1 if it hit. A full room's snapshot carries up to ~150 shots six
// times a second, so they travel as bare numbers rather than {cell, hit} objects.
export const encodeShot = (cell: number, hit: boolean): number => cell * 2 + (hit ? 1 : 0)
export const decodeShot = (shot: number): { cell: number; hit: boolean } => ({
  cell: Math.floor(shot / 2),
  hit: shot % 2 === 1,
})

// One input = fire at a cell on the opponent's grid. Honoured only on the sender's turn, for an
// in-range cell not already fired at. A hit keeps the turn; a miss passes it.
export interface SinkTheFleetInput {
  kind: 'fire'
  cell: number
}
