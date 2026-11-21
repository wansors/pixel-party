import {
  SPOOK,
  SPOOK_ITEMS,
  type SpookFigure,
  type SpookInput,
  type SpookPlayerView,
  type SpookSnapshot,
  spookAnswer,
  spookAward,
  spookWindowMs,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 45_000
// Cards dealt at init: more than a round can get through.
const DECK = 60
// Share of cards with an object shown exactly (the rest ask for the one that isn't there).
const EXACT_SHARE = 0.45

interface Spooker {
  points: number
  lockedUntil: number
  // This card.
  answered: boolean
  place: number
  // Tiebreaks: first places, wrong grabs.
  firsts: number
  wrongs: number
  gone: boolean
}

export interface SpookState {
  players: PlayerId[]
  spookers: Map<PlayerId, Spooker>
  deck: SpookFigure[][]
  phase: 'ready' | 'card' | 'reveal'
  // 1-based card in play (0 before the first).
  cardNo: number
  rights: number
  phaseEndsAt: number
  startedAt: number
  endsAt: number
}

const pickFrom = (r: Random, xs: readonly number[]): number =>
  xs[Math.floor(r.next() * xs.length)] as number

// One card's two figures, seeded. From SPOOK.twistFrom on they turn and shrink, a little more each card.
function dealCard(r: Random, n: number): SpookFigure[] {
  const twist = n >= SPOOK.twistFrom
  const spin = Math.min(60, 8 * (n - SPOOK.twistFrom + 1))
  const fig = (shape: number, color: number): SpookFigure => ({
    shape,
    color,
    rot: twist ? Math.round((r.next() * 2 - 1) * spin) : 0,
    scale: twist ? Math.round((0.72 + r.next() * 0.38) * 100) / 100 : 1,
  })
  const all = Array.from({ length: SPOOK_ITEMS }, (_, i) => i)
  let figures: SpookFigure[]
  if (r.next() < EXACT_SHARE) {
    // One object exactly, plus a decoy that matches nothing exactly.
    const x = pickFrom(r, all)
    const s = pickFrom(
      r,
      all.filter((i) => i !== x),
    )
    const c = pickFrom(
      r,
      all.filter((i) => i !== x && i !== s),
    )
    figures = [fig(x, x), fig(s, c)]
  } else {
    // Shapes of two objects in the colours of two others: the fifth shares nothing — that's the one.
    const deck = [...all]
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j] as number, deck[i] as number]
    }
    const [a, b, e, f] = deck as [number, number, number, number, number]
    figures = r.next() < 0.5 ? [fig(a, e), fig(b, f)] : [fig(a, f), fig(b, e)]
  }
  return r.next() < 0.5 ? figures : [figures[1] as SpookFigure, figures[0] as SpookFigure]
}

// Spook Snatch (D46): a real-time FFA reflex-and-logic race on one card at a time. Every player sees the
// same seeded card and grabs one of five objects; the first right answers score 3, 2, 1 (and 1 for
// any later right answer while the card is open), a wrong grab locks the player out for SPOOK.lockMs.
// A card closes when its window runs out, when enough players got it (half the room, at least three)
// or when everyone has answered; the answer shows, then the next card. Answers are judged in the order
// they reach the server. Most points wins; first places, then fewer wrong grabs, break ties.
export class SpookSnatch implements MiniGame<SpookState, SpookInput> {
  readonly id = 'spook-snatch'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SpookState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const deck = Array.from({ length: DECK }, (_, i) => dealCard(ctx.random, i + 1))
    const spookers = new Map<PlayerId, Spooker>(
      ctx.players.map((id) => [
        id,
        {
          points: 0,
          lockedUntil: 0,
          answered: false,
          place: 0,
          firsts: 0,
          wrongs: 0,
          gone: false,
        },
      ]),
    )
    return {
      players: [...ctx.players],
      spookers,
      deck,
      phase: 'ready',
      cardNo: 0,
      rights: 0,
      phaseEndsAt: ctx.now + SPOOK.startDelayMs,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  private figures(state: SpookState): SpookFigure[] {
    return state.deck[(state.cardNo - 1) % state.deck.length] ?? []
  }

  private openCard(state: SpookState, now: number): void {
    state.cardNo += 1
    state.rights = 0
    state.phase = 'card'
    state.phaseEndsAt = now + spookWindowMs(state.cardNo)
    for (const s of state.spookers.values()) {
      s.answered = false
      s.place = 0
    }
  }

  private reveal(state: SpookState, now: number): void {
    state.phase = 'reveal'
    state.phaseEndsAt = now + SPOOK.revealMs
  }

  // Enough right answers (half the room, at least three), or nobody left to answer.
  private settled(state: SpookState): boolean {
    const cap = Math.max(3, Math.ceil(state.players.length / 2))
    if (state.rights >= Math.min(cap, state.players.length)) return true
    for (const s of state.spookers.values()) if (!s.gone && !s.answered) return false
    return true
  }

  onInput(state: SpookState, playerId: PlayerId, input: SpookInput, now: number): SpookState {
    if (input?.kind !== 'grab' || state.phase !== 'card' || now >= state.endsAt) return state
    const s = state.spookers.get(playerId)
    if (!s || s.answered || now < s.lockedUntil) return state
    if (input.card !== state.cardNo || !Number.isInteger(input.item)) return state
    if (input.item < 0 || input.item >= SPOOK_ITEMS) return state
    s.answered = true
    if (input.item === spookAnswer(this.figures(state))) {
      state.rights += 1
      s.place = state.rights
      s.points += spookAward(s.place)
      if (s.place === 1) s.firsts += 1
    } else {
      s.lockedUntil = now + SPOOK.lockMs
      s.wrongs += 1
    }
    if (this.settled(state)) this.reveal(state, now)
    return state
  }

  tick(state: SpookState, _dt: number, now: number): SpookState {
    if (now < state.phaseEndsAt || now >= state.endsAt) return state
    if (state.phase === 'card') this.reveal(state, now)
    else this.openCard(state, now)
    return state
  }

  // A player who leaves stops counting toward "everyone answered".
  leave(state: SpookState, playerId: PlayerId, now: number): SpookState {
    const s = state.spookers.get(playerId)
    if (s) s.gone = true
    if (state.phase === 'card' && this.settled(state)) this.reveal(state, now)
    return state
  }

  isFinished(state: SpookState, now: number): boolean {
    return now >= state.endsAt
  }

  private cmp(state: SpookState, a: PlayerId, b: PlayerId): number {
    const sa = state.spookers.get(a)
    const sb = state.spookers.get(b)
    return (
      (sb?.points ?? 0) - (sa?.points ?? 0) ||
      (sb?.firsts ?? 0) - (sa?.firsts ?? 0) ||
      (sa?.wrongs ?? 0) - (sb?.wrongs ?? 0)
    )
  }

  getResult(state: SpookState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.spookers.get(id)?.points ?? 0} pts`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: SpookState, now: number): SpookSnapshot {
    const players: Record<PlayerId, SpookPlayerView> = {}
    const scores: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const s = state.spookers.get(id) as Spooker
      players[id] = {
        points: s.points,
        lockedMs: Math.max(0, s.lockedUntil - now),
        answered: s.answered,
        place: s.place,
      }
      scores[id] = s.points
    }
    const figures = state.cardNo > 0 ? this.figures(state) : []
    return {
      phase: state.phase,
      cardNo: state.cardNo,
      figures,
      ...(state.phase === 'reveal' ? { answer: spookAnswer(figures) } : {}),
      phaseMs: Math.max(0, state.phaseEndsAt - now),
      windowMs: spookWindowMs(Math.max(1, state.cardNo)),
      players,
      scores,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
