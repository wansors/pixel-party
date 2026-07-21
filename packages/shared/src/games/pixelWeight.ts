// Pixel Weight ("guess the weight") wire shapes. A pixel-art object flashes briefly; guess how many
// filled pixels it has. A seeded object sequence is shared by everyone; each player advances at their
// own pace. The server owns the true counts and scores by how close the guess is.
import type { PixelCell } from './pixelObjects'

export interface PixelWeightObject {
  // Index into the player's sequence; echoed back on guess so the server drops stale input.
  index: number
  name: string
  cols: number
  rows: number
  // Filled cells only.
  pixels: PixelCell[]
  // How long the client shows the object before hiding it and asking for a guess.
  flashMs: number
  // Upper bound for the guess slider (the grid area).
  maxGuess: number
}

export interface PixelWeightSnapshot {
  // playerId -> the object that player is currently on (null once the sequence is exhausted).
  objects: Record<string, PixelWeightObject | null>
  // playerId -> accumulated points.
  scores: Record<string, number>
  remainingMs: number
}

export interface PixelWeightInput {
  kind: 'guess'
  index: number
  value: number
}
