// Fruit Catch (D2) wire shapes. One seeded stream of falling items (fruit + the odd bomb) is shared by
// everyone; each player drags their own basket along the bottom to catch fruit and dodge bombs. The
// server owns the timeline, the item positions and the scoring; the client renders the currently-visible
// items (smoothed by the snapshot interpolator) and its own basket locally.

export type FruitKind = 'fruit' | 'bomb'

export interface FruitItem {
  // Stable id so the client can interpolate an item's fall between snapshots.
  id: number
  // Normalized position: x in [0,1] across the play area, y in [0,1] top→bottom.
  x: number
  y: number
  kind: FruitKind
}

export interface FruitCatchSnapshot {
  // Items currently on screen (0 ≤ y ≤ 1), shared across all players.
  items: FruitItem[]
  // playerId → score and current catch combo (consecutive fruit caught).
  scores: Record<string, number>
  combos: Record<string, number>
  remainingMs: number
}

// Drag the basket: x is the normalized [0,1] basket centre. The server clamps and uses the latest x
// when an item reaches the catch line.
export interface FruitCatchInput {
  kind: 'move'
  x: number
}
