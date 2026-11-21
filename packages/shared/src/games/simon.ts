// Simon (sequence memory) wire shapes. One seeded pad sequence is shared by everyone; each player
// watches the growing prefix and repeats it. A wrong pad ends that player's run. The server only ever
// sends the prefix up to a player's current level, and each player sees the sequence through their own
// seeded relabelling of the pads (same rhythm and repeats, different colours): the snapshot goes to the
// whole room, so a rival further ahead must not be showing anyone their next pads.

import { compound } from '../difficulty'

export interface SimonPlayback {
  // Beat between "level up!" (or the round start) and the first pad.
  leadInMs: number
  // How long each pad stays lit.
  onMs: number
  // Dark beat between two different pads.
  gapMs: number
  // Dark beat before a pad that repeats the previous one: longer, or the second flash of the same
  // colour barely reads as a separate tap.
  repeatGapMs: number
}

// The playback tempo at a level (= the sequence length, 1-based). It compounds: every level plays
// about 7% faster than the one before (D40), so the first levels stay relaxed and the long sequences
// late in a run also fly by — the tempo gain grows each level instead of staying flat. Held above a
// readable floor. The client animates the playback from this; the server keeps no playback clock.
export function simonPlayback(level: number): SimonPlayback {
  const step = Math.max(0, level - 1)
  return {
    leadInMs: 600,
    onMs: Math.round(compound(440, 0.93, step, 200)),
    gapMs: Math.round(compound(200, 0.93, step, 80)),
    repeatGapMs: Math.round(compound(440, 0.95, step, 240)),
  }
}

export interface SimonPlayerView {
  // The pads to reproduce at this player's current level (0-based pad indices, in this player's own
  // relabelling). Never longer than the level reached, so future pads stay hidden.
  seq: number[]
  // How many pads of the current replay the player has entered correctly so far.
  pos: number
  alive: boolean
}

export interface SimonSnapshot {
  players: Record<string, SimonPlayerView>
  // playerId -> levels completed (also the score).
  scores: Record<string, number>
  // Number of pads on the board.
  pads: number
  remainingMs: number
}

export interface SimonInput {
  kind: 'pad'
  pad: number
}
