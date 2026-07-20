// Reaction Duel wire shapes. Red light -> wait -> green light; tap as fast as possible after green.
// Tapping before green is a false start. Fastest reaction wins; false starts / no-taps rank last.

export interface ReactionSnapshot {
  light: 'red' | 'green'
  // ms until the light turns green (0 once green).
  greenInMs: number
  // playerId -> reaction time in ms (present once they tapped after green).
  reactions: Record<string, number>
  // players who jumped the gun.
  falseStarts: string[]
}

export interface ReactionInput {
  kind: 'tap'
}
