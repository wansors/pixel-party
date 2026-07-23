import type { BombRelayInput, BombRelaySnapshot, TeamId } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 25_000
const LEG_TAPS = 12 // mashes to fill a leg and pass the bomb on
const FUSE_MIN_MS = 2500 // hidden fuse window per leg (never sent on the wire)
const FUSE_MAX_MS = 5000

interface TeamBomb {
  members: PlayerId[]
  holderIdx: number
  legProgress: number
  relays: number
  explosions: number
  fuseEndsAt: number // hidden
}

export interface BombRelayState {
  teams: Map<TeamId, TeamBomb>
  playerTeam: Map<PlayerId, TeamId>
  random: Random
  startedAt: number
  endsAt: number
}

// Team hot-potato relay: each team shares one bomb held by one member at a time. The holder mashes to
// fill their leg (LEG_TAPS) and pass it on (+1 relay), racing a hidden seeded fuse; if the fuse blows
// first the team takes an explosion and the bomb rotates on. Most relays wins (fewer explosions breaks
// ties). Pure — time arrives as `now`, randomness via the injected port (kept on state for tick()).
export class BombRelay implements MiniGame<BombRelayState, BombRelayInput> {
  readonly id = 'bomb-relay'
  readonly format = 'team' as const

  init(ctx: MiniGameInitCtx): BombRelayState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const membersByTeam = new Map<TeamId, PlayerId[]>()
    const playerTeam = new Map<PlayerId, TeamId>()
    for (const id of ctx.players) {
      const team = ctx.teams?.[id]
      if (!team) continue
      playerTeam.set(id, team)
      const bucket = membersByTeam.get(team) ?? []
      bucket.push(id)
      membersByTeam.set(team, bucket)
    }
    const teams = new Map<TeamId, TeamBomb>()
    for (const [team, members] of membersByTeam) {
      teams.set(team, {
        members,
        holderIdx: 0,
        legProgress: 0,
        relays: 0,
        explosions: 0,
        fuseEndsAt: ctx.now + fuse(ctx.random),
      })
    }
    return {
      teams,
      playerTeam,
      random: ctx.random,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(
    state: BombRelayState,
    playerId: PlayerId,
    input: BombRelayInput,
    now: number,
  ): BombRelayState {
    if (input.kind !== 'mash') return state
    if (now < state.startedAt || now >= state.endsAt) return state
    const team = state.playerTeam.get(playerId)
    const bomb = team ? state.teams.get(team) : undefined
    if (!bomb) return state
    if (bomb.members[bomb.holderIdx] !== playerId) return state // only the current holder mashes
    bomb.legProgress++
    if (bomb.legProgress >= LEG_TAPS) {
      // Passed safely before the fuse: score the relay, rotate the holder, arm a fresh hidden fuse.
      bomb.relays++
      bomb.legProgress = 0
      bomb.holderIdx = (bomb.holderIdx + 1) % bomb.members.length
      bomb.fuseEndsAt = now + fuse(state.random)
    }
    return state
  }

  tick(state: BombRelayState, _dt: number, now: number): BombRelayState {
    if (now >= state.endsAt) return state
    for (const bomb of state.teams.values()) {
      if (now >= bomb.fuseEndsAt) {
        // Caught holding it: explosion, drop the leg, rotate on, re-arm.
        bomb.explosions++
        bomb.legProgress = 0
        bomb.holderIdx = (bomb.holderIdx + 1) % bomb.members.length
        bomb.fuseEndsAt = now + fuse(state.random)
      }
    }
    return state
  }

  isFinished(state: BombRelayState, now: number): boolean {
    return now >= state.endsAt
  }

  getResult(state: BombRelayState): NormalizedResult {
    // Rank teams by relays desc, then explosions asc; equal on both = a tie (shared rank).
    const entries = [...state.teams.entries()].sort(
      ([, x], [, y]) => y.relays - x.relays || x.explosions - y.explosions,
    )
    const placements: TeamId[] = []
    const ranks: Record<string, number> = {}
    let rank = 0
    let prev: TeamBomb | undefined
    entries.forEach(([team, bomb], idx) => {
      if (idx > 0 && prev && (bomb.relays !== prev.relays || bomb.explosions !== prev.explosions)) {
        rank = idx
      }
      placements.push(team)
      ranks[team] = rank
      prev = bomb
    })
    const stats: Record<PlayerId, string> = {}
    for (const bomb of state.teams.values()) {
      for (const id of bomb.members) stats[id] = `${bomb.relays} passes`
    }
    return { placements, ranks, stats }
  }

  snapshot(state: BombRelayState, now: number): BombRelaySnapshot {
    const teams = {} as BombRelaySnapshot['teams']
    for (const [team, bomb] of state.teams) {
      teams[team] = {
        holderId: bomb.members[bomb.holderIdx] ?? '',
        legProgress: bomb.legProgress,
        legTarget: LEG_TAPS,
        relays: bomb.relays,
        explosions: bomb.explosions,
        members: bomb.members,
      }
    }
    return {
      teams,
      playerTeam: Object.fromEntries(state.playerTeam),
      roundRemainingMs: Math.max(0, state.endsAt - now),
    }
  }
}

// Hidden per-leg fuse duration, seeded via the Random port.
function fuse(random: Random): number {
  return FUSE_MIN_MS + Math.floor(random.next() * (FUSE_MAX_MS - FUSE_MIN_MS))
}
