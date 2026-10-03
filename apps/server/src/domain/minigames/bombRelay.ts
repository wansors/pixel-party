import type { BombRelayInput, BombRelaySnapshot, TeamId } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 25_000
const LEG_TAPS = 12 // mashes to fill a leg and pass the bomb on
const FUSE_MIN_MS = 2500 // hidden fuse window per leg (never sent on the wire)
const FUSE_MAX_MS = 5000
// A holder who hasn't mashed for this long since the bomb reached them (or since their last mash) is
// skipped: the bomb moves on with a fresh fuse and no relay credit, so an AFK-but-connected teammate
// costs the team this much time per lap instead of a whole fuse.
const IDLE_PASS_MS = 1800

interface TeamBomb {
  members: PlayerId[]
  holderIdx: number
  legProgress: number
  relays: number
  explosions: number
  fuseEndsAt: number // hidden
  lastActionAt: number // when the holder got the bomb or last mashed
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
// first the team takes an explosion and the bomb rotates on. An idle holder is skipped (IDLE_PASS_MS)
// and a member who leaves drops out of the chain, so the bomb never parks on someone who can't mash.
// One bomb per team, one holder at a time: a team's pace is its members' mashing speed, whatever its
// size. Most relays wins (fewer explosions breaks ties). Pure — time arrives as `now`, randomness via
// the injected port (kept on state for tick()).
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
        lastActionAt: ctx.now,
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
    bomb.lastActionAt = now
    if (bomb.legProgress >= LEG_TAPS) {
      // Passed safely before the fuse: score the relay and hand it on.
      bomb.relays++
      handOff(bomb, (bomb.holderIdx + 1) % bomb.members.length, state.random, now)
    }
    return state
  }

  tick(state: BombRelayState, _dt: number, now: number): BombRelayState {
    if (now >= state.endsAt) return state
    for (const bomb of state.teams.values()) {
      if (bomb.members.length === 0) continue // the whole team left: nobody to blow up
      const next = (bomb.holderIdx + 1) % bomb.members.length
      if (now >= bomb.fuseEndsAt) {
        // Caught holding it: explosion, drop the leg, rotate on, re-arm.
        bomb.explosions++
        handOff(bomb, next, state.random, now)
      } else if (now - bomb.lastActionAt >= IDLE_PASS_MS) {
        // Asleep on the bomb: skip them. The next holder gets a fresh fuse, as on any hand-off —
        // inheriting a half-burnt one would blow up on a teammate who did nothing wrong.
        handOff(bomb, next, state.random, now)
      }
    }
    return state
  }

  // A member who left drops out of the relay chain. If they held the bomb, it moves on to the next
  // member as a fresh hand-off; otherwise the current holder keeps it.
  leave(state: BombRelayState, playerId: PlayerId, now: number): BombRelayState {
    const team = state.playerTeam.get(playerId)
    const bomb = team ? state.teams.get(team) : undefined
    const idx = bomb ? bomb.members.indexOf(playerId) : -1
    if (!bomb || idx < 0) return state
    bomb.members.splice(idx, 1)
    if (idx < bomb.holderIdx) bomb.holderIdx--
    else if (idx === bomb.holderIdx) {
      handOff(bomb, idx < bomb.members.length ? idx : 0, state.random, now)
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
    // Every round member, leavers included, shares their team's line.
    for (const [id, team] of state.playerTeam) {
      stats[id] = `${state.teams.get(team)?.relays ?? 0} passes`
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

// The bomb goes to member `holderIdx` for a new leg: progress reset, a fresh hidden fuse, idle clock
// restarted.
function handOff(bomb: TeamBomb, holderIdx: number, random: Random, now: number): void {
  bomb.holderIdx = holderIdx
  bomb.legProgress = 0
  bomb.fuseEndsAt = now + fuse(random)
  bomb.lastActionAt = now
}

// Hidden per-leg fuse duration, seeded via the Random port.
function fuse(random: Random): number {
  return FUSE_MIN_MS + Math.floor(random.next() * (FUSE_MAX_MS - FUSE_MIN_MS))
}
