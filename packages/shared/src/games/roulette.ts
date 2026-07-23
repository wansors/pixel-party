// Pixel Roulette (D3) wire shapes. Pure-luck shake-up (Mario-Party style, used sparingly): every player
// is dealt a hidden seeded value at the start; tap to spin and reveal it. Highest value wins. The server
// owns the values; a player's value only becomes public once they have spun.

export interface RouletteSnapshot {
  // playerId → whether they have spun yet.
  spun: Record<string, boolean>
  // playerId → their value, present only once that player has spun (or at the end).
  values: Record<string, number>
  remainingMs: number
}

export interface RouletteInput {
  kind: 'spin'
}
