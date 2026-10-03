// Reaction Duel wire shapes. Red light -> wait -> green light; tap as fast as possible after green.
// Tapping before green is a false start. Fastest reaction wins; false starts / no-taps rank last.

export interface ReactionSnapshot {
  // The round's players (the results board lists every one of them).
  players: string[]
  light: 'red' | 'green'
  // ms until the light turns green (0 once green).
  greenInMs: number
  // playerId -> credited reaction time in ms (present once they tapped after green).
  reactions: Record<string, number>
  // players who jumped the gun.
  falseStarts: string[]
}

// `ms`: the client's own reaction time, from the moment its screen turned green to the tap (absent for
// a tap made before that). It keeps the network round trip out of the score; the server credits it
// only within a sane bound of its own measurement.
export interface ReactionInput {
  kind: 'tap'
  ms?: number
}
