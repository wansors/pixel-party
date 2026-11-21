import {
  rampEase,
  SHOOT,
  SHOOT_PACE,
  SHOOT_SPOTS,
  type ShootHole,
  type ShootInput,
  type ShootKind,
  type ShootPlayerView,
  type ShootSnapshot,
  type ShootTarget,
  shootHit,
  shootProgress,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 45_000
const FIRST_MS = 700
// Cans only start flying once everyone has warmed up.
const CANS_FROM_MS = 12_000
const CAN_CHANCE = 0.2
const BOTTLE_CHANCE = 0.24
// How far ahead / behind the snapshot lists targets (so they enter and leave smoothly).
const SHOW_AHEAD_MS = 1200
const SHOW_AFTER_MS = 400
const HOLE_MS = 1500

interface Shooter {
  score: number
  ammo: number
  // When the reload in progress ends (ms after GO; 0 = not reloading).
  reloadUntil: number
  lastShot: number
  shots: number
  hits: number
  // Targets this player already hit (each target counts once per player).
  done: Set<number>
}

export interface SharpshooterState {
  players: PlayerId[]
  shooters: Map<PlayerId, Shooter>
  targets: ShootTarget[]
  holes: ShootHole[]
  startedAt: number
  endsAt: number
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Sharpshooter (D45): a real-time FFA Wild West shooting gallery. One seeded schedule of targets for
// everyone — bandits and civilians popping up in windows and doors, bottles on the fence, tossed cans
// — and every player may hit each target once (no stealing). A shot carries where the crosshair was
// (the breathing sway is applied on the client) and when (ms after GO on the client's estimate of the
// server clock, accepted up to SHOOT.lateMs late); the server checks the six-shooter's ammo, the
// hammer's cadence and the reload, then judges the hit against the target's position at that moment
// (shootHit, shared). Most points wins; accuracy breaks ties. Targets come faster, stay shorter and
// civilians crowd in as the round goes on (D40).
export class Sharpshooter implements MiniGame<SharpshooterState, ShootInput> {
  readonly id = 'sharpshooter'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SharpshooterState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const r = ctx.random
    const lastAt = durationMs - SHOOT.startDelayMs - 900
    const busy = SHOOT_SPOTS.map(() => 0)
    const targets: ShootTarget[] = []
    for (let t = FIRST_MS; t < lastAt; ) {
      const p = shootProgress(t)
      const roll = r.next()
      const id = targets.length
      if (t >= CANS_FROM_MS && roll < CAN_CHANCE) {
        const ltr = r.next() < 0.5
        targets.push({
          id,
          kind: 'can',
          spot: -1,
          at: t,
          stay: Math.round(rampEase(SHOOT_PACE.canStay[0], SHOOT_PACE.canStay[1], p, 2)),
          x0: ltr ? -0.05 : SHOOT.w + 0.05,
          x1: ltr ? SHOOT.w * (0.55 + r.next() * 0.4) : SHOOT.w * (0.05 + r.next() * 0.4),
          peak: 0.42 + r.next() * 0.3,
        })
      } else {
        const bottle = roll < CAN_CHANCE + BOTTLE_CHANCE
        const free = SHOOT_SPOTS.flatMap((s, i) =>
          (bottle ? s.kind === 'fence' : s.kind !== 'fence') && (busy[i] as number) <= t ? [i] : [],
        )
        if (free.length > 0) {
          const spot = free[Math.floor(r.next() * free.length)] as number
          const civilian =
            !bottle && r.next() < rampEase(SHOOT_PACE.civilian[0], SHOOT_PACE.civilian[1], p, 2)
          const kind: ShootKind = bottle ? 'bottle' : civilian ? 'civilian' : 'bandit'
          const [a, b] = bottle ? SHOOT_PACE.bottleStay : SHOOT_PACE.popStay
          const stay = Math.round(rampEase(a, b, p, 2) * (0.85 + r.next() * 0.3))
          targets.push({ id, kind, spot, at: t, stay })
          busy[spot] = t + stay + 250
        }
      }
      t += Math.round(
        rampEase(SHOOT_PACE.gap[0], SHOOT_PACE.gap[1], p, 2) * (0.75 + r.next() * 0.5),
      )
    }
    const shooters = new Map<PlayerId, Shooter>(
      ctx.players.map((id) => [
        id,
        {
          score: 0,
          ammo: SHOOT.ammo,
          reloadUntil: 0,
          lastShot: Number.NEGATIVE_INFINITY,
          shots: 0,
          hits: 0,
          done: new Set(),
        },
      ]),
    )
    return {
      players: [...ctx.players],
      shooters,
      targets,
      holes: [],
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  // Ms after GO at server time `now`.
  private live(state: SharpshooterState, now: number): number {
    return Math.min(now, state.endsAt) - state.startedAt - SHOOT.startDelayMs
  }

  // A reload that has run its course refills the cylinder.
  private refresh(s: Shooter, t: number): void {
    if (s.reloadUntil > 0 && t >= s.reloadUntil) {
      s.ammo = SHOOT.ammo
      s.reloadUntil = 0
    }
  }

  onInput(
    state: SharpshooterState,
    playerId: PlayerId,
    input: ShootInput,
    now: number,
  ): SharpshooterState {
    const s = state.shooters.get(playerId)
    const live = this.live(state, now)
    if (!s || live < 0 || now >= state.endsAt) return state
    if (input?.kind === 'reload') {
      this.refresh(s, live)
      if (s.ammo < SHOOT.ammo && s.reloadUntil === 0) s.reloadUntil = live + SHOOT.reloadMs
      return state
    }
    if (input?.kind !== 'shot' || !finite(input.x) || !finite(input.y)) return state
    if (input.x < -0.1 || input.x > SHOOT.w + 0.1 || input.y < -0.1 || input.y > 1.1) return state
    const at = Math.min(live, Math.max(live - SHOOT.lateMs, finite(input.at) ? input.at : live))
    this.refresh(s, at)
    if (s.reloadUntil > at || s.ammo <= 0 || at - s.lastShot < SHOOT.shotGapMs) return state
    s.ammo -= 1
    s.shots += 1
    s.lastShot = at
    if (s.ammo === 0) s.reloadUntil = at + SHOOT.reloadMs
    const hit = shootHit(state.targets, at, input.x, input.y, s.done)
    if (!hit) return state
    s.done.add(hit.id)
    s.score += SHOOT.points[hit.kind]
    if (hit.kind !== 'civilian') s.hits += 1
    state.holes.push({ target: hit.id, player: playerId, x: input.x, y: input.y, at })
    return state
  }

  tick(state: SharpshooterState, _dt: number, now: number): SharpshooterState {
    const live = this.live(state, now)
    if (state.holes.length > 0 && (state.holes[0] as ShootHole).at < live - HOLE_MS) {
      state.holes = state.holes.filter((h) => h.at >= live - HOLE_MS)
    }
    return state
  }

  isFinished(state: SharpshooterState, now: number): boolean {
    return now >= state.endsAt
  }

  private accuracy(s: Shooter | undefined): number {
    return s && s.shots > 0 ? s.hits / s.shots : 0
  }

  private cmp(state: SharpshooterState, a: PlayerId, b: PlayerId): number {
    const sa = state.shooters.get(a)
    const sb = state.shooters.get(b)
    return (sb?.score ?? 0) - (sa?.score ?? 0) || this.accuracy(sb) - this.accuracy(sa)
  }

  getResult(state: SharpshooterState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.shooters.get(id)?.score ?? 0} pts`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: SharpshooterState, now: number): ShootSnapshot {
    const live = this.live(state, now)
    const players: Record<PlayerId, ShootPlayerView> = {}
    const scores: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const s = state.shooters.get(id) as Shooter
      this.refresh(s, live)
      players[id] = {
        score: s.score,
        ammo: s.ammo,
        reloadMs: Math.max(0, s.reloadUntil - live),
        shots: s.shots,
        hits: s.hits,
      }
      scores[id] = s.score
    }
    return {
      targets: state.targets.filter(
        (tg) => tg.at - SHOW_AHEAD_MS <= live && tg.at + tg.stay + SHOW_AFTER_MS >= live,
      ),
      players,
      holes: state.holes.filter((h) => h.at >= live - HOLE_MS),
      t: now - state.startedAt,
      scores,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
