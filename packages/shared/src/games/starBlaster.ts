// Star Blaster wire shapes + the shared, deterministic attack script. A real-time FFA vertical shmup:
// every player flies their own ship in their own viewport against the SAME seeded waves — drones in
// formation, gunners that hover and spray bullet patterns, and a boss near the end. From your first
// steer on, the ship fires on its own; you steer to aim and to dodge. A hit costs a life (and a few
// points); out of lives you're out.
// Ranked by score.
//
// Enemies and their bullet patterns are a pure function of (seed, time): both apps build the same script
// with `buildStarScript(seed)` and evaluate it, so the wire only carries what differs per player — the
// ship, the score, which enemies that player has destroyed (an enemy shoots only while it's alive) and
// which bullets hit them. World units: the viewport is STAR.w × STAR.h, y grows downward.

export const STAR = {
  w: 1,
  h: 1.3,
  // A bullet-hell hitbox: the ship's sprite is bigger than the bit that can actually be hit.
  shipR: 0.018,
  shipSpeed: 0.85,
  shotEveryMs: 150,
  shotSpeed: 1.9,
  shotR: 0.012,
  bulletR: 0.012,
  lives: 3,
  shieldMs: 2000,
  hitPenalty: 25,
  // A bullet lives this long at most (it is usually off-screen well before).
  bulletLifeMs: 4500,
} as const

export type StarEnemyKind = 'drone' | 'gunner' | 'boss'

export const STAR_ENEMY: Readonly<Record<StarEnemyKind, { r: number; hp: number; pts: number }>> = {
  drone: { r: 0.034, hp: 1, pts: 10 },
  gunner: { r: 0.052, hp: 5, pts: 50 },
  boss: { r: 0.12, hp: 60, pts: 400 },
}

type Path =
  // Drones descend (straight, diagonally or swaying) and, past `turnY`, veer off to the `side` they're
  // closer to — the bottom of the screen, where the ship flies, is bullets territory, not ramming.
  | { type: 'line'; x0: number; vx: number; vy: number; turnY: number; side: 1 | -1 }
  | { type: 'sine'; x0: number; vy: number; amp: number; freq: number; turnY: number; side: 1 | -1 }
  | { type: 'hover'; x0: number; yStop: number; amp: number; freq: number; stayMs: number }

export type StarPattern = 'down' | 'ring' | 'fan' | 'spiral'

export interface StarEnemy {
  id: number
  kind: StarEnemyKind
  spawnAt: number
  // Leaves the screen (or the fight) at this time; never present after it.
  endAt: number
  path: Path
  // Bullet emissions: absolute times + the pattern fired at each.
  shots: number[]
  pattern: StarPattern
  count: number
  speed: number
}

export interface StarScript {
  enemies: StarEnemy[]
}

export interface StarBullet {
  // `${enemyId}:${shotIndex}:${bulletIndex}` — stable, so a bullet that hit a ship can be dropped.
  id: string
  x: number
  y: number
}

// Seeded generator (mulberry32) for the script — deterministic across both apps.
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ENTER_MS = 900
const EXIT_MS = 900
const VEER = 0.9 // sideways acceleration of a drone veering off (world units / s²)

// Where an enemy is `t` ms into the round (null when it isn't on screen).
export function starEnemyAt(e: StarEnemy, t: number): { x: number; y: number } | null {
  if (t < e.spawnAt || t >= e.endAt) return null
  const s = (t - e.spawnAt) / 1000
  const p = e.path
  if (p.type === 'line' || p.type === 'sine') {
    const turn = (p.turnY + 0.06) / p.vy
    const sway = (u: number): number =>
      p.type === 'sine' ? p.x0 + p.amp * Math.sin(u * p.freq) : p.x0 + p.vx * u
    if (s <= turn) return { x: sway(s), y: -0.06 + p.vy * s }
    const k = s - turn
    const x = sway(turn) + p.side * VEER * k * k
    if (x < -0.1 || x > STAR.w + 0.1) return null
    return { x, y: p.turnY + p.vy * 0.45 * k }
  }
  // hover: glide in, sway in place, then pull back up and out.
  const ms = t - e.spawnAt
  const sway = p.x0 + p.amp * Math.sin(s * p.freq)
  if (ms < ENTER_MS) return { x: sway, y: -0.15 + (p.yStop + 0.15) * (ms / ENTER_MS) }
  if (ms < ENTER_MS + p.stayMs) return { x: sway, y: p.yStop }
  const out = Math.min(1, (ms - ENTER_MS - p.stayMs) / EXIT_MS)
  return { x: sway, y: p.yStop - (p.yStop + 0.2) * out }
}

// Direction (radians, 0 = right, π/2 = down) of bullet `j` in emission `k` of an enemy.
function bulletAngle(e: StarEnemy, k: number, j: number): number {
  const n = e.count
  switch (e.pattern) {
    case 'down':
      return Math.PI / 2
    case 'fan':
      return Math.PI / 2 + (n > 1 ? (j / (n - 1) - 0.5) * 1.3 : 0)
    case 'ring':
      return (j / n) * Math.PI * 2 + k * 0.33
    case 'spiral':
      return (j / n) * Math.PI * 2 + k * 0.55
  }
}

// Every enemy bullet in flight at `t` for one player: emissions only happen while that enemy is alive
// for them (`killedAt`), and bullets in `consumed` (they hit that player) are gone.
export function starBulletsAt(
  script: StarScript,
  t: number,
  killedAt: ReadonlyMap<number, number>,
  consumed?: ReadonlySet<string>,
): StarBullet[] {
  const out: StarBullet[] = []
  for (const e of script.enemies) {
    if (e.shots.length === 0 || e.spawnAt > t || e.endAt + STAR.bulletLifeMs < t) continue
    const dead = killedAt.get(e.id) ?? Number.POSITIVE_INFINITY
    e.shots.forEach((at, k) => {
      if (at > t || at >= dead || t - at > STAR.bulletLifeMs) return
      const from = starEnemyAt(e, at)
      if (!from) return
      const d = (e.speed * (t - at)) / 1000
      for (let j = 0; j < e.count; j++) {
        const id = `${e.id}:${k}:${j}`
        if (consumed?.has(id)) continue
        const a = bulletAngle(e, k, j)
        const x = from.x + Math.cos(a) * d
        const y = from.y + Math.sin(a) * d
        if (x < -0.05 || x > STAR.w + 0.05 || y < -0.1 || y > STAR.h + 0.05) continue
        out.push({ id, x, y })
      }
    })
  }
  return out
}

// The round's attack script: formations of drones every couple of seconds, a gunner every ~6 s that
// hovers and sprays a pattern, a boss for the last stretch. Denser as the round goes on.
export function buildStarScript(seed: number, durationMs: number): StarScript {
  const rng = mulberry32(seed)
  const enemies: StarEnemy[] = []
  let id = 0
  const add = (e: Omit<StarEnemy, 'id'>): void => {
    enemies.push({ ...e, id: id++ })
  }
  const bossAt = Math.max(8000, durationMs - 16_000)
  // Drone formations.
  for (let t = 1500; t < bossAt; ) {
    const p = t / bossAt
    const n = 4 + Math.floor(rng() * 3)
    const kind = rng()
    const x0 = 0.15 + rng() * 0.7
    const vy = 0.32 + p * 0.18 + rng() * 0.06
    const turnY = STAR.h * (0.5 + rng() * 0.15)
    // Down to the turn, then at most ~1.6 s veering out of the side.
    const lifeMs = Math.round(((turnY + 0.06) / vy) * 1000 + 1600)
    for (let i = 0; i < n; i++) {
      const at = t + i * 260
      const shooter = rng() < 0.1 + p * 0.2
      const path: Path =
        kind < 0.4
          ? {
              type: 'sine',
              x0,
              vy,
              amp: 0.18 + rng() * 0.1,
              freq: 2.2,
              turnY,
              side: x0 < 0.5 ? -1 : 1,
            }
          : kind < 0.7
            ? {
                type: 'line',
                x0: 0.1 + ((i + 0.5) / n) * 0.8,
                vx: 0,
                vy,
                turnY,
                side: (i + 0.5) / n < 0.5 ? -1 : 1,
              }
            : {
                type: 'line',
                x0: x0 < 0.5 ? 0.05 : 0.95,
                vx: (x0 < 0.5 ? 1 : -1) * 0.22,
                vy,
                turnY,
                side: x0 < 0.5 ? 1 : -1,
              }
      const first = at + 700 + Math.round(rng() * 600)
      add({
        kind: 'drone',
        spawnAt: at,
        endAt: at + lifeMs,
        path,
        shots: shooter ? [first, first + 1500] : [],
        pattern: 'down',
        count: 1,
        speed: 0.4,
      })
    }
    t += Math.round(2600 - p * 900 + rng() * 600)
  }
  // Gunners.
  for (let t = 5000; t < bossAt - 2000; t += Math.round(5600 + rng() * 1800)) {
    const stayMs = 4800
    const pattern: StarPattern = rng() < 0.5 ? 'ring' : 'fan'
    const shots: number[] = []
    for (let s = t + ENTER_MS + 300; s < t + ENTER_MS + stayMs; s += 1600) shots.push(s)
    add({
      kind: 'gunner',
      spawnAt: t,
      endAt: t + ENTER_MS + stayMs + EXIT_MS,
      path: {
        type: 'hover',
        x0: 0.2 + rng() * 0.6,
        yStop: 0.22 + rng() * 0.12,
        amp: 0.12,
        freq: 1.1,
        stayMs,
      },
      shots,
      pattern,
      count: pattern === 'ring' ? 8 : 5,
      speed: 0.34,
    })
  }
  // The boss: a long hover spraying spirals.
  const stayMs = Math.max(4000, durationMs - bossAt - ENTER_MS - 400)
  const bossShots: number[] = []
  for (let s = bossAt + ENTER_MS + 400; s < bossAt + ENTER_MS + stayMs; s += 650) bossShots.push(s)
  add({
    kind: 'boss',
    spawnAt: bossAt,
    endAt: bossAt + ENTER_MS + stayMs + EXIT_MS,
    path: { type: 'hover', x0: 0.5, yStop: 0.24, amp: 0.25, freq: 0.7, stayMs },
    shots: bossShots,
    pattern: 'spiral',
    count: 4,
    speed: 0.3,
  })
  return { enemies }
}

export interface StarArena {
  id: string
  x: number
  y: number
  lives: number
  shielded: boolean
  score: number
  out: boolean
  // Guns online: the player has steered at least once (until then the ship doesn't fire).
  armed: boolean
  // Enemies this player destroyed (only the ones that still matter on screen): [enemyId, atMs].
  killed: [number, number][]
  // Damaged enemies still alive for this player: [enemyId, hpLeft].
  hp: [number, number][]
  // Enemy bullets that hit this player (gone from their screen).
  consumed: string[]
}

export interface StarBlasterSnapshot {
  seed: number
  durationMs: number
  // Round time (ms since start) this snapshot was taken at.
  t: number
  arenas: StarArena[]
  remainingMs: number
}

// Steer with a direction vector (normalized server-side; {0,0} = hold position). The first steer arms
// the guns; from then on the ship fires itself.
export interface StarBlasterInput {
  kind: 'move'
  dx: number
  dy: number
}
