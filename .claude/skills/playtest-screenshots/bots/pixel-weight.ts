// Pixel Weight bot: counts its object's pixels off the packed bitmap and guesses near it (some bots
// sloppier than others), a guess every second or so — so a full room spreads over several levels.
type Obj = { index: number; cols: number; rows: number; bits: string }
type Snap = { objects: Obj[]; at: Record<string, number | null> }

const bitCount = (bits: string): number =>
  [...bits].reduce(
    (n, d) => n + (Number.parseInt(d, 16) || 0).toString(2).replace(/0/g, '').length,
    0,
  )

export default function play(s: Snap, me: string): unknown {
  const obj = s.objects.find((o) => o.index === s.at[me])
  if (!obj || Math.random() > 0.15) return null
  const off = Math.round((Math.random() * 2 - 1) * (1 + (me.charCodeAt(1) % 4) * 3))
  return { kind: 'guess', index: obj.index, value: Math.max(0, bitCount(obj.bits) + off) }
}
