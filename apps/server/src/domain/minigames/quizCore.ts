import type { Random } from '../ports/Random'
import type { NormalizedResult, PlayerId } from './MiniGame'

// Shared rules of the quiz games (Lightning Quiz, Weird Trivia): seeded question picks, the right-answer
// score (base + speed bonus) and the points ranking.

const BASE_POINTS = 1000
const SPEED_BONUS = 1000

// Fisher–Yates using the seeded Random port, so every player in a room gets the identical quiz.
export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Points for a right answer: the base plus a speed bonus scaled by the time left in the answer window.
export function rightAnswerPoints(remainingMs: number, windowMs: number): number {
  const left = Math.max(0, Math.min(windowMs, remainingMs))
  return BASE_POINTS + Math.round((left / windowMs) * SPEED_BONUS)
}

// Ranks by total points (equal totals share a rank).
export function rankByPoints(
  players: readonly PlayerId[],
  points: ReadonlyMap<PlayerId, number>,
  stat: (id: PlayerId) => string,
): NormalizedResult {
  const total = (id: PlayerId): number => points.get(id) ?? 0
  const placements = [...players].sort((a, b) => total(b) - total(a))
  const ranks: Record<PlayerId, number> = {}
  let rank = 0
  placements.forEach((id, idx) => {
    if (idx > 0 && total(id) !== total(placements[idx - 1])) rank = idx
    ranks[id] = rank
  })
  const stats: Record<PlayerId, string> = {}
  for (const id of players) stats[id] = stat(id)
  return { placements, ranks, stats }
}
