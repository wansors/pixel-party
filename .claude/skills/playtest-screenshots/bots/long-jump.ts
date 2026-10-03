// Field event bot (long jump; the javelin re-exports it): alternates feet down the runway, plants a
// stride or so before the line and releases the hold after 0.3 or 0.45 s (one call or two later) — a
// different plant and angle per bot, so a spread of marks (and their flags) shows up.
type Athlete = { id: string; phase: string; phaseMs: number; x: number; v: number }
type Snap = { foulLine: number; athletes: Athlete[] }

const lastFoot = new Map<string, 'L' | 'R'>()

export default function play(s: Snap, me: string): unknown {
  const a = s.athletes.find((q) => q.id === me)
  if (!a) return null
  if (a.phase === 'aim') {
    const holdMs = 300 + (me.charCodeAt(0) % 2) * 150
    return a.phaseMs >= holdMs ? { kind: 'jump', down: false } : null
  }
  if (a.phase !== 'run') return null
  const margin = 0.4 + (me.charCodeAt(1) % 3) * 0.6
  if (s.foulLine - a.x < margin + a.v * 0.15) return { kind: 'jump', down: true }
  const foot = lastFoot.get(me) === 'L' ? 'R' : 'L'
  lastFoot.set(me, foot)
  return { kind: 'step', foot }
}
