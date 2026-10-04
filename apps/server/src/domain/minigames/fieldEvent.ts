import type { FieldAthlete, FieldEventInput, FieldEventSnapshot, FieldPhase } from '@pp/shared'
import { coast, createRunner, isFoot, type Runner, rankSorted, stride } from './athleticsCore'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 45_000
export const ATTEMPTS = 3
export const READY_MS = 1200
export const MARK_MS = 1700
// A run-up that never reaches the board (or never takes off) is called a foul after this long.
export const RUN_TIMEOUT_MS = 9000
// Holding JUMP/THROW raises the launch angle at this rate up to MAX_ANGLE, which auto-releases.
export const ANGLE_RATE = 110 // degrees per second (45° after ~0.41 s)
export const MAX_ANGLE = 85
const G = 9.81

interface Athlete {
  runner: Runner
  attempt: number
  phase: FieldPhase
  phaseAt: number
  takeoffX: number
  takeoffV: number
  angle: number
  landX: number | null
  marks: (number | null)[]
}

export interface FieldEventSpec {
  // Runway length up to the take-off board / throwing arc (metres).
  foulLine: number
  // Scales projectile range (v² sin 2θ / g) into the event's distances.
  reach: number
  // How long the jump / throw flight is shown before the mark is revealed.
  flightMs: number
}

export interface FieldEventState {
  players: PlayerId[]
  athletes: Map<PlayerId, Athlete>
  spec: FieldEventSpec
  startedAt: number
  endsAt: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

// Run-up-and-launch engine shared by the long jump and the javelin (FFA, real-time). Every athlete
// takes their own three attempts in parallel: READY → RUN (alternate taps build speed) → AIM (hold at
// the board: the angle climbs) → FLIGHT → MARK. Taking off past the board, or running through it, is a
// foul. The mark is measured from the board, so an early take-off wastes distance. Pure physics, no
// randomness; ranked by best mark.
abstract class FieldEvent implements MiniGame<FieldEventState, FieldEventInput> {
  abstract readonly id: string
  readonly format = 'ffa' as const
  protected abstract readonly spec: FieldEventSpec

  init(ctx: MiniGameInitCtx): FieldEventState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const athletes = new Map<PlayerId, Athlete>()
    for (const pid of ctx.players) {
      athletes.set(pid, {
        runner: createRunner(),
        attempt: 0,
        phase: 'ready',
        phaseAt: ctx.now,
        takeoffX: 0,
        takeoffV: 0,
        angle: 0,
        landX: null,
        marks: [],
      })
    }
    return {
      players: [...ctx.players],
      athletes,
      spec: { ...this.spec },
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(
    state: FieldEventState,
    playerId: PlayerId,
    input: FieldEventInput,
    now: number,
  ): FieldEventState {
    const a = state.athletes.get(playerId)
    if (!a || now >= state.endsAt) return state
    if (input.kind === 'step') {
      if (a.phase === 'run' && isFoot(input.foot)) stride(a.runner, input.foot, now)
    } else if (input.kind === 'jump') {
      if (input.down === true && a.phase === 'run') {
        a.takeoffX = a.runner.x
        a.takeoffV = a.runner.v
        this.enter(a, 'aim', now)
      } else if (input.down === false && a.phase === 'aim') {
        this.release(state, a, now)
      }
    }
    return state
  }

  private enter(a: Athlete, phase: FieldPhase, now: number): void {
    a.phase = phase
    a.phaseAt = now
  }

  // Launch: the angle is however long JUMP was held; the range is plain projectile motion scaled to
  // the event, measured from the foul line.
  private release(state: FieldEventState, a: Athlete, now: number): void {
    a.angle = Math.min(MAX_ANGLE, ((now - a.phaseAt) / 1000) * ANGLE_RATE)
    const range =
      (state.spec.reach * a.takeoffV * a.takeoffV * Math.sin((2 * a.angle * Math.PI) / 180)) / G
    a.landX = a.takeoffX + range
    a.marks.push(round2(Math.max(0, a.landX - state.spec.foulLine)))
    this.enter(a, 'flight', now)
  }

  private foul(a: Athlete, now: number): void {
    a.landX = null
    a.marks.push(null)
    a.runner.v = 0
    this.enter(a, 'mark', now)
  }

  tick(state: FieldEventState, dt: number, now: number): FieldEventState {
    for (const pid of state.players) {
      const a = state.athletes.get(pid)
      if (!a) continue
      const inPhase = now - a.phaseAt
      switch (a.phase) {
        case 'ready':
          if (inPhase >= READY_MS) {
            a.runner = createRunner()
            a.takeoffX = 0
            a.takeoffV = 0
            a.angle = 0
            a.landX = null
            this.enter(a, 'run', now)
          }
          break
        case 'run':
          coast(a.runner, dt)
          if (a.runner.x > state.spec.foulLine || inPhase >= RUN_TIMEOUT_MS) this.foul(a, now)
          break
        case 'aim':
          if ((inPhase / 1000) * ANGLE_RATE >= MAX_ANGLE) this.release(state, a, now)
          break
        case 'flight':
          if (inPhase >= state.spec.flightMs) this.enter(a, 'mark', now)
          break
        case 'mark':
          if (inPhase >= MARK_MS) {
            a.attempt++
            this.enter(a, a.attempt >= ATTEMPTS ? 'done' : 'ready', now)
          }
          break
        case 'done':
          break
      }
    }
    return state
  }

  // An athlete who left is done: their marks so far stand, their remaining attempts don't hold the
  // round open.
  leave(state: FieldEventState, playerId: PlayerId, now: number): FieldEventState {
    const a = state.athletes.get(playerId)
    if (a && a.phase !== 'done') this.enter(a, 'done', now)
    return state
  }

  isFinished(state: FieldEventState, now: number): boolean {
    if (now >= state.endsAt) return true
    return state.players.every((p) => state.athletes.get(p)?.phase === 'done')
  }

  private best(state: FieldEventState, pid: PlayerId): number | null {
    const marks = (state.athletes.get(pid)?.marks ?? []).filter((m): m is number => m !== null)
    return marks.length > 0 ? Math.max(...marks) : null
  }

  getResult(state: FieldEventState): NormalizedResult {
    const key = (id: PlayerId): number => -(this.best(state, id) ?? -1)
    const sorted = [...state.players].sort((a, b) => key(a) - key(b))
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) {
      const best = this.best(state, id)
      stats[id] = best !== null ? `${best.toFixed(2)}m` : 'NM'
    }
    return { placements: sorted, ranks: rankSorted(sorted, key), stats }
  }

  snapshot(state: FieldEventState, now: number): FieldEventSnapshot {
    const athletes: FieldAthlete[] = state.players.map((id) => {
      const a = state.athletes.get(id) as Athlete
      return {
        id,
        phase: a.phase,
        phaseMs: Math.max(0, now - a.phaseAt),
        attempt: a.attempt,
        x: round2(a.runner.x),
        v: round2(a.runner.v),
        takeoffX: round2(a.takeoffX),
        angle: Math.round(a.angle * 10) / 10,
        landX: a.landX === null ? null : round2(a.landX),
        marks: [...a.marks],
        best: this.best(state, id),
      }
    })
    return {
      foulLine: state.spec.foulLine,
      attempts: ATTEMPTS,
      readyMs: READY_MS,
      flightMs: state.spec.flightMs,
      markMs: MARK_MS,
      angleRate: ANGLE_RATE,
      maxAngle: MAX_ANGLE,
      athletes,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}

// Long jump: a 30 m runway into the sand; ~8 m for a sharp run-up and a 45° take-off.
export class LongJump extends FieldEvent {
  readonly id = 'long-jump'
  protected readonly spec: FieldEventSpec = { foulLine: 30, reach: 0.78, flightMs: 1100 }
}

// Javelin: a 28 m run-up to the arc; ~80 m for a sharp run-up and a 45° release.
export class JavelinThrow extends FieldEvent {
  readonly id = 'javelin-throw'
  protected readonly spec: FieldEventSpec = { foulLine: 28, reach: 8, flightMs: 1900 }
}
