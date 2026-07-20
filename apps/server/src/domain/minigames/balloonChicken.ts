import type { BalloonChickenInput, BalloonChickenSnapshot, BalloonStatus } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 20_000
const MIN_THRESHOLD = 5
const THRESHOLD_SPREAD = 20
const POINTS_PER_PUMP = 10

interface BalloonPlayerState {
  pumps: number
  banked: number
  status: BalloonStatus
  // Hidden burst threshold (pumps). Seeded per player — never leaves the server.
  threshold: number
}

export interface BalloonChickenState {
  startedAt: number
  endsAt: number
  players: Map<PlayerId, BalloonPlayerState>
}

// Real-time FFA nerve game. Each pump adds points but a hidden per-player threshold (drawn from the
// seeded Random port) bursts the balloon → 0. Cashing out banks the current points safely. At the time
// limit, still-inflating players auto-bank what they have (only a burst wipes you). Pure domain logic.
export class BalloonChicken implements MiniGame<BalloonChickenState, BalloonChickenInput> {
  readonly id = 'balloon-chicken'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BalloonChickenState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const players = new Map<PlayerId, BalloonPlayerState>()
    for (const id of ctx.players) {
      const threshold = MIN_THRESHOLD + Math.floor(ctx.random.next() * THRESHOLD_SPREAD)
      players.set(id, { pumps: 0, banked: 0, status: 'pumping', threshold })
    }
    return { startedAt: ctx.now, endsAt: ctx.now + durationMs, players }
  }

  onInput(
    state: BalloonChickenState,
    playerId: PlayerId,
    input: BalloonChickenInput,
    now: number,
  ): BalloonChickenState {
    if (now < state.startedAt || now >= state.endsAt) return state
    const p = state.players.get(playerId)
    if (!p || p.status !== 'pumping') return state
    if (input.kind === 'cashout') {
      p.banked = p.pumps * POINTS_PER_PUMP
      p.status = 'cashed'
      return state
    }
    if (input.kind === 'pump') {
      p.pumps += 1
      if (p.pumps >= p.threshold) {
        p.banked = 0
        p.status = 'burst'
      }
      return state
    }
    return state
  }

  isFinished(state: BalloonChickenState, now: number): boolean {
    if (now >= state.endsAt) return true
    // Early out once nobody is still inflating.
    for (const p of state.players.values()) {
      if (p.status === 'pumping') return false
    }
    return true
  }

  getResult(state: BalloonChickenState): NormalizedResult {
    // Still-inflating survivors auto-bank at the buzzer; only a burst zeroes you out.
    const banked = new Map<PlayerId, number>()
    for (const [id, p] of state.players) {
      banked.set(id, p.status === 'burst' ? 0 : p.pumps * POINTS_PER_PUMP)
    }
    const sorted = [...state.players.keys()].sort(
      (a, b) => (banked.get(b) ?? 0) - (banked.get(a) ?? 0),
    )
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: number | undefined
    sorted.forEach((id, idx) => {
      const v = banked.get(id) ?? 0
      if (idx > 0 && v !== prev) rank = idx
      ranks[id] = rank
      prev = v
    })
    return { placements: sorted, ranks }
  }

  snapshot(state: BalloonChickenState, now: number): BalloonChickenSnapshot {
    const players: BalloonChickenSnapshot['players'] = {}
    for (const [id, p] of state.players) {
      players[id] = { pumps: p.pumps, banked: p.banked, status: p.status }
    }
    return {
      players,
      remainingMs: Math.max(0, state.endsAt - now),
      pointsPerPump: POINTS_PER_PUMP,
    }
  }
}
