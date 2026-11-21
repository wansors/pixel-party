import {
  JOUST,
  type JoustCmd,
  type JoustWorld,
  joustClone,
  joustNewWorld,
  joustRun,
  joustSnap,
  type SkyJoustInput,
  type SkyJoustSnapshot,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000

export interface SkyJoustState {
  players: PlayerId[]
  world: JoustWorld
  // Per player (same order): commands not yet integrated (snapped round ms, ascending, ≥ world.t).
  cmds: JoustCmd[][]
  lastFlap: number[]
  acks: number[]
  gone: boolean[]
  startedAt: number
  endsAt: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Sky Joust (D51): a real-time FFA flap-and-joust arena. Everyone flies one wrap-around sky over a few
// ledges and a widening lava pit; colliding, the higher rider unhorses the lower (+1), level clashes
// bounce apart, the lava costs a point, and the unhorsed come back after a moment. The world rules
// live in @pp/shared, integrated on a fixed grid with plain arithmetic; commands carry the moment they
// were pressed and the server judges JOUST.judgeMs behind real time. Highest score wins; fewer falls
// (unhorsed + lava) break ties.
export class SkyJoust implements MiniGame<SkyJoustState, SkyJoustInput> {
  readonly id = 'sky-joust'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SkyJoustState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    return {
      players: [...ctx.players],
      world: joustNewWorld(ctx.players.length),
      cmds: ctx.players.map(() => []),
      lastFlap: ctx.players.map(() => -Infinity),
      acks: ctx.players.map(() => 0),
      gone: ctx.players.map(() => false),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  // Round ms at server time `now` (capped at the bell).
  private roundTime(state: SkyJoustState, now: number): number {
    return Math.min(now, state.endsAt) - state.startedAt
  }

  onInput(
    state: SkyJoustState,
    playerId: PlayerId,
    input: SkyJoustInput,
    now: number,
  ): SkyJoustState {
    if (input?.kind !== 'fly') return state
    const i = state.players.indexOf(playerId)
    if (i < 0 || state.gone[i]) return state
    if (Number.isInteger(input.seq) && (input.seq as number) > (state.acks[i] as number))
      state.acks[i] = input.seq as number
    const steer =
      input.steer === -1 || input.steer === 0 || input.steer === 1 ? input.steer : undefined
    let flap = input.flap === true
    if (!flap && steer === undefined) return state
    const live = this.roundTime(state, now)
    if (live < JOUST.startDelayMs || now >= state.endsAt) return state
    // When it was pressed: never in the future, never before what's already judged.
    const asked = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : live
    const at = joustSnap(clamp(asked, Math.max(state.world.t, JOUST.startDelayMs), live))
    if (flap && at - (state.lastFlap[i] as number) < JOUST.minFlapGapMs) flap = false
    if (!flap && steer === undefined) return state
    if (flap) state.lastFlap[i] = Math.max(state.lastFlap[i] as number, at)
    const list = state.cmds[i] as JoustCmd[]
    list.push({ at, ...(flap ? { flap } : {}), ...(steer !== undefined ? { steer } : {}) })
    list.sort((a, b) => a.at - b.at)
    return state
  }

  tick(state: SkyJoustState, _dt: number, now: number): SkyJoustState {
    // Judged JOUST.judgeMs behind real time, except at the bell (nothing more can arrive).
    const live = this.roundTime(state, now)
    const lag = now >= state.endsAt ? 0 : JOUST.judgeMs
    const until = Math.floor((live - lag) / JOUST.dtMs) * JOUST.dtMs
    if (until <= state.world.t) return state
    joustRun(state.world, until, state.cmds)
    state.cmds = state.cmds.map((list) => list.filter((c) => c.at >= state.world.t))
    return state
  }

  // A player who left lets go of the controls (they glide down and may be unhorsed).
  leave(state: SkyJoustState, playerId: PlayerId, _now: number): SkyJoustState {
    const i = state.players.indexOf(playerId)
    if (i >= 0) {
      state.gone[i] = true
      state.cmds[i] = []
      const r = state.world.riders[i]
      if (r) r.steer = 0
    }
    return state
  }

  isFinished(state: SkyJoustState, now: number): boolean {
    return now >= state.endsAt || state.gone.every(Boolean)
  }

  private cmp(state: SkyJoustState, a: PlayerId, b: PlayerId): number {
    const ra = state.world.riders[state.players.indexOf(a)]
    const rb = state.world.riders[state.players.indexOf(b)]
    if (!ra || !rb) return 0
    return rb.score - ra.score || ra.losses + ra.lava - (rb.losses + rb.lava)
  }

  getResult(state: SkyJoustState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    state.players.forEach((id, i) => {
      stats[id] = `${state.world.riders[i]?.score ?? 0} pts`
    })
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: SkyJoustState, now: number): SkyJoustSnapshot {
    const acks: Record<PlayerId, number> = {}
    const progress: Record<PlayerId, number> = {}
    state.players.forEach((id, i) => {
      acks[id] = state.acks[i] as number
      progress[id] = state.world.riders[i]?.score ?? 0
    })
    return {
      world: joustClone(state.world),
      ids: [...state.players],
      cmds: state.cmds.map((list) => list.map((c) => ({ ...c }))),
      acks,
      t: now - state.startedAt,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
