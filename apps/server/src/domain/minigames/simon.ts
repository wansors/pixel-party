import type { SimonInput, SimonPlayerView, SimonSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const PADS = 4
const MAX_LEN = 24
const DEFAULT_DURATION_MS = 60_000

interface SimonPlayerState {
  // Current target length (pads to reproduce this level); starts at 1.
  level: number
  // Correct pads entered so far in the current replay.
  pos: number
  alive: boolean
  // ms at which the run ended / last level cleared, for tie-breaking.
  reachedMs: number
}

export interface SimonState {
  players: PlayerId[]
  seq: number[]
  startedAt: number
  endsAt: number
  ps: Map<PlayerId, SimonPlayerState>
}

// Real-time FFA sequence memory. One seeded pad sequence is shared by everyone; each player reproduces
// a growing prefix at their own pace and a wrong pad ends their run. Pure domain logic: the sequence
// comes from the injected Random port (seeded per round) and time arrives as `now`.
export class Simon implements MiniGame<SimonState, SimonInput> {
  readonly id = 'simon'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SimonState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const seq = Array.from({ length: MAX_LEN }, () => Math.floor(ctx.random.next() * PADS))
    const ps = new Map<PlayerId, SimonPlayerState>(
      ctx.players.map((id) => [id, { level: 1, pos: 0, alive: true, reachedMs: 0 }]),
    )
    return { players: [...ctx.players], seq, startedAt: ctx.now, endsAt: ctx.now + durationMs, ps }
  }

  onInput(state: SimonState, playerId: PlayerId, input: SimonInput, now: number): SimonState {
    if (input.kind !== 'pad' || typeof input.pad !== 'number') return state
    if (now >= state.endsAt) return state
    const p = state.ps.get(playerId)
    if (!p || !p.alive) return state
    if (input.pad === state.seq[p.pos]) {
      p.pos += 1
      if (p.pos >= p.level) {
        // Reproduced the whole current prefix → advance a level (a new pad joins the replay).
        p.level += 1
        p.pos = 0
        p.reachedMs = now - state.startedAt
        // Cleared the entire sequence → freeze at the maximum.
        if (p.level > state.seq.length) p.alive = false
      }
    } else {
      p.alive = false
      p.reachedMs = now - state.startedAt
    }
    return state
  }

  isFinished(state: SimonState, now: number): boolean {
    if (now >= state.endsAt) return true
    for (const p of state.ps.values()) if (p.alive) return false
    return true
  }

  getResult(state: SimonState): NormalizedResult {
    const completed = (id: PlayerId): number => (state.ps.get(id)?.level ?? 1) - 1
    const sorted = [...state.players].sort((a, b) => {
      const ca = completed(a)
      const cb = completed(b)
      if (cb !== ca) return cb - ca
      return (state.ps.get(a)?.reachedMs ?? 0) - (state.ps.get(b)?.reachedMs ?? 0)
    })
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: { c: number; t: number } | undefined
    sorted.forEach((id, idx) => {
      const c = completed(id)
      const t = state.ps.get(id)?.reachedMs ?? 0
      if (idx > 0 && prev && (c !== prev.c || t !== prev.t)) rank = idx
      ranks[id] = rank
      prev = { c, t }
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `level ${completed(id)}`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: SimonState, now: number): SimonSnapshot {
    const players: Record<PlayerId, SimonPlayerView> = {}
    const scores: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const p = state.ps.get(id) as SimonPlayerState
      // Only expose the prefix up to the player's current level — never the pads still to come.
      players[id] = { seq: state.seq.slice(0, p.level), pos: p.pos, alive: p.alive }
      scores[id] = p.level - 1
    }
    return { players, scores, pads: PADS, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
