import type { SimonInput, SimonPlayerView, SimonSnapshot } from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const PADS = 4
const MAX_LEN = 24
const DEFAULT_DURATION_MS = 60_000

interface SimonPlayerState {
  // This player's colours for the shared sequence: base pad -> the pad they see and press.
  pads: number[]
  // Current target length (pads to reproduce this level); starts at 1.
  level: number
  // Correct pads entered so far in the current replay (where the run stopped, once out).
  pos: number
  alive: boolean
  // ms into the round of the last level cleared (0 = none yet): the final tiebreak, sooner wins.
  clearedMs: number
}

// A seeded permutation of the pads (Fisher–Yates on the Random port).
function shuffledPads(random: Random): number[] {
  const pads = Array.from({ length: PADS }, (_, i) => i)
  for (let i = pads.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[pads[i], pads[j]] = [pads[j] as number, pads[i] as number]
  }
  return pads
}

export interface SimonState {
  players: PlayerId[]
  // The shared base sequence; each player plays it through their own pad relabelling.
  seq: number[]
  startedAt: number
  endsAt: number
  ps: Map<PlayerId, SimonPlayerState>
}

// Real-time FFA sequence memory. One seeded pad sequence is shared by everyone; each player reproduces
// a growing prefix at their own pace and a wrong pad ends their run. Everyone sees it through their own
// seeded relabelling of the four pads — the same rhythm and repeats (equally hard), but a rival's
// prefix on the (room-wide) snapshot isn't the next pads of yours. Pure domain logic: the sequence
// comes from the injected Random port (seeded per round) and time arrives as `now`.
export class Simon implements MiniGame<SimonState, SimonInput> {
  readonly id = 'simon'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SimonState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const seq = Array.from({ length: MAX_LEN }, () => Math.floor(ctx.random.next() * PADS))
    const ps = new Map<PlayerId, SimonPlayerState>(
      ctx.players.map((id) => [
        id,
        { pads: shuffledPads(ctx.random), level: 1, pos: 0, alive: true, clearedMs: 0 },
      ]),
    )
    return { players: [...ctx.players], seq, startedAt: ctx.now, endsAt: ctx.now + durationMs, ps }
  }

  onInput(state: SimonState, playerId: PlayerId, input: SimonInput, now: number): SimonState {
    if (input.kind !== 'pad' || typeof input.pad !== 'number') return state
    if (now >= state.endsAt) return state
    const p = state.ps.get(playerId)
    if (!p?.alive) return state
    if (input.pad === p.pads[state.seq[p.pos] as number]) {
      p.pos += 1
      if (p.pos >= p.level) {
        // Reproduced the whole current prefix → advance a level (a new pad joins the replay).
        p.level += 1
        p.pos = 0
        p.clearedMs = now - state.startedAt
        // Cleared the entire sequence → freeze at the maximum.
        if (p.level > state.seq.length) p.alive = false
      }
    } else {
      // Out: `pos` keeps how far into this replay the run got (a tiebreak).
      p.alive = false
    }
    return state
  }

  // A player who left is out, so the round can end as soon as everyone else is.
  leave(state: SimonState, playerId: PlayerId, _now: number): SimonState {
    const p = state.ps.get(playerId)
    if (p) p.alive = false
    return state
  }

  isFinished(state: SimonState, now: number): boolean {
    if (now >= state.endsAt) return true
    for (const p of state.ps.values()) if (p.alive) return false
    return true
  }

  // Levels completed, then how far into the current replay the run got, then who cleared their last
  // level sooner. When (or whether) a run ended never counts: dying sooner can't rank higher.
  private cmp(state: SimonState, a: PlayerId, b: PlayerId): number {
    const pa = state.ps.get(a) as SimonPlayerState
    const pb = state.ps.get(b) as SimonPlayerState
    return pb.level - pa.level || pb.pos - pa.pos || pa.clearedMs - pb.clearedMs
  }

  getResult(state: SimonState): NormalizedResult {
    const completed = (id: PlayerId): number => (state.ps.get(id)?.level ?? 1) - 1
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
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
      // Only the prefix up to the player's current level, in their own pad colours — never the pads
      // still to come.
      const seq = state.seq.slice(0, p.level).map((pad) => p.pads[pad] as number)
      players[id] = { seq, pos: p.pos, alive: p.alive }
      scores[id] = p.level - 1
    }
    return { players, scores, pads: PADS, remainingMs: Math.max(0, state.endsAt - now) }
  }
}
