import {
  SUMO,
  type SumoInput,
  type SumoPhys,
  type SumoSnapshot,
  sumoAim,
  sumoDash,
  sumoStep,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 30_000
export const DASH_COOLDOWN_MS = SUMO.dashCooldownMs
// Wire positions are rounded to this many decimals (a tenth of a pixel on any screen).
const WIRE = 1e4
const round = (v: number): number => Math.round(v * WIRE) / WIRE

interface Body extends SumoPhys {
  outAt: number // ms when eliminated (0 = still in)
  dashAt: number // ms of the last dash (0 = never)
  dashSeq: number // seq of the last dash input taken (acknowledged on the wire)
}

export interface SumoState {
  players: PlayerId[]
  bodies: Map<PlayerId, Body>
  startedAt: number
  endsAt: number
}

// Real-time FFA sumo arena. Deterministic: initial ring positions use one seeded rotation offset, then
// all motion is pure physics driven by `dt`/`now` (no RNG in tick) — the shared `sumoStep`, which the
// client also runs to predict. The ring shrinks over the round and a dash can launch anyone out of it,
// so holding the centre isn't a lock. Ranked by survival time.
export class Sumo implements MiniGame<SumoState, SumoInput> {
  readonly id = 'sumo-push'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): SumoState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const n = ctx.players.length
    const offset = ctx.random.next() * Math.PI * 2
    const bodies = new Map<PlayerId, Body>()
    ctx.players.forEach((pid, i) => {
      const angle = offset + (i / Math.max(1, n)) * Math.PI * 2
      bodies.set(pid, {
        x: SUMO.center + Math.cos(angle) * SUMO.spawnR,
        y: SUMO.center + Math.sin(angle) * SUMO.spawnR,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        alive: true,
        outAt: 0,
        dashAt: 0,
        dashSeq: 0,
      })
    })
    return { players: [...ctx.players], bodies, startedAt: ctx.now, endsAt: ctx.now + durationMs }
  }

  // The ring's radius at `now`.
  ringAt(state: SumoState, now: number): number {
    const span = state.endsAt - state.startedAt
    const progress = span > 0 ? (now - state.startedAt) / span : 0
    const shrink = Math.max(0, Math.min(1, (progress - SUMO.shrinkFrom) / (1 - SUMO.shrinkFrom)))
    return SUMO.ringR + (SUMO.ringEnd - SUMO.ringR) * shrink
  }

  onInput(state: SumoState, playerId: PlayerId, input: SumoInput, now: number): SumoState {
    if (now < state.startedAt || now >= state.endsAt) return state
    const body = state.bodies.get(playerId)
    if (!body || !body.alive) return state
    if (input?.kind === 'dash') return this.dash(state, body, now, input.seq)
    if (input?.kind !== 'move') return state
    const { dx, dy } = input
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx + dy)) return state
    const { ax, ay } = sumoAim(dx, dy)
    body.ax = ax
    body.ay = ay
    return state
  }

  // Launch toward where the player is pushing, cooldown permitting (no push direction, no dash). The
  // seq is taken either way, so the client stops predicting a dash the server refused.
  private dash(state: SumoState, body: Body, now: number, seq: unknown): SumoState {
    if (Number.isInteger(seq) && (seq as number) > body.dashSeq) body.dashSeq = seq as number
    if (body.dashAt > 0 && now - body.dashAt < DASH_COOLDOWN_MS) return state
    if (sumoDash(body)) body.dashAt = now
    return state
  }

  tick(state: SumoState, dt: number, now: number): SumoState {
    const live = state.players.map((p) => state.bodies.get(p)).filter((b): b is Body => !!b?.alive)
    sumoStep(live, dt)
    // Ring eliminations.
    const ring = this.ringAt(state, now)
    for (const b of live) {
      if (Math.hypot(b.x - SUMO.center, b.y - SUMO.center) > ring) {
        b.alive = false
        b.outAt = now
      }
    }
    return state
  }

  // A wrestler whose player is gone steps out of the ring: the bout carries on without a statue in it.
  leave(state: SumoState, playerId: PlayerId, now: number): SumoState {
    const body = state.bodies.get(playerId)
    if (body?.alive) {
      body.alive = false
      body.outAt = now
    }
    return state
  }

  isFinished(state: SumoState, now: number): boolean {
    const alive = state.players.filter((p) => state.bodies.get(p)?.alive).length
    return now >= state.endsAt || alive <= 1
  }

  private survival(state: SumoState, pid: PlayerId): number {
    const b = state.bodies.get(pid)
    if (!b) return 0
    return (b.alive ? state.endsAt : b.outAt) - state.startedAt
  }

  getResult(state: SumoState): NormalizedResult {
    const sorted = [...state.players].sort(
      (x, y) => this.survival(state, y) - this.survival(state, x),
    )
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    let prev: number | undefined
    sorted.forEach((id, idx) => {
      const v = this.survival(state, id)
      if (idx > 0 && v !== prev) rank = idx
      ranks[id] = rank
      prev = v
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${Math.round(this.survival(state, id) / 1000)}s`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: SumoState, now: number): SumoSnapshot {
    const bodies = state.players.map((pid) => {
      const b = state.bodies.get(pid) as Body
      return {
        id: pid,
        x: round(b.x),
        y: round(b.y),
        vx: round(b.vx),
        vy: round(b.vy),
        ax: round(b.ax),
        ay: round(b.ay),
        alive: b.alive,
        dashing: b.dashAt > 0 && now - b.dashAt < SUMO.dashMs,
        dash: b.dashSeq,
      }
    })
    return {
      ring: round(this.ringAt(state, now)),
      bodies,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
