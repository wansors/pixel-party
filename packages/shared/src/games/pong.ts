// Pixel Pong (B1) wire shapes. A real-time 1v1 duel: players are seeded-paired, each controls a paddle
// on their side, and the server simulates the ball authoritatively. Each client renders its own paddle
// locally (immediate) and the ball + opponent paddle from the snapshot, smoothed by the interpolator.
// First to WIN_SCORE, or the leader when the round timer expires; a tie plays a golden point (next point
// wins) for a few seconds more, then it's a draw. Positions are normalized (x,y in [0,1]). The snapshot
// is public: a bye (or a late joiner) watches someone else's duel from it, read-only.

export interface PongPlayerView {
  opponentId: string | null // null = bye (odd player out); ranks with the draws
  side: 'left' | 'right'
  // Paddle centre y for this player and the opponent, in [0,1].
  youY: number
  oppY: number
  ballX: number
  ballY: number
  scoreYou: number
  scoreOpp: number
  // Tied at the timer: the next point wins.
  golden: boolean
  done: boolean
  // Final outcome once done: true win / false loss / null draw or bye. null while playing.
  won: boolean | null
  oppLeft: boolean // you won because your opponent left the game
}

export interface PongSnapshot {
  // Regular time left; once it's up, the time left for the golden points still being played.
  roundRemainingMs: number
  // Keyed by playerId; the client reads its own view via selfId.
  players: Record<string, PongPlayerView>
}

// Drag to move the paddle: y is the normalized [0,1] paddle centre.
export interface PongInput {
  kind: 'move'
  y: number
}
