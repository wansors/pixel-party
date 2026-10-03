import {
  STAR,
  STAR_ENEMY,
  type StarBlasterInput,
  type StarBlasterSnapshot,
  type StarScript,
  buildStarScript,
  starBulletsAt,
  starEnemyAt,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 50_000
const SHIP_MIN_Y = STAR.h * 0.35 // the ship keeps to the lower part of the screen
// Killed enemies stay on the wire only while they (or their bullets) could still be on screen.
const KILL_MEMORY_MS = STAR.bulletLifeMs

interface Shot {
  x: number
  y: number
}

interface Arena {
  id: PlayerId
  x: number
  y: number
  dx: number
  dy: number
  lives: number
  shieldUntil: number
  score: number
  out: boolean
  killedAt: Map<number, number>
  hp: Map<number, number>
  shots: Shot[]
  nextShotAt: number
  consumed: Set<string>
}

export interface StarBlasterState {
  seed: number
  script: StarScript
  arenas: Arena[]
  durationMs: number
  startedAt: number
  endsAt: number
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Real-time FFA vertical shmup. Deterministic: one seed (from the round's Random) builds the shared
// attack script both apps evaluate; per player the server integrates the ship and its auto-fire,
// resolves hits on enemies and on the ship. Ranked by score.
export class StarBlaster implements MiniGame<StarBlasterState, StarBlasterInput> {
  readonly id = 'star-blaster'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): StarBlasterState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const seed = Math.floor(ctx.random.next() * 4294967296) | 0
    return {
      seed,
      script: buildStarScript(seed, durationMs),
      arenas: ctx.players.map((id) => ({
        id,
        x: STAR.w / 2,
        y: STAR.h - 0.12,
        dx: 0,
        dy: 0,
        lives: STAR.lives,
        shieldUntil: 0,
        score: 0,
        out: false,
        killedAt: new Map(),
        hp: new Map(),
        shots: [],
        nextShotAt: 0,
        consumed: new Set(),
      })),
      durationMs,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(
    state: StarBlasterState,
    playerId: PlayerId,
    input: StarBlasterInput,
    now: number,
  ): StarBlasterState {
    if (input.kind !== 'move' || now >= state.endsAt) return state
    const a = state.arenas.find((x) => x.id === playerId)
    if (!a || a.out || !isNum(input.dx) || !isNum(input.dy)) return state
    const mag = Math.hypot(input.dx, input.dy)
    a.dx = mag < 0.001 ? 0 : input.dx / mag
    a.dy = mag < 0.001 ? 0 : input.dy / mag
    return state
  }

  tick(state: StarBlasterState, dt: number, now: number): StarBlasterState {
    const step = dt / 1000
    const t = now - state.startedAt
    for (const a of state.arenas) {
      if (a.out) continue
      a.x = Math.max(STAR.shipR, Math.min(STAR.w - STAR.shipR, a.x + a.dx * STAR.shipSpeed * step))
      a.y = Math.max(SHIP_MIN_Y, Math.min(STAR.h - STAR.shipR, a.y + a.dy * STAR.shipSpeed * step))
      // Auto-fire.
      while (a.nextShotAt <= t) {
        a.shots.push({ x: a.x, y: a.y - 0.03 })
        a.nextShotAt += STAR.shotEveryMs
      }
      this.moveShots(state, a, step, t)
      this.hitShip(state, a, t)
    }
    return state
  }

  // Player shots climb; one that meets a live enemy is spent on it.
  private moveShots(state: StarBlasterState, a: Arena, step: number, t: number): void {
    const live = state.script.enemies.filter(
      (e) => !a.killedAt.has(e.id) && e.spawnAt <= t && e.endAt > t,
    )
    const kept: Shot[] = []
    for (const s of a.shots) {
      s.y -= STAR.shotSpeed * step
      if (s.y < -0.05) continue
      let spent = false
      for (const e of live) {
        if (a.killedAt.has(e.id)) continue
        const p = starEnemyAt(e, t)
        if (!p) continue
        const spec = STAR_ENEMY[e.kind]
        if (Math.hypot(p.x - s.x, p.y - s.y) >= spec.r + STAR.shotR) continue
        spent = true
        const hp = (a.hp.get(e.id) ?? spec.hp) - 1
        if (hp <= 0) {
          a.hp.delete(e.id)
          a.killedAt.set(e.id, t)
          a.score += spec.pts
        } else a.hp.set(e.id, hp)
        break
      }
      if (!spent) kept.push(s)
    }
    a.shots = kept
  }

  // An enemy bullet or an enemy body touching the ship costs a life (unless it's still blinking).
  private hitShip(state: StarBlasterState, a: Arena, t: number): void {
    if (t < a.shieldUntil) return
    const bullet = starBulletsAt(state.script, t, a.killedAt, a.consumed).find(
      (b) => Math.hypot(b.x - a.x, b.y - a.y) < STAR.shipR + STAR.bulletR,
    )
    let rammed = false
    if (!bullet) {
      for (const e of state.script.enemies) {
        if (a.killedAt.has(e.id)) continue
        const p = starEnemyAt(e, t)
        if (!p || Math.hypot(p.x - a.x, p.y - a.y) >= STAR_ENEMY[e.kind].r + STAR.shipR) continue
        // A drone that rams you is destroyed too (no points); bigger ones just shove through.
        if (e.kind === 'drone') a.killedAt.set(e.id, t)
        rammed = true
        break
      }
    }
    if (!bullet && !rammed) return
    if (bullet) a.consumed.add(bullet.id)
    a.lives -= 1
    a.score = Math.max(0, a.score - STAR.hitPenalty)
    a.shieldUntil = t + STAR.shieldMs
    if (a.lives <= 0) {
      a.out = true
      a.shots = []
      a.dx = 0
      a.dy = 0
    }
  }

  isFinished(state: StarBlasterState, now: number): boolean {
    return now >= state.endsAt || state.arenas.every((a) => a.out)
  }

  getResult(state: StarBlasterState): NormalizedResult {
    const cmp = (x: Arena, y: Arena): number => y.score - x.score || y.lives - x.lives
    const sorted = [...state.arenas].sort(cmp)
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((a, i) => {
      const prev = sorted[i - 1]
      ranks[a.id] = prev && cmp(prev, a) === 0 ? (ranks[prev.id] ?? i) : i
      stats[a.id] = `${a.score}`
    })
    return { placements: sorted.map((a) => a.id), ranks, stats }
  }

  snapshot(state: StarBlasterState, now: number): StarBlasterSnapshot {
    const t = now - state.startedAt
    const ends = new Map(state.script.enemies.map((e) => [e.id, e.endAt]))
    return {
      seed: state.seed,
      durationMs: state.durationMs,
      t,
      arenas: state.arenas.map((a) => ({
        id: a.id,
        x: Math.round(a.x * 1000) / 1000,
        y: Math.round(a.y * 1000) / 1000,
        lives: a.lives,
        shielded: t < a.shieldUntil,
        score: a.score,
        out: a.out,
        killed: [...a.killedAt].filter(([id]) => (ends.get(id) ?? 0) + KILL_MEMORY_MS > t),
        hp: [...a.hp],
        consumed: [...a.consumed],
      })),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
