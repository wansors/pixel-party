// Pixel Hoops bot: releases near the shot's target power, a shot every second or so (bots differ).
type Snap = { shots: Record<string, { index: number; distance: number } | null> }

export default function play(s: Snap, me: string): unknown {
  const shot = s.shots[me]
  if (!shot || Math.random() > 0.15) return null
  const slop = (Math.random() * 2 - 1) * (0.04 + (me.charCodeAt(1) % 4) * 0.04)
  return { kind: 'shoot', index: shot.index, power: Math.max(0, Math.min(1, shot.distance + slop)) }
}
