// How long a finished duel's verdict stays on a spectator's screen before the camera moves on.
const HOLD_MS = 2500

// The part of a per-player duel view a spectator needs to pick a duel.
export interface DuelSeat {
  opponentId: string | null
  done: boolean
}

// Duel spectators (D28): the bye — or a client with no seat this round — watches one live duel,
// read-only, instead of a static card. Every duel sits twice in a duel snapshot (once per player), so a
// duel is picked through one of its players: the view the scene then renders. Stays on a duel until it
// ends, holds the verdict for a moment, then moves on to another running duel if there is one.
// `prefer` picks which of the two players' views represents a duel (default: the smaller id).
export class DuelWatch {
  private id: string | null = null
  private doneAt = -1

  reset(): void {
    this.id = null
    this.doneAt = -1
  }

  pick<V extends DuelSeat>(
    players: Readonly<Record<string, V>>,
    time: number,
    prefer: (id: string, view: V) => boolean = (id, view) => id < (view.opponentId ?? ''),
  ): string | null {
    const current = this.id === null ? undefined : players[this.id]
    if (current && !current.done) return this.id
    if (current && this.doneAt < 0) this.doneAt = time
    if (current && time - this.doneAt < HOLD_MS) return this.id
    const duels = Object.keys(players)
      .filter((id) => {
        const view = players[id]
        return !!view && view.opponentId !== null && prefer(id, view)
      })
      .sort()
    const next = duels.find((id) => !players[id]?.done) ?? (current ? this.id : duels[0])
    if (next !== this.id) {
      this.id = next ?? null
      this.doneAt = -1
    }
    return this.id
  }
}
