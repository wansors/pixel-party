import type { TeamId, TugOfWarInput, TugOfWarSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 15_000
// Per-capita pull lead that ends the round instantly (a decisive win before the timer). Per-capita, so
// uneven teams stay fair: what counts is average effort per member, not raw headcount.
const WIN_THRESHOLD = 25

export interface TugOfWarState {
  team: Map<PlayerId, TeamId>
  pulls: Map<PlayerId, number>
  startedAt: number
  endsAt: number
}

// Team real-time: members of two teams mash to pull the rope. Each team's progress is its average
// pulls-per-member; the rope offset is the normalized difference. A team wins by opening a per-capita
// lead of WIN_THRESHOLD (instant) or by leading when time runs out. A member who leaves stops counting
// (their pulls and their seat), so a dropped teammate doesn't drag the average down. Pure — time
// arrives as `now`.
export class TugOfWar implements MiniGame<TugOfWarState, TugOfWarInput> {
  readonly id = 'tug-of-war'
  readonly format = 'team' as const

  init(ctx: MiniGameInitCtx): TugOfWarState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const team = new Map<PlayerId, TeamId>()
    for (const id of ctx.players) {
      const t = ctx.teams?.[id]
      if (t) team.set(id, t)
    }
    return {
      team,
      pulls: new Map(ctx.players.map((id) => [id, 0])),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(
    state: TugOfWarState,
    playerId: PlayerId,
    input: TugOfWarInput,
    now: number,
  ): TugOfWarState {
    if (input.kind !== 'pull') return state
    if (now < state.startedAt || now >= state.endsAt) return state
    if (!state.team.has(playerId)) return state
    state.pulls.set(playerId, (state.pulls.get(playerId) ?? 0) + 1)
    return state
  }

  // Leaving drops the seat: totals only count members still on a team, so the leaver's pulls stop
  // counting (but keep their stat line on the results).
  leave(state: TugOfWarState, playerId: PlayerId): TugOfWarState {
    state.team.delete(playerId)
    return state
  }

  isFinished(state: TugOfWarState, now: number): boolean {
    if (now >= state.endsAt) return true
    const [red, blue] = perCapita(state)
    return Math.abs(blue - red) >= WIN_THRESHOLD
  }

  getResult(state: TugOfWarState): NormalizedResult {
    const [redPc, bluePc] = perCapita(state)
    const placements: TeamId[] = ['red', 'blue']
    const ranks: Record<string, number> =
      redPc === bluePc
        ? { red: 0, blue: 0 }
        : redPc > bluePc
          ? { red: 0, blue: 1 }
          : { red: 1, blue: 0 }
    const stats: Record<PlayerId, string> = {}
    for (const [id, n] of state.pulls) stats[id] = `${n} pulls`
    return { placements, ranks, stats }
  }

  snapshot(state: TugOfWarState, now: number): TugOfWarSnapshot {
    const [redPc, bluePc] = perCapita(state)
    const offset = clamp((bluePc - redPc) / WIN_THRESHOLD, -1, 1)
    return {
      offset,
      avg: { red: round1(redPc), blue: round1(bluePc) },
      teams: Object.fromEntries(state.team),
      remainingMs: Math.max(0, state.endsAt - now),
      done: this.isFinished(state, now),
    }
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const round1 = (v: number): number => Math.round(v * 10) / 10

function totals(state: TugOfWarState): [number, number] {
  let red = 0
  let blue = 0
  for (const [id, n] of state.pulls) {
    if (state.team.get(id) === 'red') red += n
    else if (state.team.get(id) === 'blue') blue += n
  }
  return [red, blue]
}

function perCapita(state: TugOfWarState): [number, number] {
  const [red, blue] = totals(state)
  const sizes = new Map<TeamId, number>()
  for (const t of state.team.values()) sizes.set(t, (sizes.get(t) ?? 0) + 1)
  const redSize = sizes.get('red') ?? 0
  const blueSize = sizes.get('blue') ?? 0
  return [redSize > 0 ? red / redSize : 0, blueSize > 0 ? blue / blueSize : 0]
}
