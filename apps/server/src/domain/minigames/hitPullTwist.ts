import {
  HPT,
  HPT_FREEZE,
  type HptInput,
  type HptPlayerView,
  type HptSnapshot,
  hptExpected,
  hptOrder,
  hptWindowMs,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
// An answer may arrive this much before the server thinks its order showed (network jitter).
const EARLY_MS = 150

interface Runner {
  // The order this player is on (= orders done).
  k: number
  alive: boolean
  // Server time order k shows (its window runs from here).
  orderAt: number
  outAt: number
}

export interface HptState {
  players: PlayerId[]
  seed: number
  runners: Map<PlayerId, Runner>
  startedAt: number
  endsAt: number
}

// Hit, Pull, Twist (D47): a real-time FFA elimination of called-out moves. Everyone plays the same
// seeded orders at their own pace: the client shows an order, the player answers, the next order
// shows HPT.gapMs later — and the server keeps the same clock for that player (each order's window
// runs from its last answer's arrival + the gap, so the trip time cancels out). A wrong move, a move
// during a FREEZE, or no move before the window (+ HPT.lateMs for the trip) closes is out; a FREEZE
// passes by itself when its window ends. The round ends at the bell or once everyone is out; the
// players rank by orders done (survivors at the bell share the top when level).
export class HitPullTwist implements MiniGame<HptState, HptInput> {
  readonly id = 'hit-pull-twist'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): HptState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const first = ctx.now + HPT.startDelayMs
    return {
      players: [...ctx.players],
      seed: Math.floor(ctx.random.next() * 2 ** 31),
      runners: new Map(
        ctx.players.map((id) => [id, { k: 0, alive: true, orderAt: first, outAt: 0 }]),
      ),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  private out(r: Runner, now: number): void {
    r.alive = false
    r.outAt = now
  }

  onInput(state: HptState, playerId: PlayerId, input: HptInput, now: number): HptState {
    const r = state.runners.get(playerId)
    if (input?.kind !== 'act' || !r?.alive || now >= state.endsAt) return state
    if (input.k !== r.k || !Number.isInteger(input.action) || input.action < 0 || input.action > 3)
      return state
    // Before this order could have shown: a stray (or a stale) press.
    if (now < r.orderAt - EARLY_MS) return state
    const order = hptOrder(state.seed, r.k)
    const late = now - r.orderAt > hptWindowMs(r.k) + HPT.lateMs
    if (order.action === HPT_FREEZE || input.action !== hptExpected(order) || late) {
      this.out(r, now)
      return state
    }
    r.k += 1
    r.orderAt = now + HPT.gapMs
    return state
  }

  tick(state: HptState, _dt: number, now: number): HptState {
    if (now >= state.endsAt) return state
    for (const r of state.runners.values()) {
      while (r.alive) {
        const window = hptWindowMs(r.k)
        if (hptOrder(state.seed, r.k).action === HPT_FREEZE) {
          // A FREEZE passes by itself once its window is over.
          if (now < r.orderAt + window) break
          r.orderAt += window + HPT.gapMs
          r.k += 1
          continue
        }
        if (now > r.orderAt + window + HPT.lateMs) this.out(r, r.orderAt + window)
        break
      }
    }
    return state
  }

  // A player who leaves is out on the spot.
  leave(state: HptState, playerId: PlayerId, now: number): HptState {
    const r = state.runners.get(playerId)
    if (r?.alive) this.out(r, now)
    return state
  }

  isFinished(state: HptState, now: number): boolean {
    if (now >= state.endsAt) return true
    for (const r of state.runners.values()) if (r.alive) return false
    return true
  }

  // More orders done wins; a survivor beats someone out on the same count.
  private cmp(state: HptState, a: PlayerId, b: PlayerId): number {
    const ra = state.runners.get(a)
    const rb = state.runners.get(b)
    return (rb?.k ?? 0) - (ra?.k ?? 0) || Number(rb?.alive ?? false) - Number(ra?.alive ?? false)
  }

  getResult(state: HptState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `streak ${state.runners.get(id)?.k ?? 0}`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: HptState, now: number): HptSnapshot {
    const players: Record<PlayerId, HptPlayerView> = {}
    const progress: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const r = state.runners.get(id) as Runner
      players[id] = { k: r.k, alive: r.alive, orderInMs: r.orderAt - now }
      progress[id] = r.k
    }
    return { seed: state.seed, players, progress, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
