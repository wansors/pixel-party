import type { FruitCatchInput, FruitCatchSnapshot, FruitKind } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 30_000
const BOMB_CHANCE = 0.22
// The basket sits near the bottom; an item is resolved (caught or missed) once it reaches this line.
const CATCH_Y = 0.9
// Half-width of the basket's catch zone in normalized x.
const BASKET_HALF = 0.12
const SPAWN_MIN_MS = 420
const SPAWN_JITTER_MS = 360
const FALL_MIN_MS = 2200
const FALL_JITTER_MS = 1200
const X_MIN = 0.08
const X_SPAN = 0.84

interface Item {
  id: number
  spawnAt: number // ms offset from start
  x: number
  fallMs: number
  kind: FruitKind
}

export interface FruitCatchState {
  players: PlayerId[]
  items: Item[]
  startedAt: number
  endsAt: number
  scores: Map<PlayerId, number>
  combos: Map<PlayerId, number>
  baskets: Map<PlayerId, number>
  // playerId → item ids already resolved (caught or missed) so each item scores at most once per player.
  resolved: Map<PlayerId, Set<number>>
}

// Real-time FFA fruit catcher. One seeded stream of falling items is shared by everyone; each player
// catches on their own device. Pure domain logic: the timeline comes from the injected Random port and
// time arrives as `now`. Item y is a deterministic function of time, so the client can render smoothly.
export class FruitCatch implements MiniGame<FruitCatchState, FruitCatchInput> {
  readonly id = 'fruit-catch'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): FruitCatchState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const items: Item[] = []
    let t = 500
    let id = 0
    while (t < durationMs - 500) {
      items.push({
        id: id++,
        spawnAt: t,
        x: X_MIN + r.next() * X_SPAN,
        fallMs: FALL_MIN_MS + Math.floor(r.next() * FALL_JITTER_MS),
        kind: r.next() < BOMB_CHANCE ? 'bomb' : 'fruit',
      })
      t += SPAWN_MIN_MS + Math.floor(r.next() * SPAWN_JITTER_MS)
    }
    return {
      players: [...ctx.players],
      items,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      scores: new Map(ctx.players.map((pid) => [pid, 0])),
      combos: new Map(ctx.players.map((pid) => [pid, 0])),
      baskets: new Map(ctx.players.map((pid) => [pid, 0.5])),
      resolved: new Map(ctx.players.map((pid) => [pid, new Set<number>()])),
    }
  }

  private yOf(state: FruitCatchState, item: Item, now: number): number {
    return (now - state.startedAt - item.spawnAt) / item.fallMs
  }

  onInput(
    state: FruitCatchState,
    playerId: PlayerId,
    input: FruitCatchInput,
    _now: number,
  ): FruitCatchState {
    if (input.kind !== 'move' || typeof input.x !== 'number' || !Number.isFinite(input.x)) {
      return state
    }
    if (!state.baskets.has(playerId)) return state
    state.baskets.set(playerId, Math.max(0, Math.min(1, input.x)))
    return state
  }

  tick(state: FruitCatchState, _dt: number, now: number): FruitCatchState {
    for (const pid of state.players) {
      const resolved = state.resolved.get(pid)
      const basket = state.baskets.get(pid) ?? 0.5
      if (!resolved) continue
      for (const item of state.items) {
        if (resolved.has(item.id)) continue
        if (this.yOf(state, item, now) < CATCH_Y) continue
        resolved.add(item.id)
        const caught = Math.abs(item.x - basket) <= BASKET_HALF
        const score = state.scores.get(pid) ?? 0
        if (item.kind === 'fruit') {
          if (caught) {
            state.scores.set(pid, score + 1)
            state.combos.set(pid, (state.combos.get(pid) ?? 0) + 1)
          } else {
            state.combos.set(pid, 0)
          }
        } else if (caught) {
          // Caught a bomb: lose a point and break the combo.
          state.scores.set(pid, Math.max(0, score - 1))
          state.combos.set(pid, 0)
        }
      }
    }
    return state
  }

  isFinished(state: FruitCatchState, now: number): boolean {
    return now >= state.endsAt
  }

  getResult(state: FruitCatchState): NormalizedResult {
    const sorted = [...state.players].sort(
      (a, b) => (state.scores.get(b) ?? 0) - (state.scores.get(a) ?? 0),
    )
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: number | undefined
    sorted.forEach((id, idx) => {
      const v = state.scores.get(id) ?? 0
      if (idx > 0 && v !== prev) rank = idx
      ranks[id] = rank
      prev = v
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.scores.get(id) ?? 0} pts`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: FruitCatchState, now: number): FruitCatchSnapshot {
    // Stop rendering an item once it reaches the catch line — it's already resolved (caught or missed)
    // by then, so letting it keep visibly falling past the basket to the bottom of the screen just reads
    // as fruit that was never collected.
    const items = state.items.flatMap((item) => {
      const y = this.yOf(state, item, now)
      return y >= 0 && y < CATCH_Y ? [{ id: item.id, x: item.x, y, kind: item.kind }] : []
    })
    return {
      items,
      scores: Object.fromEntries(state.scores),
      combos: Object.fromEntries(state.combos),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
