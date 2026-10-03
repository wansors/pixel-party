import type { PlayerId } from '../minigames/MiniGame'
import type { Random } from '../ports/Random'

// A 1v1 pairing. `b` is null for the odd-player-out (a bye): no opponent, counts as a duel win.
export interface Pair {
  a: PlayerId
  b: PlayerId | null
}

// Seeded random pairing for simultaneous 1v1 duels (scoring-system.md §2.2). An odd roster hands the bye
// to one of the players with the fewest byes so far (`byeCounts`, fed back by the engine — so byes
// rotate across a session), then the rest are shuffled and paired two-by-two. Deterministic via the
// Random port. Pure — no clock/RNG access beyond the injected port.
export function pairPlayers(
  playerIds: readonly PlayerId[],
  random: Random,
  byeCounts: Readonly<Record<PlayerId, number>> = {},
): Pair[] {
  const pool = [...playerIds]
  let bye: PlayerId | null = null
  if (pool.length % 2 === 1) {
    const fewest = Math.min(...pool.map((id) => byeCounts[id] ?? 0))
    const due = pool.filter((id) => (byeCounts[id] ?? 0) === fewest)
    bye = due[Math.floor(random.next() * due.length)] as PlayerId
    pool.splice(pool.indexOf(bye), 1)
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j] as PlayerId, pool[i] as PlayerId]
  }
  const pairs: Pair[] = []
  for (let i = 0; i < pool.length; i += 2) {
    pairs.push({ a: pool[i] as PlayerId, b: pool[i + 1] as PlayerId })
  }
  if (bye !== null) pairs.push({ a: bye, b: null })
  return pairs
}
