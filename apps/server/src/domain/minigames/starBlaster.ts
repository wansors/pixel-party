import {
  STAR,
  STAR_ENEMY,
  type StarBlasterInput,
  type StarBlasterSnapshot,
  type StarEnemy,
  type StarScript,
  buildStarScript,
  starBulletNear,
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

// An enemy on screen this tick (positions are shared by every arena; kills are per player).
interface LiveEnemy {
  e: StarEnemy
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
  // The guns come online with the player's first steer (an idle seat never fires, never scores).
  armed: boolean
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
// attack script both apps evaluate; per player the server integrates the ship and its auto-fire (from
// the first steer on), resolves hits on enemies and on the ship. Ranked by score.
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
        armed: false,
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
    // Longer than 1 → full speed; shorter → slower (a pointer easing onto its target).
    const mag = Math.hypot(input.dx, input.dy)
    const k = mag < 0.001 ? 0 : 1 / Math.max(1, mag)
    a.dx = input.dx * k
    a.dy = input.dy * k
    if (!a.armed && mag >= 0.001) {
      a.armed = true
      a.nextShotAt = now - state.startedAt
    }
    return state
  }

  tick(state: StarBlasterState, dt: number, now: number): StarBlasterState {
    const step = dt / 1000
    const t = now - state.startedAt
    // Every enemy's position this tick, evaluated once for all twelve arenas.
    const live: LiveEnemy[] = []
    for (const e of state.script.enemies) {
      if (e.spawnAt > t || e.endAt <= t) continue
      const p = starEnemyAt(e, t)
      if (p) live.push({ e, x: p.x, y: p.y })
    }
    for (const a of state.arenas) {
      if (a.out) continue
      a.x = Math.max(STAR.shipR, Math.min(STAR.w - STAR.shipR, a.x + a.dx * STAR.shipSpeed * step))
      a.y = Math.max(SHIP_MIN_Y, Math.min(STAR.h - STAR.shipR, a.y + a.dy * STAR.shipSpeed * step))
      // Auto-fire, once armed.
      while (a.armed && a.nextShotAt <= t) {
        a.shots.push({ x: a.x, y: a.y - 0.03 })
        a.nextShotAt += STAR.shotEveryMs
      }
      this.moveShots(a, live, step, t)
      this.hitShip(state, a, live, t)
    }
    return state
  }

  // Player shots climb; one that meets a live enemy is spent on it.
  private moveShots(a: Arena, live: readonly LiveEnemy[], step: number, t: number): void {
    let kept = 0
    for (const s of a.shots) {
      s.y -= STAR.shotSpeed * step
      if (s.y < -0.05) continue
      let spent = false
      for (const { e, x, y } of live) {
        if (a.killedAt.has(e.id)) continue
        const spec = STAR_ENEMY[e.kind]
        if (Math.hypot(x - s.x, y - s.y) >= spec.r + STAR.shotR) continue
        spent = true
        const hp = (a.hp.get(e.id) ?? spec.hp) - 1
        if (hp <= 0) {
          a.hp.delete(e.id)
          a.killedAt.set(e.id, t)
          a.score += spec.pts
        } else a.hp.set(e.id, hp)
        break
      }
      if (!spent) a.shots[kept++] = s
    }
    a.shots.length = kept
  }

  // An enemy bullet or an enemy body touching the ship costs a life (unless it's still blinking).
  private hitShip(state: StarBlasterState, a: Arena, live: readonly LiveEnemy[], t: number): void {
    if (t < a.shieldUntil) return
    const bullet = starBulletNear(
      state.script,
      t,
      a.killedAt,
      a.consumed,
      a.x,
      a.y,
      STAR.shipR + STAR.bulletR,
    )
    let rammed = false
    if (!bullet) {
      for (const { e, x, y } of live) {
        if (a.killedAt.has(e.id)) continue
        if (Math.hypot(x - a.x, y - a.y) >= STAR_ENEMY[e.kind].r + STAR.shipR) continue
        // A drone that rams you is destroyed too (no points); bigger ones just shove through.
        if (e.kind === 'drone') a.killedAt.set(e.id, t)
        rammed = true
        break
      }
    }
    if (!bullet && !rammed) return
    if (bullet) a.consumed.add(bullet)
    a.lives -= 1
    a.score = Math.max(0, a.score - STAR.hitPenalty)
    a.shieldUntil = t + STAR.shieldMs
    if (a.lives <= 0) this.knockOut(a)
  }

  private knockOut(a: Arena): void {
    a.out = true
    a.shots = []
    a.dx = 0
    a.dy = 0
  }

  // A player who left is out: their ship leaves the fight, so it can't hold the round open.
  leave(state: StarBlasterState, playerId: PlayerId): StarBlasterState {
    const a = state.arenas.find((x) => x.id === playerId)
    if (a) this.knockOut(a)
    return state
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
    // Enemy ids are their index in the script.
    const endOf = (id: number): number => state.script.enemies[id]?.endAt ?? 0
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
        armed: a.armed,
        killed: [...a.killedAt].filter(([id]) => endOf(id) + KILL_MEMORY_MS > t),
        hp: [...a.hp],
        consumed: [...a.consumed],
      })),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
