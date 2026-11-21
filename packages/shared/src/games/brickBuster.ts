// Brick Buster wire shapes and the board rules shared by the server and the client's prediction (D49).
// A brick breaker: everyone plays their own board against the same seeded walls — keep the ball up with
// your paddle, break bricks (hard ones take two hits), catch the capsules some bricks drop (a WIDE
// paddle, a MULTI-ball split), and a cleared wall scores a bonus and brings the next, harder one. A
// lost ball costs time (a new one waits on the paddle), not points. The ball speeds up over the round
// (D40) and with every wall.
//
// The board is integrated on a fixed BRICK.dtMs grid with plain arithmetic (and Math.sqrt, which is
// correctly rounded everywhere) — no Math.pow/sin… — so the server and every client compute the very
// same rally from the same paddle aims. The paddle chases its aim at a capped speed; aims carry the time
// they were set (on the client's estimate of the server's round clock) and the server judges
// BRICK.judgeMs behind real time, so the client predicts its own board bit for bit.

export const BRICK = {
  // GET READY this long; the first ball launches BRICK.serveMs later.
  startDelayMs: 1500,
  dtMs: 5,
  judgeMs: 150,
  // The board: 1 wide, `h` tall (0 = top). Bricks: `cols` × `rows`, from `top`, `brickH` tall.
  h: 1.3,
  cols: 10,
  rows: 7,
  top: 0.14,
  brickH: 0.05,
  ballR: 0.014,
  // Paddle: its top edge, thickness, width (WIDE: wider), top speed (units/s).
  paddleY: 1.18,
  paddleH: 0.028,
  paddleW: 0.2,
  wideW: 0.32,
  paddleSpeed: 2.6,
  // A ball rests on the paddle this long before it launches; after the last ball is lost, the next
  // one appears after `dropMs` (and then rests as usual).
  serveMs: 700,
  dropMs: 900,
  // Capsules fall this fast; WIDE lasts `wideMs`.
  capsuleVy: 0.4,
  capsuleW: 0.08,
  capsuleH: 0.032,
  wideMs: 12_000,
  maxBalls: 6,
  // A cleared wall scores this on top of its bricks.
  clearBonus: 10,
  // Aims closer than this are dropped.
  minAimGapMs: 30,
} as const

// Ball speed (units/s): eases in over the round (D40), and each wall cleared adds a little.
export const BRICK_PACE = { from: 0.7, to: 1.3, rampMs: 55_000, perWall: 0.07 } as const

// Capsule kinds.
export const BRICK_WIDE = 0
export const BRICK_MULTI = 1

export interface BrickWall {
  // BRICK.rows × BRICK.cols, row-major: '0' none, '1' brick, '2' hard brick (two hits).
  bricks: string
  // Brick index → the capsule it drops (BRICK_WIDE / BRICK_MULTI).
  caps: Record<number, number>
}

export interface BrickBall {
  x: number
  y: number
  // Unit direction.
  nx: number
  ny: number
}

export interface BrickCapsule {
  x: number
  y: number
  kind: number
}

// One player's board at a point in time (ms since the round started).
export interface BrickBody {
  t: number
  // Paddle center and where it's heading.
  px: number
  aim: number
  balls: BrickBall[]
  // > 0: the one ball rests on the paddle until this round time.
  serveAt: number
  // Which wall (index into the walls; wraps) and what's left of it.
  wall: number
  bricks: string
  caps: BrickCapsule[]
  wideUntil: number
  score: number
  // Balls lost (the last one in play), bricks hit, paddle returns, capsules caught — for the result
  // and for the client's sounds.
  drops: number
  hits: number
  returns: number
  caught: number
}

export interface BrickAim {
  // Round time it was set (snapped to the grid) and the paddle's new aim (0..1).
  at: number
  x: number
}

export const brickSnap = (t: number): number => Math.ceil(t / BRICK.dtMs) * BRICK.dtMs

// Ball speed at round time `t` on wall `wall`.
export function brickSpeed(t: number, wall: number): number {
  const p = Math.min(1, Math.max(0, (t - BRICK.startDelayMs) / BRICK_PACE.rampMs))
  return (
    (BRICK_PACE.from + (BRICK_PACE.to - BRICK_PACE.from) * p * p) * (1 + BRICK_PACE.perWall * wall)
  )
}

export const brickHalfW = (b: BrickBody): number =>
  (b.t < b.wideUntil ? BRICK.wideW : BRICK.paddleW) / 2

// The launch direction: up and a little to the side away from the nearer wall.
const LAUNCH_LEN = Math.sqrt(0.35 * 0.35 + 1)
const LAUNCH_X = 0.35 / LAUNCH_LEN
const LAUNCH_Y = -1 / LAUNCH_LEN
// A MULTI capsule splits each ball into three: itself and two copies turned ±25°.
const SPLIT_COS = 0.9063077870366499
const SPLIT_SIN = 0.42261826174069944

const restingBall = (px: number): BrickBall => ({
  x: px,
  y: BRICK.paddleY - BRICK.ballR - 0.001,
  nx: 0,
  ny: 0,
})

export function brickNewBody(wall: BrickWall, t: number = BRICK.startDelayMs): BrickBody {
  return {
    t,
    px: 0.5,
    aim: 0.5,
    balls: [restingBall(0.5)],
    serveAt: t + BRICK.serveMs,
    wall: 0,
    bricks: wall.bricks,
    caps: [],
    wideUntil: 0,
    score: 0,
    drops: 0,
    hits: 0,
    returns: 0,
    caught: 0,
  }
}

export const brickLeft = (bricks: string): number => {
  let n = 0
  for (let i = 0; i < bricks.length; i++) if (bricks[i] !== '0') n++
  return n
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

// Bounces a ball off the first brick it overlaps (one per step): flips the axis it came in on, pushes
// it out, and chips the brick. Returns the brick's index or −1.
function hitBrick(b: BrickBody, ball: BrickBall, walls: readonly BrickWall[]): number {
  const r = BRICK.ballR
  const bw = 1 / BRICK.cols
  const c0 = Math.max(0, Math.floor((ball.x - r) * BRICK.cols))
  const c1 = Math.min(BRICK.cols - 1, Math.floor((ball.x + r) * BRICK.cols))
  const r0 = Math.max(0, Math.floor((ball.y - r - BRICK.top) / BRICK.brickH))
  const r1 = Math.min(BRICK.rows - 1, Math.floor((ball.y + r - BRICK.top) / BRICK.brickH))
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const i = row * BRICK.cols + col
      const cell = b.bricks[i]
      if (cell === undefined || cell === '0') continue
      const left = col * bw
      const top = BRICK.top + row * BRICK.brickH
      // Where the ball was a step ago decides the side it came in on.
      const step = (brickSpeed(b.t, b.wall) * BRICK.dtMs) / 1000
      const prevX = ball.x - ball.nx * step
      if (prevX > left - r && prevX < left + bw + r) {
        ball.ny = -ball.ny
        ball.y = ball.ny < 0 ? top - r : top + BRICK.brickH + r
      } else {
        ball.nx = -ball.nx
        ball.x = ball.nx < 0 ? left - r : left + bw + r
      }
      b.bricks = b.bricks.slice(0, i) + (cell === '2' ? '1' : '0') + b.bricks.slice(i + 1)
      b.hits += 1
      b.score += 1
      const kind = walls[b.wall % walls.length]?.caps[i]
      if (cell === '1' && kind !== undefined)
        b.caps.push({ x: left + bw / 2, y: top + BRICK.brickH / 2, kind })
      return i
    }
  }
  return -1
}

// One integration step (BRICK.dtMs): take the aim due at this step's start (null = none), move the
// paddle, launch a resting ball when it's time, fly the balls (walls, paddle, bricks), drop the
// capsules, then lose / clear what needs it.
export function brickStep(b: BrickBody, aim: number | null, walls: readonly BrickWall[]): void {
  if (aim !== null) b.aim = clamp(aim, 0, 1)
  const half = brickHalfW(b)
  const target = clamp(b.aim, half, 1 - half)
  const maxStep = (BRICK.paddleSpeed * BRICK.dtMs) / 1000
  b.px = clamp(b.px + clamp(target - b.px, -maxStep, maxStep), half, 1 - half)
  const r = BRICK.ballR
  if (b.serveAt > 0) {
    const ball = b.balls[0]
    if (ball) {
      ball.x = b.px
      if (b.t >= b.serveAt) {
        ball.nx = b.px < 0.5 ? LAUNCH_X : -LAUNCH_X
        ball.ny = LAUNCH_Y
        b.serveAt = 0
      }
    }
  } else {
    const step = (brickSpeed(b.t, b.wall) * BRICK.dtMs) / 1000
    for (const ball of b.balls) {
      ball.x += ball.nx * step
      ball.y += ball.ny * step
      if (ball.x < r) {
        ball.x = 2 * r - ball.x
        ball.nx = Math.abs(ball.nx)
      } else if (ball.x > 1 - r) {
        ball.x = 2 * (1 - r) - ball.x
        ball.nx = -Math.abs(ball.nx)
      }
      if (ball.y < r) {
        ball.y = 2 * r - ball.y
        ball.ny = Math.abs(ball.ny)
      }
      // The paddle: crossing its top edge this step, within its width — the further out it lands, the
      // wider the angle back.
      if (
        ball.ny > 0 &&
        ball.y + r >= BRICK.paddleY &&
        ball.y + r - ball.ny * step <= BRICK.paddleY &&
        Math.abs(ball.x - b.px) <= half + r
      ) {
        const vx = clamp((ball.x - b.px) / (half + r), -1, 1) * 1.25
        const len = Math.sqrt(vx * vx + 1)
        ball.nx = vx / len
        ball.ny = -1 / len
        ball.y = BRICK.paddleY - r
        b.returns += 1
      }
      if (ball.y < BRICK.top + BRICK.rows * BRICK.brickH + r) hitBrick(b, ball, walls)
    }
    b.balls = b.balls.filter((ball) => ball.y - r <= BRICK.h)
  }
  // Capsules fall; the paddle catches them.
  if (b.caps.length) {
    const fall = (BRICK.capsuleVy * BRICK.dtMs) / 1000
    const kept: BrickCapsule[] = []
    for (const cap of b.caps) {
      cap.y += fall
      const caught =
        cap.y + BRICK.capsuleH / 2 >= BRICK.paddleY &&
        cap.y - BRICK.capsuleH / 2 <= BRICK.paddleY + BRICK.paddleH &&
        Math.abs(cap.x - b.px) <= half + BRICK.capsuleW / 2
      if (caught) {
        b.caught += 1
        if (cap.kind === BRICK_WIDE) b.wideUntil = b.t + BRICK.wideMs
        else if (b.serveAt === 0) splitBalls(b)
      } else if (cap.y - BRICK.capsuleH / 2 <= BRICK.h) kept.push(cap)
    }
    b.caps = kept
  }
  b.t += BRICK.dtMs
  if (b.serveAt === 0 && b.balls.length === 0) {
    b.drops += 1
    b.balls = [restingBall(b.px)]
    b.serveAt = b.t + BRICK.dropMs + BRICK.serveMs
  }
  if (brickLeft(b.bricks) === 0) {
    b.score += BRICK.clearBonus
    b.wall += 1
    b.bricks = walls[b.wall % walls.length]?.bricks ?? b.bricks
    b.caps = []
    b.balls = [restingBall(b.px)]
    b.serveAt = b.t + BRICK.serveMs
  }
}

function splitBalls(b: BrickBody): void {
  const out: BrickBall[] = []
  for (const ball of b.balls) {
    out.push(ball)
    for (const s of [SPLIT_SIN, -SPLIT_SIN]) {
      const nx = ball.nx * SPLIT_COS - ball.ny * s
      const ny = ball.nx * s + ball.ny * SPLIT_COS
      if (Math.abs(ny) >= 0.3) out.push({ x: ball.x, y: ball.y, nx, ny })
    }
  }
  b.balls = out.slice(0, BRICK.maxBalls)
}

// Carries a board forward to `until` (round ms, on the grid), taking the aims (snapped, ascending) at
// their times; several due at one step: the last one wins.
export function brickRun(
  b: BrickBody,
  until: number,
  aims: readonly BrickAim[],
  walls: readonly BrickWall[],
): void {
  let i = 0
  while (i < aims.length && (aims[i] as BrickAim).at < b.t) i++
  while (b.t < until) {
    let aim: number | null = null
    while (i < aims.length && (aims[i] as BrickAim).at <= b.t) {
      aim = (aims[i] as BrickAim).x
      i++
    }
    brickStep(b, aim, walls)
  }
}

// A deep copy (balls and capsules are mutated in place by the step).
export const brickClone = (b: BrickBody): BrickBody => ({
  ...b,
  balls: b.balls.map((ball) => ({ ...ball })),
  caps: b.caps.map((cap) => ({ ...cap })),
})

export interface BrickBoardView {
  // Judged board at body.t...
  body: BrickBody
  // ...and the aims already set after it.
  aims: BrickAim[]
  // The last input `seq` the server has taken (0 = none).
  ack: number
}

export interface BrickBusterSnapshot {
  // The seeded walls, the same for everyone (a board on wall n plays walls[n % length]).
  walls: BrickWall[]
  boards: Record<string, BrickBoardView>
  // Round time (ms since the round started — GO is at BRICK.startDelayMs) at this snapshot.
  t: number
  // playerId -> score, for the live standings.
  progress: Record<string, number>
  remainingMs: number
}

// Point the paddle at `x` (0..1). `at` is when (round ms on the client's estimate of the server clock).
export interface BrickBusterInput {
  kind: 'aim'
  x: number
  at?: number
  seq?: number
}
