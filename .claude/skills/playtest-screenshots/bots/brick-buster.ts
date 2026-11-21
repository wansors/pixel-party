// Brick Buster bot: carries its own board to "now" with the game's shared rules (from $PP_REPO) and
// aims the paddle under the ball that will reach it first — a little off-centre, to angle it back —
// or under a falling capsule when no ball is coming down. It reads a slightly stale snapshot and
// re-aims only on new snapshots, so the odd fast ball still gets past it — like a person.
const shared = await import(`${process.env.PP_REPO}/packages/shared/src/games/brickBuster.ts`)
const { BRICK, brickClone, brickRun, brickSnap } = shared

interface Ball {
  x: number
  y: number
  nx: number
  ny: number
}
interface Body {
  px: number
  balls: Ball[]
  caps: { x: number; y: number }[]
  serveAt: number
}
interface Snap {
  walls: unknown[]
  boards: Record<string, { body: Body; aims: { at: number; x: number }[] }>
  t: number
}

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const v = s?.boards?.[me]
  if (!v) return null
  const now = brickSnap(s.t + 30)
  if (now < BRICK.startDelayMs) return null
  const body = brickClone(v.body) as Body
  brickRun(body, now, v.aims, s.walls)
  // The ball that reaches the paddle line first (straight-line guess, walls folded in).
  let best: { x: number; eta: number } | null = null
  for (const ball of body.balls) {
    if (ball.ny <= 0) continue
    const eta = (BRICK.paddleY - ball.y) / ball.ny
    let x = ball.x + ball.nx * eta
    x = Math.abs(x) % 2
    if (x > 1) x = 2 - x
    if (!best || eta < best.eta) best = { x, eta }
  }
  // Each bot has its own habit of where on the paddle it takes the ball.
  let h = 0
  for (const ch of me) h = (h * 31 + ch.charCodeAt(0)) | 0
  const bias = ((Math.abs(h) % 7) - 3) * 0.01
  let aim = best ? best.x + (best.x < 0.5 ? 0.03 : -0.03) + bias : 0.5
  if (!best && body.caps.length) aim = (body.caps[0] as { x: number }).x
  if (body.serveAt > 0) aim = 0.5
  return { kind: 'aim', x: Math.min(1, Math.max(0, aim)), at: now }
}
