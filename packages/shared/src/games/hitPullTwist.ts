import { compound } from '../difficulty'

// Hit, Pull, Twist wire shapes and rules shared by the server and the client (D47). The game calls out
// orders one after another — HIT (↑), PULL (→), TWIST (←), SHAKE (↓) — and you do each one before its
// window closes; a wrong move or a missed one knocks you out. Everyone gets the same seeded orders and
// plays them at their own pace (the next order shows a moment after you answer the last), with the
// windows shrinking every order (D40) and tricks piling up: orders painted in another action's colour
// (obey the word and the arrow), UPSIDE-DOWN stretches (do the opposite move) and FREEZE orders
// (touch nothing until it passes). The orders come from a tiny integer PRNG (`hptOrder`), so the
// server and every client derive the very same list from the round's seed.

export const HPT_ACTIONS = ['hit', 'pull', 'twist', 'shake'] as const
export type HptAction = (typeof HPT_ACTIONS)[number]
// Action index → its opposite (↑↓, →←), for the upside-down stretches.
export const HPT_OPPOSITE = [3, 2, 1, 0] as const
// An order that asks for no move at all.
export const HPT_FREEZE = 4

export const HPT = {
  // Everyone gets ready this long before the first order.
  startDelayMs: 1500,
  // An order's window: 1.7 s, ×0.955 per order, never under 0.5 s.
  windowMs: 1700,
  windowFactor: 0.955,
  windowMinMs: 500,
  // The pause between an answer and the next order.
  gapMs: 380,
  // How late an answer may reach the server (its trip) and still count.
  lateMs: 250,
  // The tricks start at these orders (0-based).
  paintFrom: 6,
  flipFrom: 12,
  freezeFrom: 18,
} as const

export interface HptOrder {
  // What the order shows: an action, or HPT_FREEZE.
  action: number
  // The colour it is painted in (an action's colour; differs from `action` on a trick).
  paint: number
  // Inside an UPSIDE-DOWN stretch: the right move is the opposite one.
  flipped: boolean
}

// mulberry32 step: plain 32-bit integer maths, identical on every JS engine.
function rand(seed: number, k: number, salt: number): number {
  let t = (seed + Math.imul(k + 1, 0x9e3779b1) + Math.imul(salt, 0x85ebca6b)) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Order `k` (0-based) of the round seeded `seed`.
export function hptOrder(seed: number, k: number): HptOrder {
  const flipped = k >= HPT.flipFrom && (k - HPT.flipFrom) % 12 < 4
  const freeze = k >= HPT.freezeFrom && !flipped && rand(seed, k, 1) < 0.12
  const action = freeze ? HPT_FREEZE : Math.floor(rand(seed, k, 2) * 4)
  let paint = action === HPT_FREEZE ? Math.floor(rand(seed, k, 3) * 4) : action
  if (!freeze && k >= HPT.paintFrom && rand(seed, k, 4) < 0.45) {
    paint = (action + 1 + Math.floor(rand(seed, k, 5) * 3)) % 4
  }
  return { action, paint, flipped }
}

// The move that answers an order: its action, the opposite one when flipped, -1 for a freeze.
export function hptExpected(order: HptOrder): number {
  if (order.action === HPT_FREEZE) return -1
  return order.flipped ? (HPT_OPPOSITE[order.action] as number) : order.action
}

// How long order `k` (0-based) gives you.
export function hptWindowMs(k: number): number {
  return Math.round(compound(HPT.windowMs, HPT.windowFactor, k, HPT.windowMinMs))
}

export interface HptPlayerView {
  // The order this player is on (= orders done).
  k: number
  alive: boolean
  // When this order shows (ms from this snapshot; negative = already showing).
  orderInMs: number
}

export interface HptSnapshot {
  seed: number
  players: Record<string, HptPlayerView>
  // playerId -> orders done, for the live standings.
  progress: Record<string, number>
  remainingMs: number
}

// Answer order `k` with move `action` (0..3).
export interface HptInput {
  kind: 'act'
  k: number
  action: number
}
