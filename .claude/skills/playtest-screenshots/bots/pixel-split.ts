// Pixel Split bot: finds the best cut from the packed bitmap's column counts, then misses it by up to
// a few columns (bots differ), a cut every second or so.
type Obj = { index: number; cols: number; rows: number; bits: string }
type Snap = { objects: Obj[]; at: Record<string, number | null> }

export default function play(s: Snap, me: string): unknown {
  const obj = s.objects.find((o) => o.index === s.at[me])
  if (!obj || Math.random() > 0.15) return null
  const digits = Math.ceil(obj.cols / 4)
  const cols = Array.from({ length: obj.cols }, (_, x) => {
    let n = 0
    for (let y = 0; y < obj.rows; y++) {
      if ((Number.parseInt(obj.bits[y * digits + (x >> 2)] ?? '0', 16) || 0) & (8 >> (x & 3))) n++
    }
    return n
  })
  const total = cols.reduce((a, b) => a + b, 0)
  let best = 1
  let left = 0
  let bestErr = Number.POSITIVE_INFINITY
  for (let cut = 1; cut < obj.cols; cut++) {
    left += cols[cut - 1] ?? 0
    const err = Math.abs(total - 2 * left)
    if (err < bestErr) [best, bestErr] = [cut, err]
  }
  const slop = Math.round((Math.random() * 2 - 1) * (me.charCodeAt(1) % 3))
  return { kind: 'cut', index: obj.index, cut: Math.max(1, Math.min(obj.cols - 1, best + slop)) }
}
