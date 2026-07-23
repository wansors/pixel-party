// Pixel Pong (B1) wire shapes. A real-time 1v1 duel: players are seeded-paired, each controls a paddle
// on their side, and the server simulates the ball authoritatively. Each client renders its own paddle
// locally (immediate) and the ball + opponent paddle from the snapshot, smoothed by the interpolator.
// First to WIN_SCORE, or the leader when the round timer expires (tie = draw). Positions are normalized
// (x,y in [0,1]).

export interface PongPlayerView {
  opponentId: string | null
  side: 'left' | 'right'
  // Paddle centre y for this player and the opponent, in [0,1].
  youY: number
  oppY: number
  ballX: number
  ballY: number
  scoreYou: number
  scoreOpp: number
  done: boolean
  // Final outcome once done: true win / false loss / null draw. null while playing.
  won: boolean | null
}

export interface PongSnapshot {
  roundRemainingMs: number
  // Keyed by playerId; the client reads its own view via selfId.
  players: Record<string, PongPlayerView>
}

// Drag to move the paddle: y is the normalized [0,1] paddle centre.
export interface PongInput {
  kind: 'move'
  y: number
}
