import { type BugKind, type BugSmashInput, type BugSmashSnapshot, rampEase } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const HOLES = 9
const DEFAULT_DURATION_MS = 30_000
// Difficulty ramp, on an ease-in over the round: bugs peek out for 800–1400 ms at first, ~45% of that
// by the end (SHOW_RAMP), pop up twice as often (SPAWN_RAMP) and more of them are bombs — the last
// seconds are a frenzy where a careless tap costs.
const SHOW_MIN_MS = 800
const SHOW_JITTER_MS = 600
const SPAWN_MIN_MS = 250
const SPAWN_JITTER_MS = 300
const SHOW_RAMP = 0.45
const SPAWN_RAMP = 0.5
const BOMB_CHANCE_START = 0.18
const BOMB_CHANCE_END = 0.32

interface Spawn {
  hole: number
  appearAt: number
  durationMs: number
  kind: BugKind
}

export interface BugSmashState {
  players: PlayerId[]
  spawns: Spawn[]
  startedAt: number
  endsAt: number
  scores: Map<PlayerId, number>
  // playerId -> spawn indices already smashed (prevents double-scoring one bug).
  hits: Map<PlayerId, Set<number>>
}

// Real-time FFA whack-a-mole. One seeded spawn timeline is shared by everyone; each player smashes
// independently. Bugs score, bombs cost a point — even at zero (a score can go negative), so a bomb
// always hurts. The bugs get quicker and busier over the round (an ease-in, not a straight line). Pure
// domain logic: the timeline is drawn from the injected Random port (seeded per round) and time
// arrives as `now`.
export class BugSmash implements MiniGame<BugSmashState, BugSmashInput> {
  readonly id = 'bug-smash'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BugSmashState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const spawns: Spawn[] = []
    const holeFreeAt = new Array<number>(HOLES).fill(0)
    let t = 600
    while (t < durationMs - 400) {
      const free = holeFreeAt.flatMap((freeAt, hole) => (freeAt <= t ? [hole] : []))
      const p = t / durationMs
      if (free.length > 0) {
        const hole = free[Math.floor(r.next() * free.length)] as number
        const durMs = Math.round(
          (SHOW_MIN_MS + r.next() * SHOW_JITTER_MS) * rampEase(1, SHOW_RAMP, p),
        )
        const bombChance = rampEase(BOMB_CHANCE_START, BOMB_CHANCE_END, p)
        const kind: BugKind = r.next() < bombChance ? 'bomb' : 'bug'
        spawns.push({ hole, appearAt: t, durationMs: durMs, kind })
        holeFreeAt[hole] = t + durMs + 150
      }
      t += Math.round((SPAWN_MIN_MS + r.next() * SPAWN_JITTER_MS) * rampEase(1, SPAWN_RAMP, p))
    }
    return {
      players: [...ctx.players],
      spawns,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
      scores: new Map(ctx.players.map((id) => [id, 0])),
      hits: new Map(ctx.players.map((id) => [id, new Set<number>()])),
    }
  }

  private liveIndexAt(state: BugSmashState, hole: number, now: number): number {
    return state.spawns.findIndex(
      (s) =>
        s.hole === hole &&
        now >= state.startedAt + s.appearAt &&
        now < state.startedAt + s.appearAt + s.durationMs,
    )
  }

  onInput(
    state: BugSmashState,
    playerId: PlayerId,
    input: BugSmashInput,
    now: number,
  ): BugSmashState {
    if (input.kind !== 'smash' || typeof input.hole !== 'number') return state
    if (now >= state.endsAt) return state
    const hits = state.hits.get(playerId)
    if (!hits) return state
    const idx = this.liveIndexAt(state, input.hole, now)
    if (idx < 0 || hits.has(idx)) return state
    hits.add(idx)
    const spawn = state.spawns[idx] as Spawn
    const cur = state.scores.get(playerId) ?? 0
    state.scores.set(playerId, spawn.kind === 'bug' ? cur + 1 : cur - 1)
    return state
  }

  isFinished(state: BugSmashState, now: number): boolean {
    return now >= state.endsAt
  }

  getResult(state: BugSmashState): NormalizedResult {
    const sorted = [...state.players].sort(
      (a, b) => (state.scores.get(b) ?? 0) - (state.scores.get(a) ?? 0),
    )
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: number | undefined
    sorted.forEach((id, idx) => {
      const v = state.scores.get(id) ?? 0
      if (idx > 0 && v !== prev) rank = idx
      ranks[id] = rank
      prev = v
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.scores.get(id) ?? 0} pts`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: BugSmashState, now: number): BugSmashSnapshot {
    const live = state.spawns.flatMap((s, index) =>
      now >= state.startedAt + s.appearAt && now < state.startedAt + s.appearAt + s.durationMs
        ? [{ index, hole: s.hole, kind: s.kind }]
        : [],
    )
    return {
      holes: HOLES,
      live,
      scores: Object.fromEntries(state.scores),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
