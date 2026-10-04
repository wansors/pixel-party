import {
  BRAWL,
  type BrawlAction,
  type BrawlInput,
  type BrawlItemKind,
  type BrawlSnapshot,
} from '@pp/shared'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 75_000
const PUNCH = { dmg: 8, reach: 0.095, ...BRAWL.moves.punch }
const COMBO_WINDOW_MS = 650
const FINISHER_DMG = 14 // the third punch in a row (knocks down)
const KICK = { dmg: 12, reach: 0.125, shove: 0.08, ...BRAWL.moves.kick }
const GRAB = { dmg: 16, reach: 0.075, toss: 0.25, ...BRAWL.moves.grab }
const PIPE = { dmg: 14, reach: 0.135, uses: 6 }
const BOTTLE_DMG = 22
const CHICKEN_HEAL = 30
const HURT_MS = BRAWL.hurtMs
const DOWN_MS = BRAWL.downMs
const GUARD_MS = 600
const HURT_SHOVE = 0.025
const ITEM_FIRST_MS = 5000
const ITEM_GAP_MS = [5500, 8500] as const
const MAX_ITEMS = 4
// A KO is worth 1: the finisher takes FINISHER_SHARE of it, the rest is split by the damage everyone
// (finisher included) dealt to that fighter — softening someone up counts, stealing the last hit
// isn't everything.
const FINISHER_SHARE = 0.5

interface Fighter {
  id: PlayerId
  x: number
  y: number
  face: 1 | -1
  hp: number
  action: BrawlAction
  actionAt: number
  actionUntil: number
  nextAttackAt: number
  combo: number
  comboAt: number
  weapon: 'pipe' | 'bottle' | null
  uses: number
  guardUntil: number
  // KO credit (see FINISHER_SHARE).
  kos: number
  // Damage taken from each attacker this round (splits the KO credit).
  hurtBy: Map<PlayerId, number>
  outAt: number
  // Left the round: off the street for good (counts as out, credits nobody).
  gone: boolean
  dx: number
  dy: number
}

interface Item {
  id: number
  x: number
  y: number
  kind: BrawlItemKind
}

export interface BrawlState {
  fighters: Fighter[]
  items: Item[]
  nextItemId: number
  nextItemAt: number
  // mulberry32 state, seeded from the round's Random (item drops are drawn as the round unfolds).
  rng: number
  startedAt: number
  endsAt: number
}

function nextRand(state: BrawlState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0
  let t = state.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const clampX = (x: number): number => Math.max(BRAWL.bodyR, Math.min(BRAWL.w - BRAWL.bodyR, x))
const clampY = (y: number): number => Math.max(0, Math.min(BRAWL.depth, y))
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
// KO credit in whole tenths, as shown (equal shown credit ranks equal).
const tenths = (v: number): number => Math.round(v * 10)
const busy = (f: Fighter, now: number): boolean =>
  f.action !== 'idle' && f.action !== 'walk' && now < f.actionUntil

// Real-time FFA side-view brawler. Deterministic: spawn spots are evenly spaced and dealt out in a seeded
// order (nobody owns the safer end seats by joining first), and the item drops come from a mulberry32
// stream seeded by the round's Random; attacks resolve on input, movement in tick.
export class Brawl implements MiniGame<BrawlState, BrawlInput> {
  readonly id = 'brawl'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BrawlState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const n = ctx.players.length
    const seats = [...ctx.players]
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random.next() * (i + 1))
      ;[seats[i], seats[j]] = [seats[j] as PlayerId, seats[i] as PlayerId]
    }
    return {
      fighters: seats.map((id, i) => ({
        id,
        x: BRAWL.w * ((i + 0.5) / Math.max(1, n)),
        y: BRAWL.depth * (i % 2 === 0 ? 0.35 : 0.65),
        face: i % 2 === 0 ? 1 : -1,
        hp: BRAWL.hp,
        action: 'idle',
        actionAt: ctx.now,
        actionUntil: ctx.now,
        nextAttackAt: 0,
        combo: 0,
        comboAt: 0,
        weapon: null,
        uses: 0,
        guardUntil: 0,
        kos: 0,
        hurtBy: new Map(),
        outAt: 0,
        gone: false,
        dx: 0,
        dy: 0,
      })),
      items: [],
      nextItemId: 0,
      nextItemAt: ctx.now + ITEM_FIRST_MS,
      rng: Math.floor(ctx.random.next() * 4294967296) | 0,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  onInput(state: BrawlState, playerId: PlayerId, input: BrawlInput, now: number): BrawlState {
    if (now >= state.endsAt) return state
    const f = state.fighters.find((x) => x.id === playerId)
    if (!f || f.action === 'ko') return state
    if (input.kind === 'move') {
      if (!isNum(input.dx) || !isNum(input.dy)) return state
      const mag = Math.hypot(input.dx, input.dy)
      f.dx = mag < 0.001 ? 0 : input.dx / mag
      f.dy = mag < 0.001 ? 0 : input.dy / mag
      // Turning is instant: ← then PUNCH swings left even if no tick has moved you yet.
      if (f.dx !== 0 && !busy(f, now)) f.face = f.dx > 0 ? 1 : -1
      return state
    }
    if (busy(f, now) || now < f.nextAttackAt) return state
    if (input.kind === 'punch') this.punch(state, f, now)
    else if (input.kind === 'kick') this.kick(state, f, now)
    else if (input.kind === 'grab') this.grab(state, f, now)
    return state
  }

  private act(f: Fighter, action: BrawlAction, ms: number, cooldownMs: number, now: number): void {
    f.action = action
    f.actionAt = now
    f.actionUntil = now + ms
    f.nextAttackAt = now + cooldownMs
  }

  // Everyone in front within `reach` on (about) the same lane.
  private inFront(state: BrawlState, f: Fighter, reach: number): Fighter[] {
    return state.fighters.filter((o) => {
      if (o === f || o.action === 'ko') return false
      const ahead = (o.x - f.x) * f.face
      return ahead > 0 && ahead <= reach && Math.abs(o.y - f.y) <= BRAWL.laneTolerance
    })
  }

  private punch(state: BrawlState, f: Fighter, now: number): void {
    this.act(f, 'punch', PUNCH.ms, PUNCH.cooldownMs, now)
    f.combo = now - f.comboAt <= COMBO_WINDOW_MS ? f.combo + 1 : 1
    f.comboAt = now
    const weapon = f.weapon
    const reach = weapon === 'pipe' ? PIPE.reach : PUNCH.reach
    const targets = this.inFront(state, f, reach)
    const finisher = f.combo >= 3 || weapon === 'bottle'
    const dmg =
      weapon === 'bottle'
        ? BOTTLE_DMG
        : weapon === 'pipe'
          ? PIPE.dmg
          : finisher
            ? FINISHER_DMG
            : PUNCH.dmg
    for (const t of targets) this.hit(state, t, f, dmg, now, finisher, HURT_SHOVE)
    if (finisher && !weapon) f.combo = 0
    if (weapon === 'pipe' && targets.length > 0) {
      f.uses -= 1
      if (f.uses <= 0) f.weapon = null
    }
    if (weapon === 'bottle' && targets.length > 0) f.weapon = null // smashed
  }

  private kick(state: BrawlState, f: Fighter, now: number): void {
    this.act(f, 'kick', KICK.ms, KICK.cooldownMs, now)
    f.combo = 0
    for (const t of this.inFront(state, f, KICK.reach))
      this.hit(state, t, f, KICK.dmg, now, false, KICK.shove)
  }

  // Grab whoever is right next to you (either side) and throw them the way you face.
  private grab(state: BrawlState, f: Fighter, now: number): void {
    this.act(f, 'grab', GRAB.ms, GRAB.cooldownMs, now)
    f.combo = 0
    const target = state.fighters
      .filter(
        (o) =>
          o !== f &&
          o.action !== 'ko' &&
          Math.abs(o.x - f.x) <= GRAB.reach &&
          Math.abs(o.y - f.y) <= BRAWL.laneTolerance,
      )
      .sort((a, b) => Math.abs(a.x - f.x) - Math.abs(b.x - f.x))[0]
    if (target) this.hit(state, target, f, GRAB.dmg, now, true, GRAB.toss)
  }

  private hit(
    state: BrawlState,
    t: Fighter,
    by: Fighter,
    dmg: number,
    now: number,
    knockdown: boolean,
    shove: number,
  ): void {
    if (t.action === 'down' && now < t.actionUntil) return
    if (now < t.guardUntil) return
    const dealt = Math.min(t.hp, dmg)
    t.hp -= dealt
    t.hurtBy.set(by.id, (t.hurtBy.get(by.id) ?? 0) + dealt)
    t.x = clampX(t.x + by.face * shove)
    t.combo = 0
    if (t.hp <= 0) {
      this.knockOut(state, t, now)
      this.creditKo(state, t, by)
      return
    }
    if (knockdown) {
      t.action = 'down'
      t.actionAt = now
      t.actionUntil = now + DOWN_MS
      this.dropWeapon(state, t)
    } else {
      t.action = 'hurt'
      t.actionAt = now
      t.actionUntil = now + HURT_MS
    }
  }

  private knockOut(state: BrawlState, f: Fighter, now: number): void {
    f.action = 'ko'
    f.actionAt = now
    f.actionUntil = Number.POSITIVE_INFINITY
    f.outAt = now
    this.dropWeapon(state, f)
  }

  private creditKo(state: BrawlState, victim: Fighter, finisher: Fighter): void {
    finisher.kos += FINISHER_SHARE
    const total = [...victim.hurtBy.values()].reduce((sum, d) => sum + d, 0)
    for (const [id, dmg] of victim.hurtBy) {
      const f = state.fighters.find((x) => x.id === id)
      if (f && total > 0) f.kos += ((1 - FINISHER_SHARE) * dmg) / total
    }
  }

  // A fighter who left the round is out on the spot (no KO credit for anyone; their weapon drops).
  leave(state: BrawlState, playerId: PlayerId, now: number): BrawlState {
    const f = state.fighters.find((x) => x.id === playerId)
    if (!f || f.gone) return state
    f.gone = true
    if (f.action !== 'ko') this.knockOut(state, f, now)
    return state
  }

  // A knocked-down fighter lets go of their weapon (it lands next to them; a pipe keeps its swings).
  private dropWeapon(state: BrawlState, f: Fighter): void {
    if (!f.weapon) return
    state.items.push({
      id: state.nextItemId++,
      x: clampX(f.x - f.face * 0.06),
      y: f.y,
      kind: f.weapon,
    })
    f.weapon = null
  }

  tick(state: BrawlState, dt: number, now: number): BrawlState {
    const step = dt / 1000
    for (const f of state.fighters) {
      if (f.action === 'ko') continue
      if (f.action !== 'idle' && f.action !== 'walk' && now >= f.actionUntil) {
        if (f.action === 'down') f.guardUntil = now + GUARD_MS
        f.action = 'idle'
        f.actionAt = now
      }
      if (busy(f, now)) continue
      const moving = f.dx !== 0 || f.dy !== 0
      if (moving) {
        f.x = clampX(f.x + f.dx * BRAWL.speedX * step)
        f.y = clampY(f.y + f.dy * BRAWL.speedY * step)
        if (f.dx !== 0) f.face = f.dx > 0 ? 1 : -1
      }
      const next: BrawlAction = moving ? 'walk' : 'idle'
      if (f.action !== next) {
        f.action = next
        f.actionAt = now
      }
      this.pickUp(state, f)
    }
    if (now >= state.nextItemAt) {
      state.nextItemAt =
        now + ITEM_GAP_MS[0] + Math.round(nextRand(state) * (ITEM_GAP_MS[1] - ITEM_GAP_MS[0]))
      if (state.items.length < MAX_ITEMS) {
        const roll = nextRand(state)
        state.items.push({
          id: state.nextItemId++,
          x: BRAWL.w * (0.1 + nextRand(state) * 0.8),
          y: BRAWL.depth * (0.15 + nextRand(state) * 0.7),
          kind: roll < 0.4 ? 'pipe' : roll < 0.65 ? 'bottle' : 'chicken',
        })
      }
    }
    return state
  }

  private pickUp(state: BrawlState, f: Fighter): void {
    const item = state.items.find(
      (i) =>
        Math.abs(i.x - f.x) <= BRAWL.bodyR * 1.5 &&
        Math.abs(i.y - f.y) <= BRAWL.laneTolerance &&
        (i.kind === 'chicken' ? f.hp < BRAWL.hp : f.weapon === null),
    )
    if (!item) return
    state.items = state.items.filter((i) => i !== item)
    if (item.kind === 'chicken') f.hp = Math.min(BRAWL.hp, f.hp + CHICKEN_HEAL)
    else {
      f.weapon = item.kind
      f.uses = item.kind === 'pipe' ? PIPE.uses : 1
    }
  }

  isFinished(state: BrawlState, now: number): boolean {
    const alive = state.fighters.filter((f) => f.action !== 'ko').length
    return now >= state.endsAt || alive === 0 || (state.fighters.length > 1 && alive <= 1)
  }

  getResult(state: BrawlState): NormalizedResult {
    const up = (f: Fighter): number => (f.action === 'ko' ? 0 : 1)
    const cmp = (a: Fighter, b: Fighter): number =>
      up(b) - up(a) || tenths(b.kos) - tenths(a.kos) || (up(a) ? b.hp - a.hp : b.outAt - a.outAt)
    const sorted = [...state.fighters].sort(cmp)
    const ranks: Record<PlayerId, number> = {}
    const stats: Record<PlayerId, string> = {}
    sorted.forEach((f, i) => {
      const prev = sorted[i - 1]
      ranks[f.id] = prev && cmp(prev, f) === 0 ? (ranks[prev.id] ?? i) : i
      stats[f.id] = `${tenths(f.kos) / 10} KO`
    })
    return { placements: sorted.map((f) => f.id), ranks, stats }
  }

  snapshot(state: BrawlState, now: number): BrawlSnapshot {
    const round = (v: number): number => Math.round(v * 1000) / 1000
    return {
      fighters: state.fighters
        .filter((f) => !f.gone)
        .map((f) => ({
          id: f.id,
          x: round(f.x),
          y: round(f.y),
          face: f.face,
          hp: f.hp,
          action: f.action,
          actionMs: Math.max(0, now - f.actionAt),
          weapon: f.weapon,
          uses: f.uses,
          guard: now < f.guardUntil,
          kos: tenths(f.kos) / 10,
          dx: round(f.dx),
          dy: round(f.dy),
        })),
      items: state.items.map((i) => [i.id, round(i.x), round(i.y), i.kind]),
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
