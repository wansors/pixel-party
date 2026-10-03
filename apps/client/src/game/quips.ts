// Flavor-line pools — the banter layer (round callouts, elimination stamps, NPC heckles). A pool is a
// JSON array in the translation bundles, written separately per language, and every pick is stable:
// the same seed gives the same line on every client (the whole room laughs at the same jab) and on
// every frame (no flicker). Purely cosmetic: lines never carry game information.

// FNV-1a — a small, stable string hash.
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// translate() hands an array key back as the array itself; a plain string is a pool of one.
export function linesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((line): line is string => typeof line === 'string')
  return typeof value === 'string' && value !== '' ? [value] : []
}

export function pickLine(lines: readonly string[], seed: string): string {
  return lines.length > 0 ? (lines[hashSeed(seed) % lines.length] ?? '') : ''
}
