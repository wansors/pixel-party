import {
  BALLOON_CHICKEN,
  type BalloonChickenInput,
  type BalloonChickenSnapshot,
  type BalloonPlayer,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 20_000
// A balloon bursts on pump 4..18: the first three are always safe.
const MIN_THRESHOLD = 4
const THRESHOLD_SPREAD = 15

export interface BalloonChickenState {
  startedAt: number
  endsAt: number
  // Burst threshold (pumps) of each balloon in the sequence — the same for every player, so nobody
  // draws an easier balloon. Never leaves the server.
  thresholds: number[]
  players: Map<PlayerId, BalloonPlayer>
  // Players gone mid-round: the "everybody is done" early finish stops waiting for them.
  gone: Set<PlayerId>
}

const done = (p: BalloonPlayer): boolean => p.outcomes.length >= BALLOON_CHICKEN.balloons

// Real-time FFA nerve game. Everybody pumps the same seeded sequence of balloons (drawn from the
// Random port): each pump adds points, the balloon's hidden threshold bursts it (its points are lost),
// cashing out banks them; either way the next balloon comes up. At the buzzer a balloon still in hand
// bursts, so walking away has to be a choice. Ranks by points banked. Pure domain logic.
export class BalloonChicken implements MiniGame<BalloonChickenState, BalloonChickenInput> {
  readonly id = 'balloon-chicken'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BalloonChickenState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const thresholds = Array.from(
      { length: BALLOON_CHICKEN.balloons },
      () => MIN_THRESHOLD + Math.floor(ctx.random.next() * THRESHOLD_SPREAD),
    )
    const players = new Map<PlayerId, BalloonPlayer>()
    for (const id of ctx.players) players.set(id, { pumps: 0, banked: 0, outcomes: [] })
    return {
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      thresholds,
      players,
      gone: new Set(),
    }
  }

  onInput(
    state: BalloonChickenState,
    playerId: PlayerId,
    input: BalloonChickenInput,
    now: number,
  ): BalloonChickenState {
    if (now < state.startedAt || now >= state.endsAt) return state
    const p = state.players.get(playerId)
    if (!p || done(p)) return state
    if (input.kind === 'cashout') {
      // Cashing out an untouched balloon would just skip it for nothing.
      if (p.pumps === 0) return state
      p.banked += p.pumps * BALLOON_CHICKEN.pointsPerPump
      p.outcomes.push('cashed')
      p.pumps = 0
    } else if (input.kind === 'pump') {
      p.pumps += 1
      if (p.pumps >= (state.thresholds[p.outcomes.length] as number)) {
        p.outcomes.push('burst')
        p.pumps = 0
      }
    }
    return state
  }

  // The buzzer pops every balloon still in hand (they were never banked, so no points move).
  tick(state: BalloonChickenState, _dt: number, now: number): BalloonChickenState {
    if (now < state.endsAt) return state
    for (const p of state.players.values()) {
      if (p.pumps === 0) continue
      p.outcomes.push('burst')
      p.pumps = 0
    }
    return state
  }

  leave(state: BalloonChickenState, playerId: PlayerId): BalloonChickenState {
    state.gone.add(playerId)
    return state
  }

  isFinished(state: BalloonChickenState, now: number): boolean {
    if (now >= state.endsAt) return true
    // Early out once everybody still here has finished every balloon.
    for (const [id, p] of state.players) if (!done(p) && !state.gone.has(id)) return false
    return true
  }

  getResult(state: BalloonChickenState): NormalizedResult {
    const banked = (id: PlayerId): number => state.players.get(id)?.banked ?? 0
    const sorted = [...state.players.keys()].sort((a, b) => banked(b) - banked(a))
    const ranks: Record<PlayerId, number> = {}
    sorted.forEach((id, idx) => {
      const prev = sorted[idx - 1]
      ranks[id] = prev !== undefined && banked(prev) === banked(id) ? (ranks[prev] as number) : idx
    })
    const stats: Record<PlayerId, string> = {}
    for (const [id, p] of state.players) stats[id] = `${p.banked} banked`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: BalloonChickenState, now: number): BalloonChickenSnapshot {
    const players: BalloonChickenSnapshot['players'] = {}
    for (const [id, p] of state.players) {
      players[id] = { pumps: p.pumps, banked: p.banked, outcomes: [...p.outcomes] }
    }
    return { players, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
