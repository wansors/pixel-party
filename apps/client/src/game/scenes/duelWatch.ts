// How long a finished duel's verdict stays on a spectator's screen before the camera moves on.
const HOLD_MS = 2500
// How long your own duel's verdict stays up once it's over before you start watching a duel that is
// still running (if there is one) — so nobody stares at a static card while the others finish.
const OWN_HOLD_MS = 4000

// The part of a per-player duel view a spectator needs to pick a duel.
export interface DuelSeat {
  opponentId: string | null
  done: boolean
}

// Duel spectators (D28): the bye — or a client with no seat this round — watches one live duel,
// read-only, instead of a static card; so does a duellist whose own duel is over, after a moment on
// its verdict (`follow`). Every duel sits twice in a duel snapshot (once per player), so a duel is
// picked through one of its players: the view the scene then renders. Stays on a duel until it ends,
// holds the verdict for a moment, then moves on to another running duel if there is one.
// `prefer` picks which of the two players' views represents a duel (default: the smaller id).
export class DuelWatch {
  private id: string | null = null
  private doneAt = -1
  private ownDoneAt = -1

  reset(): void {
    this.id = null
    this.doneAt = -1
    this.ownDoneAt = -1
  }

  // Whose duel to show `selfId`: their own while it runs and for OWN_HOLD_MS after it ends, then a duel
  // still being played (back to their own verdict once nothing is left to watch); a bye or a client
  // with no seat simply watches (`pick`).
  follow<V extends DuelSeat>(
    players: Readonly<Record<string, V>>,
    selfId: string,
    time: number,
    prefer: (id: string, view: V) => boolean = byId,
  ): string | null {
    const own = players[selfId]
    if (!own?.opponentId) return this.pick(players, time, prefer)
    if (!own.done) {
      this.ownDoneAt = -1
      return selfId
    }
    if (this.ownDoneAt < 0) this.ownDoneAt = time
    if (time - this.ownDoneAt < OWN_HOLD_MS) return selfId
    const rival = own.opponentId
    const others = (id: string, view: V): boolean =>
      id !== selfId && id !== rival && prefer(id, view)
    const live = Object.keys(players).some((id) => {
      const view = players[id]
      return !!view && !view.done && view.opponentId !== null && others(id, view)
    })
    // Nothing else running (and not already watching one): stay on your own verdict.
    if (!live && (this.id === null || !players[this.id] || this.id === selfId)) return selfId
    return this.pick(players, time, others) ?? selfId
  }

  pick<V extends DuelSeat>(
    players: Readonly<Record<string, V>>,
    time: number,
    prefer: (id: string, view: V) => boolean = byId,
  ): string | null {
    const current = this.id === null ? undefined : players[this.id]
    const eligible = current !== undefined && this.id !== null && prefer(this.id, current)
    if (current && eligible && !current.done) return this.id
    if (current && eligible && this.doneAt < 0) this.doneAt = time
    if (current && eligible && time - this.doneAt < HOLD_MS) return this.id
    const duels = Object.keys(players)
      .filter((id) => {
        const view = players[id]
        return !!view && view.opponentId !== null && prefer(id, view)
      })
      .sort()
    const next =
      duels.find((id) => !players[id]?.done) ?? (current && eligible ? this.id : duels[0])
    if (next !== this.id) {
      this.id = next ?? null
      this.doneAt = -1
    }
    return this.id
  }
}

// One view per duel: the player with the smaller id.
const byId = (id: string, view: DuelSeat): boolean => id < (view.opponentId ?? '')

// The HUD line of a duellist whose own duel is over while they watch another one.
export function verdictKey(won: boolean | null): string {
  return won === null ? 'game.common.draw' : won ? 'game.common.youWin' : 'game.common.youLose'
}
