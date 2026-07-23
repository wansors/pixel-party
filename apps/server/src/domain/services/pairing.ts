import type { PlayerId } from '../minigames/MiniGame'
import type { Random } from '../ports/Random'

// A 1v1 pairing. `b` is null for the odd-player-out (a bye): no opponent, counts as a duel win.
export interface Pair {
  a: PlayerId
  b: PlayerId | null
}

// Seeded random pairing for simultaneous 1v1 duels (scoring-system.md §2.2). Shuffle the players, then
// pair them up two-by-two; an odd count leaves the last player with a bye. Deterministic via the Random
// port. Pure — no clock/RNG access beyond the injected port.
export function pairPlayers(playerIds: readonly PlayerId[], random: Random): Pair[] {
  const shuffled = [...playerIds]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j] as PlayerId, shuffled[i] as PlayerId]
  }
  const pairs: Pair[] = []
  for (let i = 0; i < shuffled.length; i += 2) {
    pairs.push({ a: shuffled[i] as PlayerId, b: shuffled[i + 1] ?? null })
  }
  return pairs
}
