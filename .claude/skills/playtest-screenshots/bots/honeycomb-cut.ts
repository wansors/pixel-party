// Honeycomb Cut bot: traces the outline calmly from its own starting point (needs PP_REPO for the shape
// outlines); one of them now and then rushes and cracks the candy.
type Snap = { shape: string; players: { id: string; broken: boolean; doneMs: number | null }[] }
type Shared = { honeycombOutline: (shape: string) => { x: number; y: number }[] }

const repo = process.env.PP_REPO
const shared: Shared | null = repo ? await import(`${repo}/packages/shared/src/index.ts`) : null
const at = new Map<string, number>()

export default function play(s: Snap, me: string): unknown {
  const p = s.players.find((q) => q.id === me)
  if (!shared || !p || p.broken || p.doneMs !== null) return null
  const outline = shared.honeycombOutline(s.shape)
  const rusher = me.charCodeAt(0) % 3 === 0
  const i = at.get(me) ?? me.length * 17
  at.set(me, i + (rusher ? 9 : 3))
  const q = outline[i % outline.length]
  return q ? { kind: 'needle', x: q.x, y: q.y, down: true } : null
}
