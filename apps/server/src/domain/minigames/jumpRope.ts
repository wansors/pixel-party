import { JUMP_ROPE, type JumpRopeInput, type JumpRopeSnapshot, rampEase } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 50_000
const FIRST_PASS_MS = 2200 // a moment to find the rhythm before the first sweep
// The rope's speed (turns per second) climbs on an ease-in over the whole round: an easy swing while
// everyone finds the rhythm, about the old pace by the middle, then it keeps accelerating to the end —
// no plateau. The last turns stay a hair longer than a jump (JUMP_ROPE.jumpMs), so a perfect rhythm
// can always keep up.
const START_PERIOD_MS = 1450
const END_PERIOD_MS = 490
const SPEED_POWER = 1.5
const periodAt = (progress: number): number =>
  Math.round(1000 / rampEase(1000 / START_PERIOD_MS, 1000 / END_PERIOD_MS, progress, SPEED_POWER))

interface Jumper {
  id: PlayerId
  hearts: number
  alive: boolean
  jumpAt: number | null
  cleared: number
  outAt: number
}

export interface JumpRopeState {
  passes: number[]
  next: number
  jumpers: Map<PlayerId, Jumper>
  players: PlayerId[]
  startedAt: number
  endsAt: number
}

// FFA rhythm elimination. Deterministic: the rope's whole schedule (every pass under the feet, each
// turn faster, ever more so) is fixed at init; tick only judges the passes that have come due.
export class JumpRope implements MiniGame<JumpRopeState, JumpRopeInput> {
  readonly id = 'jump-rope'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): JumpRopeState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const endsAt = ctx.now + durationMs
    const passes: number[] = []
    for (let t = ctx.now + FIRST_PASS_MS; t < endsAt; t += periodAt((t - ctx.now) / durationMs)) {
      passes.push(t)
    }
    const jumpers = new Map<PlayerId, Jumper>()
    for (const id of ctx.players) {
      jumpers.set(id, {
        id,
        hearts: JUMP_ROPE.hearts,
        alive: true,
        jumpAt: null,
        cleared: 0,
        outAt: 0,
      })
    }
    return { passes, next: 0, jumpers, players: [...ctx.players], startedAt: ctx.now, endsAt }
  }

  onInput(
    state: JumpRopeState,
    playerId: PlayerId,
    input: JumpRopeInput,
    now: number,
  ): JumpRopeState {
    if (input?.kind !== 'jump' || now >= state.endsAt) return state
    const j = state.jumpers.get(playerId)
    if (!j?.alive) return state
    // One jump at a time: you can't take off again mid-air.
    if (j.jumpAt !== null && now - j.jumpAt < JUMP_ROPE.jumpMs) return state
    j.jumpAt = now
    return state
  }

  tick(state: JumpRopeState, _dt: number, now: number): JumpRopeState {
    while (state.next < state.passes.length && (state.passes[state.next] as number) <= now) {
      const at = state.passes[state.next] as number
      for (const j of state.jumpers.values()) {
        if (!j.alive) continue
        const t = j.jumpAt === null ? -1 : at - j.jumpAt
        if (t >= JUMP_ROPE.clearFrom && t <= JUMP_ROPE.clearTo) {
          j.cleared += 1
          continue
        }
        j.hearts -= 1
        if (j.hearts <= 0) {
          j.alive = false
          j.outAt = at
        }
      }
      state.next += 1
    }
    for (const j of state.jumpers.values()) {
      if (j.jumpAt !== null && now - j.jumpAt >= JUMP_ROPE.jumpMs) j.jumpAt = null
    }
    return state
  }

  isFinished(state: JumpRopeState, now: number): boolean {
    const alive = [...state.jumpers.values()].filter((j) => j.alive).length
    return now >= state.endsAt || alive === 0 || (state.players.length > 1 && alive <= 1)
  }

  getResult(state: JumpRopeState): NormalizedResult {
    const cmp = (a: Jumper, b: Jumper): number =>
      Number(b.alive) - Number(a.alive) || b.cleared - a.cleared || b.outAt - a.outAt
    const sorted = [...state.jumpers.values()].sort(cmp)
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((j, i) => {
      const prev = sorted[i - 1]
      ranks[j.id] = prev && cmp(prev, j) === 0 ? (ranks[prev.id] ?? i) : i
      stats[j.id] = `${j.cleared}`
    })
    return { placements: sorted.map((j) => j.id), ranks, stats }
  }

  snapshot(state: JumpRopeState, now: number): JumpRopeSnapshot {
    const next = state.passes[state.next]
    const prev = state.passes[state.next - 1]
    return {
      nextPassMs: next === undefined ? 0 : Math.max(0, next - now),
      periodMs: next !== undefined && prev !== undefined ? next - prev : START_PERIOD_MS,
      passes: state.next,
      players: state.players.map((id) => {
        const j = state.jumpers.get(id) as Jumper
        return {
          id,
          hearts: j.hearts,
          alive: j.alive,
          jumpMs: j.jumpAt === null ? null : now - j.jumpAt,
          cleared: j.cleared,
        }
      }),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
