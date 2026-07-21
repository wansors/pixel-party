// Pixel Split ("cut in half") wire shapes. A pixel-art object is shown; place a vertical cut so both
// halves hold the same number of filled pixels. A seeded object sequence is shared by everyone; each
// player advances at their own pace. The server owns the per-column counts and scores the cut.
import type { PixelCell } from './pixelObjects'

export interface PixelSplitObject {
  // Index into the player's sequence; echoed back on the cut so the server drops stale input.
  index: number
  name: string
  cols: number
  rows: number
  pixels: PixelCell[]
}

export interface PixelSplitSnapshot {
  objects: Record<string, PixelSplitObject | null>
  scores: Record<string, number>
  remainingMs: number
}

export interface PixelSplitInput {
  kind: 'cut'
  index: number
  // Column boundary in 1..cols-1: cells with x < cut fall left, the rest fall right.
  cut: number
}
