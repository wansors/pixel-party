// Snake Arena wire shapes. Classic grid snake: every player has their own independent board of the same
// size and the same seeded food sequence, and turns their snake with direction inputs. Eating food grows
// the snake; crashing into a wall or your own body kills it. The server owns the timeline and stepping;
// each client renders only its own board (via selfId) directly from the latest snapshot.

export interface Cell {
  x: number
  y: number
}

export interface SnakeView {
  // Head-first list of the snake's occupied cells.
  body: Cell[]
  alive: boolean
  len: number
}

export interface SnakeSnapshot {
  // playerId -> that player's snake. Every board is present; the client renders only its own.
  snakes: Record<string, SnakeView>
  // playerId -> that player's current food cell.
  food: Record<string, Cell>
  // Board side length (grid is grid x grid).
  grid: number
  remainingMs: number
}

// Turn the snake. A direct reversal of the current heading is ignored by the server.
export interface SnakeInput {
  kind: 'turn'
  dir: 'up' | 'down' | 'left' | 'right'
}
