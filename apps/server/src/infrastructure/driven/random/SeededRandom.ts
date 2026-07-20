import type { Random } from '../../../domain/ports/Random'

// Seeded mulberry32 implementation of the Random port. Deterministic: the same seed reproduces an
// identical draw sequence, so a per-round seed gives every player the same board and server-side
// replay/validation is reproducible.
//
// NOT a CSPRNG — game rolls ONLY. Never use it for tokens, secrets, or session ids.
export class SeededRandom implements Random {
  private a: number

  constructor(seed: number) {
    this.a = seed >>> 0
  }

  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0
    let t = this.a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
