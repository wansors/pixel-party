// Difficulty curves (D40). Games used to tighten linearly over the round (gap × (1 - k·progress)),
// which feels flat: the last seconds play like the middle ones. These helpers give the shared,
// non-linear shapes instead — gentle at the start, biting at the end — so every game ramps the same
// way. Pure functions of `progress` (0 = round start, 1 = round end; clamped) or of a step count, so
// the server's deterministic schedules and any client prediction compute the very same numbers.

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x)

// Accelerating ease-in: progress^power (power 2 = quadratic, 3 = cubic). Slow start, steep finish.
export function easeIn(progress: number, power = 2): number {
  return clamp01(progress) ** power
}

// `from` → `to` along an ease-in curve (power 2 by default). Works for growing values (speeds,
// spawn counts) and shrinking ones (gaps, windows, periods) alike.
export function rampEase(from: number, to: number, progress: number, power = 2): number {
  return from + (to - from) * easeIn(progress, power)
}

// `from` → `to` geometrically: a constant percentage change per unit of progress (true exponential
// growth/decay — e.g. 1.0 → 2.0 doubles the speed by the end, passing ×1.41 at the half). Both ends
// must be > 0.
export function rampExp(from: number, to: number, progress: number): number {
  return from * (to / from) ** clamp01(progress)
}

// Compounding per step (a level, a turn, a wave): `base × factor^step`, held inside [min, max].
// factor < 1 shrinks (periods, windows), factor > 1 grows (speeds, lengths).
export function compound(
  base: number,
  factor: number,
  step: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
): number {
  const v = base * factor ** Math.max(0, step)
  return v < min ? min : v > max ? max : v
}
