// Pixel Weight ("guess the weight") wire shapes. A pixel-art object flashes briefly; guess how many
// filled pixels it has. A seeded object sequence is shared by everyone; each player advances at their
// own pace. The server owns the true counts and scores by how close the guess is.

export interface PixelWeightObject {
  // Index into the shared sequence; echoed back on guess so the server drops stale input.
  index: number
  name: string
  cols: number
  rows: number
  // The filled cells, packed (packCells / unpackCells in pixelObjects).
  bits: string
  // How long the client shows the object before hiding it and asking for a guess.
  flashMs: number
  // Upper bound for the guess slider (the grid area).
  maxGuess: number
}

export interface PixelWeightSnapshot {
  // The objects players are on right now, each sent once: the sequence is shared, so everyone on the
  // same level shares an object, and a full room never pays for twelve copies of it.
  objects: PixelWeightObject[]
  // playerId -> index of the object that player is on (null once the sequence is exhausted).
  at: Record<string, number | null>
  // playerId -> accumulated points.
  scores: Record<string, number>
  remainingMs: number
}

export interface PixelWeightInput {
  kind: 'guess'
  index: number
  value: number
}
