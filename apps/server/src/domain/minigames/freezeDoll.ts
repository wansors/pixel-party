import {
  FREEZE_DOLL_SWEEP,
  type FreezeDollInput,
  type FreezeDollLight,
  type FreezeDollMode,
  type FreezeDollSnapshot,
  type FreezeDollStatus,
  freezeDollMove,
  freezeDollSpeed,
  freezeDollSweepAt,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 50_000
// Runner physics (walk/run speeds, acceleration, glides) live in @pp/shared (FREEZE_DOLL).
const HEARTS = 2
const STUN_MS = 1000
const KNOCKBACK = 0.15
const OPENING_MS = 1200 // a breath before the first chant
const TURN_MS = 500 // the head twitch: the reaction window before the laser starts its sweep
const FIRST_SONG_MIN_MS = 3200
const SUDDEN_FROM_CYCLE = 2 // no sudden spins in the first cycles ("nobody is out in the first seconds")

// One stretch of the doll's timeline. GREEN carries its chant's clock; TURN freezes it (a fake-out
// resumes it afterwards, so a frozen bar never tells a fake from a real spin); RED carries the sweep.
interface Segment {
  light: FreezeDollLight
  from: number
  to: number
  songMs: number
  // GREEN: when the chant (re)started, offset for any fake-out pause. TURN: chant position, frozen.
  songFrom: number
  songFrozen: number
  // RED: the lane the laser sweep starts at, and its direction.
  sweepFrom: number
  dir: 1 | -1
}

interface Runner {
  id: PlayerId
  lane: number
  x: number
  v: number
  mode: FreezeDollMode
  // Deceleration (field lengths / s²) while slowing toward a lower target speed; 0 = not braking.
  brake: number
  hearts: number
  status: FreezeDollStatus
  stunUntil: number
  // At most one hit per RED: set on a hit, cleared when the doll looks away again.
  immune: boolean
  finishAt: number
  outAt: number
}

export interface FreezeDollState {
  runners: Runner[]
  timeline: Segment[]
  seg: number
  startedAt: number
  endsAt: number
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const MODES: readonly FreezeDollMode[] = ['stop', 'walk', 'run']

// Real-time FFA "Red Light, Green Light". Deterministic: lanes and the whole doll timeline (chant
// tempos, fake-outs, sudden spins, RED lengths, where each sweep starts and which way it runs) are
// drawn from the seeded Random at init — the light at any instant is a pure function of time; tick
// integrates movement and judges hits.
export class FreezeDoll implements MiniGame<FreezeDollState, FreezeDollInput> {
  readonly id = 'freeze-doll'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): FreezeDollState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const rng = (): number => ctx.random.next()
    const order = [...ctx.players]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j] as PlayerId, order[i] as PlayerId]
    }
    const runners: Runner[] = order.map((id, lane) => ({
      id,
      lane,
      x: 0,
      v: 0,
      mode: 'stop',
      brake: 0,
      hearts: HEARTS,
      status: 'racing',
      stunUntil: 0,
      immune: false,
      finishAt: 0,
      outAt: 0,
    }))
    const endsAt = ctx.now + durationMs
    return {
      runners,
      timeline: this.buildTimeline(ctx.now, endsAt, runners.length, rng),
      seg: 0,
      startedAt: ctx.now,
      endsAt,
    }
  }

  private buildTimeline(
    start: number,
    endsAt: number,
    lanes: number,
    rng: () => number,
  ): Segment[] {
    const out: Segment[] = []
    const base = { songMs: 0, songFrom: 0, songFrozen: 0, sweepFrom: 0, dir: 1 as const }
    out.push({ ...base, light: 'ready', from: start, to: start + OPENING_MS })
    let t = start + OPENING_MS
    for (let cycle = 0; t < endsAt; cycle++) {
      const p = Math.min(1, (t - start) / Math.max(1, endsAt - start))
      // Chant: shorter as the round goes on, at a seeded tempo.
      const tempo = 0.65 + rng() * 0.65
      let songMs = Math.round(Math.max(1100, Math.min(5200, lerp(4200, 1800, p) * tempo)))
      if (cycle === 0) songMs = Math.max(songMs, FIRST_SONG_MIN_MS)
      // A sudden spin cuts the chant short; a fake-out is a head twitch that looks away again.
      const sudden = cycle >= SUDDEN_FROM_CYCLE && rng() < lerp(0.05, 0.35, p)
      const cutAt = sudden ? Math.round(songMs * (0.45 + rng() * 0.35)) : songMs
      const fakeAt = rng() < lerp(0.15, 0.55, p) ? Math.round(cutAt * (0.25 + rng() * 0.4)) : 0
      const redMs = Math.round(lerp(2600, 1600, p) * (0.8 + rng() * 0.4))
      const sweepFrom = Math.floor(rng() * lanes)
      const dir = rng() < 0.5 ? 1 : -1
      if (fakeAt > 0 && fakeAt + 400 < cutAt) {
        out.push({ ...base, light: 'green', from: t, to: t + fakeAt, songMs, songFrom: t })
        out.push({
          ...base,
          light: 'turn',
          from: t + fakeAt,
          to: t + fakeAt + TURN_MS,
          songMs,
          songFrozen: fakeAt,
        })
        t += TURN_MS
        out.push({ ...base, light: 'green', from: t + fakeAt, to: t + cutAt, songMs, songFrom: t })
      } else {
        out.push({ ...base, light: 'green', from: t, to: t + cutAt, songMs, songFrom: t })
      }
      t += cutAt
      out.push({ ...base, light: 'turn', from: t, to: t + TURN_MS, songMs, songFrozen: cutAt })
      t += TURN_MS
      out.push({ ...base, light: 'red', from: t, to: t + redMs, sweepFrom, dir })
      t += redMs
    }
    return out
  }

  onInput(
    state: FreezeDollState,
    playerId: PlayerId,
    input: FreezeDollInput,
    now: number,
  ): FreezeDollState {
    if (input.kind !== 'move' || now >= state.endsAt) return state
    if (!MODES.includes(input.mode)) return state
    const r = state.runners.find((x) => x.id === playerId)
    if (r) r.mode = input.mode
    return state
  }

  tick(state: FreezeDollState, dt: number, now: number): FreezeDollState {
    const step = dt / 1000
    const seg = this.segmentAt(state, now)
    const lanes = state.runners.length
    for (const r of state.runners) {
      if (r.status === 'finished' || r.status === 'out') continue
      if (seg.light === 'green') r.immune = false
      if (r.status === 'stunned' && now >= r.stunUntil) r.status = 'racing'
      const target = r.status === 'racing' && seg.light !== 'ready' ? freezeDollSpeed(r.mode) : 0
      freezeDollMove(r, target, step)
      if (r.x >= 1) {
        r.x = 1
        r.v = 0
        r.status = 'finished'
        r.finishAt = now
        continue
      }
      // The laser: once the sweep has reached this lane, anything still moving gets hit.
      if (seg.light === 'red' && !r.immune && r.v > 0 && now >= this.judgeAt(seg, r.lane, lanes)) {
        this.hit(r, now)
      }
    }
    return state
  }

  private hit(r: Runner, now: number): void {
    r.hearts -= 1
    r.v = 0
    r.brake = 0
    r.immune = true
    if (r.hearts <= 0) {
      r.status = 'out'
      r.outAt = now
      return
    }
    r.status = 'stunned'
    r.stunUntil = now + STUN_MS
    r.x = Math.max(0, r.x - KNOCKBACK)
  }

  // When the sweep reaches `lane` in a RED segment.
  private judgeAt(seg: Segment, lane: number, lanes: number): number {
    const frac = freezeDollSweepAt(lane, lanes, seg.sweepFrom, seg.dir)
    return seg.from + FREEZE_DOLL_SWEEP.delayMs + frac * FREEZE_DOLL_SWEEP.ms
  }

  // The segment covering `now`. Time only moves forward in a round, so a cursor makes this O(1); it
  // also walks back for an earlier `now` (never wrong, just not the fast path).
  private segmentAt(state: FreezeDollState, now: number): Segment {
    const tl = state.timeline
    while (state.seg > 0 && now < (tl[state.seg] as Segment).from) state.seg--
    while (state.seg < tl.length - 1 && now >= (tl[state.seg] as Segment).to) state.seg++
    return tl[state.seg] as Segment
  }

  // A runner gone from the room is out of the race, so the field still racing can end the round early.
  leave(state: FreezeDollState, playerId: PlayerId, now: number): FreezeDollState {
    const r = state.runners.find((x) => x.id === playerId)
    if (r && (r.status === 'racing' || r.status === 'stunned')) {
      r.status = 'out'
      r.v = 0
      r.outAt = now
    }
    return state
  }

  isFinished(state: FreezeDollState, now: number): boolean {
    if (now >= state.endsAt) return true
    const left = state.runners.filter((r) => r.status === 'racing' || r.status === 'stunned').length
    // Once at most one runner is still in the race nothing can change the order (finishers rank
    // ahead of them, the eliminated behind) — unless they are the only player.
    return left === 0 || (state.runners.length > 1 && left <= 1)
  }

  getResult(state: FreezeDollState): NormalizedResult {
    // Finishers by time, then runners still in it by distance, then the eliminated, last out first.
    const group = (r: Runner): number => (r.status === 'finished' ? 0 : r.status === 'out' ? 2 : 1)
    const key = (r: Runner): number =>
      r.status === 'finished' ? r.finishAt : r.status === 'out' ? -r.outAt - r.x : -r.x
    const sorted = [...state.runners].sort((a, b) => group(a) - group(b) || key(a) - key(b))
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((r, i) => {
      const prev = sorted[i - 1]
      const tied = prev && group(prev) === group(r) && key(prev) === key(r)
      ranks[r.id] = tied && prev ? (ranks[prev.id] ?? i) : i
      stats[r.id] =
        r.status === 'finished'
          ? `${((r.finishAt - state.startedAt) / 1000).toFixed(1)}s`
          : `${Math.round(r.x * 100)}%`
    })
    return { placements: sorted.map((r) => r.id), ranks, stats }
  }

  snapshot(state: FreezeDollState, now: number): FreezeDollSnapshot {
    const seg = this.segmentAt(state, now)
    return {
      light: seg.light,
      songMs: seg.songMs,
      songElapsedMs:
        seg.light === 'green'
          ? Math.min(seg.songMs, now - seg.songFrom)
          : seg.light === 'turn'
            ? seg.songFrozen
            : 0,
      redElapsedMs: seg.light === 'red' ? now - seg.from : 0,
      sweepFrom: seg.sweepFrom,
      sweepDir: seg.dir,
      lanes: state.runners.length,
      runners: state.runners.map((r) => ({
        id: r.id,
        lane: r.lane,
        x: r.x,
        v: r.v,
        hearts: r.hearts,
        status: r.status,
      })),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
