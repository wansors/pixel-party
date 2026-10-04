import {
  BOMBER,
  BOMBER_DIRS,
  type BomberDir,
  type BomberInput,
  type BomberSnapshot,
  bomberStepDir,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
const W = BOMBER.w
const H = BOMBER.h
// Twelve starting cells with their neighbours kept clear of crates (corners, mid-edges, inner ring),
// in fill order: a room of N uses the first N, so small rooms stay spread out. The pairs mirror through
// the centre cell (8, 6).
const SPAWNS: readonly (readonly [number, number])[] = [
  [1, 1],
  [15, 11],
  [15, 1],
  [1, 11],
  [7, 1],
  [9, 11],
  [1, 5],
  [15, 7],
  [5, 7],
  [11, 5],
  [5, 3],
  [11, 9],
]
const CRATE_DENSITY = 0.6
const DROP_CHANCE = 0.32
const DIRS = BOMBER_DIRS
const isDir = (d: unknown): d is BomberDir => typeof d === 'string' && d in DIRS

interface Player {
  id: PlayerId
  idx: number
  x: number
  y: number
  tx: number
  ty: number
  stepStart: number
  stepEnd: number
  dir: BomberDir | null
  // The direction held before `dir`: taken when `dir` is blocked (an early turn press keeps you going).
  alt: BomberDir | null
  alive: boolean
  range: number
  maxBombs: number
  speed: number
  kos: number
  outAt: number
  // Crates this player's blasts broke: the last tiebreak (an all-survivor timeout ranks the busier one up).
  crates: number
  left: boolean
}

interface Bomb {
  x: number
  y: number
  explodeAt: number
  owner: number
  range: number
}

export interface BomberState {
  cells: string[]
  // Hidden power-up under some crates (cell index → 'r' | 'b' | 's').
  drops: Map<number, string>
  players: Player[]
  bombs: Bomb[]
  flames: Map<number, { until: number; owner: number }>
  startedAt: number
  endsAt: number
}

const at = (x: number, y: number): number => y * W + x
const isPower = (c: string | undefined): boolean => c === 'r' || c === 'b' || c === 's'

// Real-time FFA Bomberman. Deterministic: who starts on which spawn cell, the crate scatter and the
// power-up hidden in each crate are drawn from the seeded Random at init; the rest is driven by inputs
// and time.
export class BomberExpress implements MiniGame<BomberState, BomberInput> {
  readonly id = 'bomber-express'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BomberState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const rng = (): number => ctx.random.next()
    const spawns = SPAWNS.slice(0, Math.max(1, ctx.players.length))
    // Seeded seats (not join order): player i starts on spawns[seats[i]].
    const seats = spawns.map((_, i) => i)
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[seats[i], seats[j]] = [seats[j] as number, seats[i] as number]
    }
    const keepClear = new Set<number>()
    for (const [sx, sy] of spawns) {
      keepClear.add(at(sx, sy))
      for (const [dx, dy] of Object.values(DIRS)) keepClear.add(at(sx + dx, sy + dy))
    }
    const cells: string[] = []
    const drops = new Map<number, string>()
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const wall =
          x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0)
        const roll = rng()
        const drop = rng()
        const kind = rng()
        if (wall) cells.push('#')
        else if (!keepClear.has(at(x, y)) && roll < CRATE_DENSITY) {
          cells.push('c')
          if (drop < DROP_CHANCE) drops.set(at(x, y), kind < 0.4 ? 'r' : kind < 0.75 ? 'b' : 's')
        } else cells.push('.')
      }
    }
    return {
      cells,
      drops,
      players: ctx.players.map((id, idx) => {
        const [x, y] = spawns[seats[idx % seats.length] ?? 0] ?? [1, 1]
        return {
          id,
          idx,
          x,
          y,
          tx: x,
          ty: y,
          stepStart: 0,
          stepEnd: 0,
          dir: null,
          alt: null,
          alive: true,
          range: BOMBER.startRange,
          maxBombs: BOMBER.startBombs,
          speed: 1,
          kos: 0,
          outAt: 0,
          crates: 0,
          left: false,
        }
      }),
      bombs: [],
      flames: new Map(),
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(state: BomberState, playerId: PlayerId, input: BomberInput, now: number): BomberState {
    if (now >= state.endsAt) return state
    const p = state.players.find((x) => x.id === playerId)
    if (!p?.alive) return state
    if (input.kind === 'move') {
      if (input.dir !== null && !isDir(input.dir)) return state
      p.dir = input.dir
      p.alt = isDir(input.alt) && input.alt !== input.dir ? input.alt : null
      // A step starts the moment the key does, not on the next tick (the client predicts from the
      // press, so this keeps the two within a network hop of each other).
      this.walk(state, p, now)
    } else if (input.kind === 'bomb') {
      const [x, y] = this.tileOf(p, now)
      const mine = state.bombs.filter((b) => b.owner === p.idx).length
      if (mine < p.maxBombs && !state.bombs.some((b) => b.x === x && b.y === y)) {
        state.bombs.push({ x, y, explodeAt: now + BOMBER.fuseMs, owner: p.idx, range: p.range })
      }
    }
    return state
  }

  tick(state: BomberState, _dt: number, now: number): BomberState {
    for (const p of state.players) if (p.alive) this.walk(state, p, now)
    this.explode(state, now)
    for (const [i, f] of state.flames) if (f.until <= now) state.flames.delete(i)
    // Knock-outs: anyone standing in a burning cell.
    for (const p of state.players) {
      if (!p.alive) continue
      const [x, y] = this.tileOf(p, now)
      const flame = state.flames.get(at(x, y))
      if (!flame) continue
      p.alive = false
      p.outAt = now
      const owner = state.players[flame.owner]
      if (owner && owner !== p) owner.kos += 1
    }
    return state
  }

  // The tile a player counts as standing on: the one they left until halfway, then the next one.
  private tileOf(p: Player, now: number): [number, number] {
    if (p.tx === p.x && p.ty === p.y) return [p.x, p.y]
    const progress = (now - p.stepStart) / Math.max(1, p.stepEnd - p.stepStart)
    return progress < 0.5 ? [p.x, p.y] : [p.tx, p.ty]
  }

  private walkable(state: BomberState, x: number, y: number): boolean {
    const c = state.cells[at(x, y)]
    if (c !== '.' && !isPower(c)) return false
    return !state.bombs.some((b) => b.x === x && b.y === y)
  }

  private walk(state: BomberState, p: Player, now: number): void {
    let readyAt = now
    if (p.tx !== p.x || p.ty !== p.y) {
      if (now < p.stepEnd) return
      // Arrived: pick up whatever lies here.
      p.x = p.tx
      p.y = p.ty
      readyAt = p.stepEnd
      const i = at(p.x, p.y)
      const c = state.cells[i]
      if (c === 'r') p.range = Math.min(BOMBER.maxRange, p.range + 1)
      else if (c === 'b') p.maxBombs = Math.min(BOMBER.maxBombs, p.maxBombs + 1)
      else if (c === 's') p.speed = Math.min(BOMBER.stepMs.length - 1, p.speed + 1)
      if (isPower(c)) state.cells[i] = '.'
    }
    const go = bomberStepDir(p.dir, p.alt, (dx, dy) => this.walkable(state, p.x + dx, p.y + dy))
    if (!go) return
    const [dx, dy] = DIRS[go]
    const nx = p.x + dx
    const ny = p.y + dy
    // A held direction keeps the stride going from the exact arrival time (no tick-rate stutter).
    const start = Math.max(readyAt, now - 50)
    p.tx = nx
    p.ty = ny
    p.stepStart = start
    p.stepEnd = start + (BOMBER.stepMs[p.speed] ?? 150)
  }

  // Due bombs go off; their flames set off any bomb they reach (chain reactions in the same tick).
  private explode(state: BomberState, now: number): void {
    const queue = state.bombs.filter((b) => b.explodeAt <= now)
    while (queue.length > 0) {
      const b = queue.shift() as Bomb
      if (!state.bombs.includes(b)) continue
      state.bombs = state.bombs.filter((x) => x !== b)
      const burn = (x: number, y: number): void => {
        state.flames.set(at(x, y), { until: now + BOMBER.flameMs, owner: b.owner })
      }
      burn(b.x, b.y)
      for (const [dx, dy] of Object.values(DIRS)) {
        for (let k = 1; k <= b.range; k++) {
          const x = b.x + dx * k
          const y = b.y + dy * k
          const i = at(x, y)
          const c = state.cells[i]
          if (c === '#' || c === undefined) break
          burn(x, y)
          if (c === 'c') {
            // A crate stops the blast and reveals what it hid.
            state.cells[i] = state.drops.get(i) ?? '.'
            state.drops.delete(i)
            const owner = state.players[b.owner]
            if (owner) owner.crates += 1
            break
          }
          if (isPower(c)) state.cells[i] = '.'
          const hit = state.bombs.find((o) => o.x === x && o.y === y)
          if (hit && !queue.includes(hit)) queue.push(hit)
        }
      }
    }
  }

  // A gone player is out on the spot (nobody scores the knock-out); bombs already down still go off.
  leave(state: BomberState, playerId: PlayerId, now: number): BomberState {
    const p = state.players.find((x) => x.id === playerId)
    if (!p?.alive) return state
    p.alive = false
    p.left = true
    p.dir = null
    p.alt = null
    p.outAt = now
    return state
  }

  isFinished(state: BomberState, now: number): boolean {
    const alive = state.players.filter((p) => p.alive).length
    return now >= state.endsAt || alive === 0 || (state.players.length > 1 && alive <= 1)
  }

  getResult(state: BomberState): NormalizedResult {
    // Still standing first; then knock-outs scored; then who lasted longer; then crates broken (so two
    // survivors at the buzzer don't simply share 1st).
    const cmp = (a: Player, b: Player): number =>
      Number(b.alive) - Number(a.alive) ||
      b.kos - a.kos ||
      (a.alive ? 0 : b.outAt - a.outAt) ||
      b.crates - a.crates
    const sorted = [...state.players].sort(cmp)
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((p, i) => {
      const prev = sorted[i - 1]
      ranks[p.id] = prev && cmp(prev, p) === 0 ? (ranks[prev.id] ?? i) : i
      stats[p.id] = `${p.kos} KO`
    })
    return { placements: sorted.map((p) => p.id), ranks, stats }
  }

  snapshot(state: BomberState, now: number): BomberSnapshot {
    return {
      grid: state.cells.join(''),
      bombs: state.bombs.map((b) => [b.x, b.y, Math.max(0, b.explodeAt - now), b.owner]),
      flames: [...state.flames].map(([i, f]) => [
        i % W,
        Math.floor(i / W),
        Math.max(0, f.until - now),
      ]),
      players: state.players.map((p) => {
        const moving = p.tx !== p.x || p.ty !== p.y
        return {
          id: p.id,
          x: p.x,
          y: p.y,
          tx: p.tx,
          ty: p.ty,
          step: moving
            ? Math.min(1, Math.max(0, (now - p.stepStart) / (p.stepEnd - p.stepStart)))
            : 0,
          stepMs: p.stepEnd - p.stepStart,
          alive: p.alive,
          range: p.range,
          bombs: p.maxBombs,
          speed: p.speed,
          kos: p.kos,
          left: p.left,
        }
      }),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
