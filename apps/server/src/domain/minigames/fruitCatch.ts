import type { FruitCatchInput, FruitCatchSnapshot, FruitKind } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 30_000
const BOMB_CHANCE = 0.22
// The basket sits near the bottom; an item is resolved (caught or missed) once it reaches this line.
const CATCH_Y = 0.9
// Half-width of the basket's catch zone in normalized x.
const BASKET_HALF = 0.12
// The basket slides toward where its player steers at most this fast (widths per second): the mouse
// can't teleport it, so mouse and keys play the same game — and the client, sliding at the same cap
// toward the same spot, shows the basket where the server judges it.
export const BASKET_SPEED = 1.8
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
  // Tiebreaks for equal scores: fewer bombs caught, then the longer best combo.
  bombs: Map<PlayerId, number>
  bestCombos: Map<PlayerId, number>
  // Where each basket is, and where its player is steering it (it slides there at BASKET_SPEED).
  baskets: Map<PlayerId, number>
  targets: Map<PlayerId, number>
  // playerId → item ids already resolved (caught or missed) so each item scores at most once per player.
  resolved: Map<PlayerId, Set<number>>
}

// Real-time FFA fruit catcher. One seeded stream of falling items is shared by everyone; each player
// catches on their own device. Pure domain logic: the timeline comes from the injected Random port and
// time arrives as `now`. Item y is a linear function of time (each item ships its fall speed), so the
// client renders it on the server's clock — what you see reaching the basket is what gets judged.
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
      bombs: new Map(ctx.players.map((pid) => [pid, 0])),
      bestCombos: new Map(ctx.players.map((pid) => [pid, 0])),
      baskets: new Map(ctx.players.map((pid) => [pid, 0.5])),
      targets: new Map(ctx.players.map((pid) => [pid, 0.5])),
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
    if (!state.targets.has(playerId)) return state
    state.targets.set(playerId, Math.max(0, Math.min(1, input.x)))
    return state
  }

  tick(state: FruitCatchState, dt: number, now: number): FruitCatchState {
    const reach = (BASKET_SPEED * dt) / 1000
    for (const pid of state.players) {
      const resolved = state.resolved.get(pid)
      const from = state.baskets.get(pid) ?? 0.5
      const to = state.targets.get(pid) ?? from
      const basket = from + Math.max(-reach, Math.min(reach, to - from))
      state.baskets.set(pid, basket)
      if (!resolved) continue
      for (const item of state.items) {
        if (resolved.has(item.id)) continue
        if (this.yOf(state, item, now) < CATCH_Y) continue
        resolved.add(item.id)
        const caught = Math.abs(item.x - basket) <= BASKET_HALF
        const score = state.scores.get(pid) ?? 0
        if (item.kind === 'fruit') {
          if (caught) {
            const combo = (state.combos.get(pid) ?? 0) + 1
            state.scores.set(pid, score + 1)
            state.combos.set(pid, combo)
            state.bestCombos.set(pid, Math.max(state.bestCombos.get(pid) ?? 0, combo))
          } else {
            state.combos.set(pid, 0)
          }
        } else if (caught) {
          // Caught a bomb: lose a point and break the combo.
          state.scores.set(pid, Math.max(0, score - 1))
          state.combos.set(pid, 0)
          state.bombs.set(pid, (state.bombs.get(pid) ?? 0) + 1)
        }
      }
    }
    return state
  }

  isFinished(state: FruitCatchState, now: number): boolean {
    return now >= state.endsAt
  }

  // Most points; equal scores go to the cleaner catcher (fewer bombs), then the longer best combo.
  private cmp(state: FruitCatchState, a: PlayerId, b: PlayerId): number {
    const get = (m: Map<PlayerId, number>, id: PlayerId): number => m.get(id) ?? 0
    return (
      get(state.scores, b) - get(state.scores, a) ||
      get(state.bombs, a) - get(state.bombs, b) ||
      get(state.bestCombos, b) - get(state.bestCombos, a)
    )
  }

  getResult(state: FruitCatchState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
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
      return y >= 0 && y < CATCH_Y
        ? [{ id: item.id, x: item.x, y, fallMs: item.fallMs, kind: item.kind }]
        : []
    })
    return {
      items,
      scores: Object.fromEntries(state.scores),
      combos: Object.fromEntries(state.combos),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
