// Quick Draw Duel wire shapes (duel format). A western reaction shootout: players are seeded-paired
// 1v1, both wait, and after a seeded delay the signal fires. First to tap after the signal wins;
// tapping before it is a false start and loses, and if nobody draws in time both lose. The snapshot is
// PUBLIC by design (a bye watches another duel from it) but never carries the raw fire time — only the
// `fired` boolean — so the delay stays server-authoritative and unexploitable.

export interface QuickDrawPlayerView {
  opponentId: string | null // null = bye (odd player out); ranks with the draws
  fired: boolean // the signal has fired for this duel (now >= fireAt)
  youDrew: boolean // you have tapped this duel
  done: boolean
  won: boolean | null // null = undecided, or a bye
  reactionMs: number | null // your credited reaction time, once you have drawn after the signal
  oppLeft: boolean // you won because your opponent left the game
}

export interface QuickDrawSnapshot {
  roundRemainingMs: number
  // Per-player duel view, keyed by playerId. The scene renders the local player's view.
  players: Record<string, QuickDrawPlayerView>
}

// One input = draw (tap). Before the signal fires it is a false start; after, the first valid draw
// wins the duel. `ms`: the client's own reaction time, from the moment its sign said FIRE! to the tap
// (absent for a tap made before that). It keeps the snapshot cadence and the network out of the time;
// the server credits it only within a bounded window of its own measurement.
export interface QuickDrawInput {
  kind: 'draw'
  ms?: number
}
