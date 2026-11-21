// Sky Joust wire shapes and the world rules shared by the server and the client's prediction (D51). A
// flap-and-joust arena: everyone flies one wrap-around sky over a few floating ledges and a lava pit.
// Flap to climb, steer to glide; when two riders collide, the one on top unhorses the other (+1) —
// level clashes just bounce apart. The unhorsed fall, then come back a moment later (no eliminations);
// the lava costs a point. Over the round the ground ledges crumble toward the walls (D40), so the
// lava gets wider. Highest score wins.
//
// The world is integrated on a fixed JOUST.dtMs grid with plain arithmetic only, so the server and
// every client compute the same flight from the same commands. Commands (flap / steer) carry the time
// they were pressed and the server judges JOUST.judgeMs behind real time. The client runs the world
// forward from each snapshot with every command it knows — without rider-on-rider hits (those wait for
// the server's word, since a rival's newest flap may not have reached it yet).

export const JOUST = {
  // The sky: `w` wide (wraps around), 1 tall (0 = top).
  w: 1.6,
  startDelayMs: 1500,
  dtMs: 10,
  judgeMs: 150,
  radius: 0.034,
  gravity: 1.5,
  // A flap: up by this much (on top of any rise, capped).
  flapVy: 0.5,
  maxRise: 0.9,
  maxFall: 1.1,
  maxVx: 0.55,
  airAccel: 1.3,
  groundAccel: 2.6,
  // A clash counts as a win when one rider is this much higher than the other.
  margin: 0.005,
  bounceVy: -0.35,
  // Unhorsed or in the lava: out this long, then back on a ledge, safe for `safeMs`.
  downMs: 1500,
  safeMs: 1500,
  // Flaps closer than this are dropped.
  minFlapGapMs: 60,
  lavaCost: 1,
} as const

// A ledge: left edge, top, width (riders land on its top, fly up through it).
export interface JoustLedge {
  x: number
  y: number
  w: number
}

// The floating ledges (fixed), and the two ground ledges along the bottom that crumble over the round.
export const JOUST_LEDGES: readonly JoustLedge[] = [
  { x: 0.2, y: 0.66, w: 0.34 },
  { x: 1.06, y: 0.66, w: 0.34 },
  { x: 0.62, y: 0.46, w: 0.36 },
  { x: 0.08, y: 0.3, w: 0.28 },
  { x: 1.24, y: 0.3, w: 0.28 },
  { x: 0.66, y: 0.16, w: 0.28 },
]
export const JOUST_GROUND = { y: 0.9, from: 0.62, to: 0.26, rampMs: 50_000 } as const

// Where riders (re)appear: on a ledge, just above it.
export const JOUST_SPAWNS: readonly (readonly [number, number])[] = [
  [0.3, 0.66],
  [1.3, 0.66],
  [0.8, 0.46],
  [0.22, 0.3],
  [1.38, 0.3],
  [0.8, 0.16],
  [0.44, 0.66],
  [1.16, 0.66],
  [0.7, 0.46],
  [0.9, 0.46],
  [0.14, 0.3],
  [1.46, 0.3],
]

// Each ground ledge's width at round time `t` (from each wall inward): an ease-in (D40), written as
// p·p rather than through `**` so every engine lands on the very same bits.
export function joustGroundW(t: number): number {
  const p = Math.min(1, Math.max(0, (t - JOUST.startDelayMs) / JOUST_GROUND.rampMs))
  return JOUST_GROUND.from + (JOUST_GROUND.to - JOUST_GROUND.from) * p * p
}

// Every ledge at round time `t` (the two ground ledges included).
export function joustLedges(t: number): JoustLedge[] {
  const g = joustGroundW(t)
  return [
    ...JOUST_LEDGES,
    { x: 0, y: JOUST_GROUND.y, w: g },
    { x: JOUST.w - g, y: JOUST_GROUND.y, w: g },
  ]
}

export interface JoustRider {
  x: number
  y: number
  vx: number
  vy: number
  // Held steer (−1, 0, 1) and facing (−1 / 1).
  steer: number
  face: number
  ground: boolean
  // > t: out (unhorsed / in the lava); then back on a ledge and safe until `safeUntil`.
  downUntil: number
  safeUntil: number
  score: number
  // Riders unhorsed, times unhorsed, lava dips, clashes (for the result and the client's effects).
  wins: number
  losses: number
  lava: number
  clashes: number
  // When the last flap happened (round ms; cosmetic, for the wing beat).
  flapAt: number
}

export interface JoustWorld {
  t: number
  riders: JoustRider[]
}

export interface JoustCmd {
  // Round time it was pressed (snapped to the grid); a flap and/or a new steer.
  at: number
  flap?: boolean
  steer?: number
}

export const joustSnap = (t: number): number => Math.ceil(t / JOUST.dtMs) * JOUST.dtMs

export function joustNewWorld(players: number, t: number = JOUST.startDelayMs): JoustWorld {
  const riders: JoustRider[] = Array.from({ length: players }, (_, i) => {
    const [x, y] = JOUST_SPAWNS[i % JOUST_SPAWNS.length] as readonly [number, number]
    return {
      x,
      y: y - JOUST.radius,
      vx: 0,
      vy: 0,
      steer: 0,
      face: x < JOUST.w / 2 ? 1 : -1,
      ground: true,
      downUntil: 0,
      safeUntil: 0,
      score: 0,
      wins: 0,
      losses: 0,
      lava: 0,
      clashes: 0,
      flapAt: -1e9,
    }
  })
  return { t, riders }
}

export const joustClone = (w: JoustWorld): JoustWorld => ({
  t: w.t,
  riders: w.riders.map((r) => ({ ...r })),
})

const wrap = (x: number): number => ((x % JOUST.w) + JOUST.w) % JOUST.w
// Shortest horizontal gap from a to b across the wrap.
export const joustDx = (a: number, b: number): number => {
  let d = b - a
  if (d > JOUST.w / 2) d -= JOUST.w
  else if (d < -JOUST.w / 2) d += JOUST.w
  return d
}

const active = (r: JoustRider, t: number): boolean => r.downUntil <= t

// Back on the spawn ledge farthest from everyone else (ties: the lowest index).
function respawn(w: JoustWorld, r: JoustRider): void {
  let best = 0
  let bestD = -1
  JOUST_SPAWNS.forEach(([sx, sy], i) => {
    let near = 99
    for (const o of w.riders) {
      if (o === r || !active(o, w.t)) continue
      const dx = joustDx(sx, o.x)
      const dy = sy - o.y
      near = Math.min(near, dx * dx + dy * dy)
    }
    if (near > bestD) {
      bestD = near
      best = i
    }
  })
  const [sx, sy] = JOUST_SPAWNS[best] as readonly [number, number]
  r.x = sx
  r.y = sy - JOUST.radius
  r.vx = 0
  r.vy = 0
  r.ground = true
  r.downUntil = 0
  r.safeUntil = w.t + JOUST.safeMs
}

// One integration step (JOUST.dtMs): take each rider's command due now (`cmds[i]`, or null), fly
// everyone (gravity, steering, ledges, the lava), then — with `pvp` — settle the collisions.
export function joustStep(w: JoustWorld, cmds: readonly (JoustCmd | null)[], pvp = true): void {
  const t = w.t
  const dt = JOUST.dtMs / 1000
  const ledges = joustLedges(t)
  w.riders.forEach((r, i) => {
    if (r.downUntil > 0 && r.downUntil <= t) respawn(w, r)
    const cmd = cmds[i]
    if (cmd && typeof cmd.steer === 'number')
      r.steer = Math.max(-1, Math.min(1, Math.round(cmd.steer)))
    if (r.downUntil > t) {
      // Out: tumbling down (cosmetic, but the same on every screen).
      r.vy = Math.min(JOUST.maxFall, r.vy + JOUST.gravity * dt)
      r.y += r.vy * dt
      return
    }
    if (cmd?.flap) {
      r.vy = Math.max(-JOUST.maxRise, Math.min(r.vy, 0) - JOUST.flapVy)
      r.ground = false
      r.flapAt = t
    }
    if (r.steer !== 0) r.face = r.steer
    const accel = r.ground ? JOUST.groundAccel : JOUST.airAccel
    const target = r.steer * JOUST.maxVx
    const dv = accel * dt
    if (r.vx < target) r.vx = Math.min(target, r.vx + dv)
    else if (r.vx > target)
      r.vx = Math.max(target, r.vx - (r.steer === 0 && !r.ground ? dv * 0.25 : dv))
    if (!r.ground) r.vy = Math.min(JOUST.maxFall, r.vy + JOUST.gravity * dt)
    const prevFeet = r.y + JOUST.radius
    r.x = wrap(r.x + r.vx * dt)
    r.y += r.vy * dt
    if (r.y < JOUST.radius) {
      r.y = JOUST.radius
      if (r.vy < 0) r.vy = 0
    }
    // Land on a ledge's top (only coming down onto it); walk off its end and you fall.
    const feet = r.y + JOUST.radius
    r.ground = false
    if (r.vy >= 0) {
      for (const l of ledges) {
        const over = joustDx(l.x, r.x)
        const inside = over >= -JOUST.radius * 0.5 && over <= l.w + JOUST.radius * 0.5
        if (inside && prevFeet <= l.y + 0.001 && feet >= l.y) {
          r.y = l.y - JOUST.radius
          r.vy = 0
          r.ground = true
          break
        }
      }
    }
    if (r.y - JOUST.radius > 1) {
      r.score = Math.max(0, r.score - JOUST.lavaCost)
      r.lava += 1
      r.downUntil = t + JOUST.downMs
      r.vy = 0
    }
  })
  w.t = t + JOUST.dtMs
  if (pvp) clashes(w)
}

function clashes(w: JoustWorld): void {
  const t = w.t
  const reach = JOUST.radius * 2
  for (let i = 0; i < w.riders.length; i++) {
    const a = w.riders[i] as JoustRider
    if (!active(a, t) || a.safeUntil > t) continue
    for (let j = i + 1; j < w.riders.length; j++) {
      const b = w.riders[j] as JoustRider
      if (!active(b, t) || b.safeUntil > t || !active(a, t)) continue
      const dx = joustDx(a.x, b.x)
      const dy = b.y - a.y
      if (dx * dx + dy * dy >= reach * reach) continue
      if (Math.abs(dy) <= JOUST.margin) {
        // Level: both bounce apart.
        const away = dx >= 0 ? 1 : -1
        a.vx = -away * JOUST.maxVx
        b.vx = away * JOUST.maxVx
        a.x = wrap(a.x - away * 0.01)
        b.x = wrap(b.x + away * 0.01)
        a.clashes += 1
        b.clashes += 1
        continue
      }
      const [top, low] = dy > 0 ? [a, b] : [b, a]
      top.score += 1
      top.wins += 1
      top.vy = JOUST.bounceVy
      top.ground = false
      low.losses += 1
      low.downUntil = t + JOUST.downMs
      low.vy = -0.2
      low.ground = false
    }
  }
}

// Carries the world forward to `until` (round ms, on the grid), taking each rider's commands (snapped,
// ascending) at their times; several due at one step merge (any flap flaps, the last steer wins).
export function joustRun(
  w: JoustWorld,
  until: number,
  cmds: readonly (readonly JoustCmd[])[],
  pvp = true,
): void {
  const idx = cmds.map(() => 0)
  cmds.forEach((list, r) => {
    while ((idx[r] as number) < list.length && (list[idx[r] as number] as JoustCmd).at < w.t)
      idx[r] = (idx[r] as number) + 1
  })
  const due: (JoustCmd | null)[] = cmds.map(() => null)
  while (w.t < until) {
    for (let r = 0; r < cmds.length; r++) {
      const list = cmds[r] as readonly JoustCmd[]
      let merged = null as JoustCmd | null
      while ((idx[r] as number) < list.length && (list[idx[r] as number] as JoustCmd).at <= w.t) {
        const c = list[idx[r] as number] as JoustCmd
        merged = {
          at: c.at,
          flap: merged?.flap || c.flap,
          steer: typeof c.steer === 'number' ? c.steer : merged?.steer,
        }
        idx[r] = (idx[r] as number) + 1
      }
      due[r] = merged
    }
    joustStep(w, due, pvp)
  }
}

export interface SkyJoustSnapshot {
  // Judged world (riders in `ids` order)...
  world: JoustWorld
  ids: string[]
  // ...and each player's commands already pressed after it (same order).
  cmds: JoustCmd[][]
  // playerId -> the last input `seq` the server has taken.
  acks: Record<string, number>
  // Round time (ms since the round started — GO is at JOUST.startDelayMs) at this snapshot.
  t: number
  // playerId -> score, for the live standings.
  progress: Record<string, number>
  remainingMs: number
}

// Flap and/or steer (−1 left, 0 none, 1 right). `at` = when it was pressed.
export interface SkyJoustInput {
  kind: 'fly'
  flap?: boolean
  steer?: number
  at?: number
  seq?: number
}
