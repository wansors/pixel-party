import { BOMBER, type BomberDir, type BomberInput, type BomberSnapshot } from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
const W = BOMBER.w
const H = BOMBER.h
// Ten starting cells with their neighbours kept clear of crates (corners, mid-edges, inner cross).
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
]
const CRATE_DENSITY = 0.6
const DROP_CHANCE = 0.32
const DIRS: Readonly<Record<BomberDir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

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
  alive: boolean
  range: number
  maxBombs: number
  speed: number
  kos: number
  outAt: number
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

// Real-time FFA Bomberman. Deterministic: the crate scatter and the power-up hidden in each crate are
// drawn from the seeded Random at init; the rest is driven by inputs and time.
export class BomberExpress implements MiniGame<BomberState, BomberInput> {
  readonly id = 'bomber-express'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BomberState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const rng = (): number => ctx.random.next()
    const spawns = SPAWNS.slice(0, Math.max(1, ctx.players.length))
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
        const [x, y] = SPAWNS[idx % SPAWNS.length] ?? [1, 1]
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
          alive: true,
          range: BOMBER.startRange,
          maxBombs: BOMBER.startBombs,
          speed: 1,
          kos: 0,
          outAt: 0,
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
      if (input.dir === null || (typeof input.dir === 'string' && input.dir in DIRS))
        p.dir = input.dir
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
    if (!p.dir) return
    const [dx, dy] = DIRS[p.dir]
    const nx = p.x + dx
    const ny = p.y + dy
    if (!this.walkable(state, nx, ny)) return
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
            break
          }
          if (isPower(c)) state.cells[i] = '.'
          const hit = state.bombs.find((o) => o.x === x && o.y === y)
          if (hit && !queue.includes(hit)) queue.push(hit)
        }
      }
    }
  }

  isFinished(state: BomberState, now: number): boolean {
    const alive = state.players.filter((p) => p.alive).length
    return now >= state.endsAt || alive === 0 || (state.players.length > 1 && alive <= 1)
  }

  getResult(state: BomberState): NormalizedResult {
    // Still standing first; then knock-outs scored; then who lasted longer.
    const cmp = (a: Player, b: Player): number =>
      Number(b.alive) - Number(a.alive) || b.kos - a.kos || (a.alive ? 0 : b.outAt - a.outAt)
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
        }
      }),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
