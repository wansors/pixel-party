import {
  MICRO_RACE_TRACKS,
  MICRO_RACE_WORLD,
  type MicroRacePoint,
  type MicroRaceTheme,
  sampleMicroRaceTrack,
} from '@pp/shared'
import { roadDistanceField } from './courseArt'

// Pixel-art painter for the Micro Race tabletops. Pure (no Phaser): paints one track into an RGBA
// buffer at TEXEL world units per pixel — the tabletop surface for its theme, a few props lying on the
// table, and the road (asphalt, red/white kerbs, dashed centre line, chequered start/finish) drawn from
// the same spline the server races on. Everything cosmetic is derived from positions, so every player
// sees the same table.

export const TEXEL = 2
export const TRACK_TEX_W = MICRO_RACE_WORLD.w / TEXEL
export const TRACK_TEX_H = MICRO_RACE_WORLD.h / TEXEL
const SPACING = 8
const KERB = 6
const SHOULDER = 4

type Rgb = number

// Cheap deterministic hash of two ints → [0, 1).
function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const r = ((a >> 16) & 0xff) + (((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t
  const g = ((a >> 8) & 0xff) + (((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t
  const bl = (a & 0xff) + ((b & 0xff) - (a & 0xff)) * t
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)
}

// --- Tabletop surfaces ----------------------------------------------------------------------------

function kitchenSurface(wx: number, wy: number): Rgb {
  const plank = Math.floor(wy / 64)
  if (wy - plank * 64 < 3) return 0x5e3a1f
  const tones = [0xa36d3d, 0x9a6536, 0xab7443]
  const grain = Math.floor((wx + plank * 211 + Math.sin(wy * 0.07 + plank) * 10) / 22)
  const base = tones[Math.floor(hash(grain, plank) * tones.length)] as number
  return hash(Math.floor(wx / 6), Math.floor(wy / 4)) < 0.08 ? mix(base, 0x5e3a1f, 0.35) : base
}

function deskSurface(wx: number, wy: number): Rgb {
  const major = wx % 200 < 3 || wy % 200 < 3
  const minor = wx % 40 < 2 || wy % 40 < 2
  if (major) return 0x5fb88a
  if (minor) return 0x3f9a6d
  return hash(Math.floor(wx / 4), Math.floor(wy / 4)) < 0.1 ? 0x2a7550 : 0x2e7d57
}

const RAIL = 26
function poolSurface(wx: number, wy: number): Rgb {
  const { w, h } = MICRO_RACE_WORLD
  const edge = Math.min(wx, wy, w - wx, h - wy)
  if (edge < RAIL - 8) {
    // Wooden rail with diamond sights every 150 units.
    const along = wy < RAIL || wy > h - RAIL ? wx : wy
    if (edge > 6 && edge < 12 && Math.abs(((along + 75) % 150) - 75) < 4) return 0xf0e6c8
    if (edge < 4) return 0x3d1f0f
    return hash(Math.floor(wx / 10), Math.floor(wy / 10)) < 0.3 ? 0x6b3a1c : 0x5a2f16
  }
  if (edge < RAIL) return 0x165c37 // cushion
  return hash(Math.floor(wx / 4), Math.floor(wy / 4)) < 0.12 ? 0x1c7043 : 0x1f7a4a
}

const SURFACES: Record<MicroRaceTheme, (wx: number, wy: number) => Rgb> = {
  kitchen: kitchenSurface,
  desk: deskSurface,
  pool: poolSurface,
}

// --- Props (drawn only on the table surface, never over the road) ------------------------------------

interface Prop {
  kind: 'mug' | 'toast' | 'cereal' | 'pencil' | 'eraser' | 'note' | 'ball' | 'pocket'
  x: number
  y: number
  r?: number
  color?: Rgb
  len?: number
}

const PROPS: Record<MicroRaceTheme, Prop[]> = {
  kitchen: [
    { kind: 'mug', x: 400, y: 330, r: 58 },
    { kind: 'toast', x: 690, y: 330, r: 52 },
    { kind: 'cereal', x: 0, y: 0 },
  ],
  desk: [
    { kind: 'pencil', x: 330, y: 300, len: 250 },
    { kind: 'eraser', x: 820, y: 330, r: 34 },
    { kind: 'note', x: 470, y: 440, r: 46 },
    { kind: 'pencil', x: 830, y: 770, len: 180 },
  ],
  pool: [
    { kind: 'pocket', x: 16, y: 16, r: 26 },
    { kind: 'pocket', x: 1184, y: 16, r: 26 },
    { kind: 'pocket', x: 16, y: 784, r: 26 },
    { kind: 'pocket', x: 1184, y: 784, r: 26 },
    { kind: 'pocket', x: 600, y: 8, r: 24 },
    { kind: 'pocket', x: 600, y: 792, r: 24 },
    { kind: 'ball', x: 420, y: 330, r: 14, color: 0xf3f0e6 },
    { kind: 'ball', x: 520, y: 470, r: 14, color: 0x1a1a1a },
    { kind: 'ball', x: 360, y: 520, r: 14, color: 0xe8c02a },
    { kind: 'ball', x: 560, y: 300, r: 14, color: 0xc0282d },
    { kind: 'ball', x: 900, y: 580, r: 14, color: 0x2656c9 },
    { kind: 'ball', x: 1140, y: 420, r: 14, color: 0x7a2fa0 },
  ],
}

function propColor(p: Prop, wx: number, wy: number): Rgb | null {
  const dx = wx - p.x
  const dy = wy - p.y
  const d = Math.hypot(dx, dy)
  const r = p.r ?? 0
  switch (p.kind) {
    case 'mug': {
      // Handle first (a ring off the right side), then the mug seen from above.
      const hd = Math.hypot(dx - r * 1.05, dy)
      if (d > r && hd < r * 0.42 && hd > r * 0.22) return hd > r * 0.36 ? 0xb9b4a8 : 0xe8e4da
      if (d > r + 6) return null
      if (d > r) return 0x000000 // contact shadow (blended below)
      if (d > r - 3) return 0xb9b4a8
      if (d > r - 10) return 0xe8e4da
      if (d < r * 0.35 && dx < 0 && dy < 0) return 0x5a3620
      return 0x3b2314
    }
    case 'toast': {
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      const topBulge = dy < -r * 0.55 ? Math.hypot(dx / 1.05, (dy + r * 0.55) / 0.55) : 0
      if (ax > r || ay > r * 0.9 || topBulge > r) return null
      const inner = ax < r - 7 && ay < r * 0.9 - 7 && topBulge < r - 7
      if (!inner) return 0x8a4f1d
      return hash(Math.floor(wx / 6), Math.floor(wy / 6)) < 0.18 ? 0xc98f4c : 0xe0b06a
    }
    case 'pencil': {
      const len = p.len ?? 200
      if (dy < -7 || dy > 7 || dx < -12 || dx > len + 14) return null
      if (dx < 0) return Math.abs(dy) < 6 ? 0xef8fa8 : null // eraser
      if (dx < 12) return Math.floor(dx / 3) % 2 === 0 ? 0xc9ccd4 : 0x8e929c // ferrule
      if (dx < len) return dy < -2 ? 0xffd84a : dy < 3 ? 0xf2b928 : 0xc98c12
      const cone = len + 14 - dx
      if (Math.abs(dy) > cone * 0.5) return null
      return cone < 5 ? 0x2a2a2e : 0xe6c79c
    }
    case 'eraser': {
      if (Math.abs(dx) > r * 1.4 || Math.abs(dy) > r * 0.8) return null
      return dx < -r * 0.3 ? 0x3b6fd6 : 0xf2eee4
    }
    case 'note': {
      if (Math.abs(dx) > r || Math.abs(dy) > r) return null
      if (dx > r - 10 && dy > r - 10 && dx + dy > r * 2 - 12) return 0xd8c040
      return Math.abs(((dy + r) % 16) - 8) < 1 ? 0xe6d468 : 0xfff08a
    }
    case 'ball': {
      if (d > r + 4) return null
      if (d > r) return 0x000000
      if (Math.hypot(dx + r * 0.35, dy + r * 0.35) < r * 0.3) return 0xffffff
      return d > r - 2 ? mix(p.color ?? 0xffffff, 0x000000, 0.4) : (p.color ?? 0xffffff)
    }
    case 'pocket':
      return d < r ? (d > r - 3 ? 0x2a1a10 : 0x050505) : null
    case 'cereal':
      return null
  }
}

// Scattered cereal loops for the kitchen table (grid-jittered so they never clump).
function cerealColor(wx: number, wy: number): Rgb | null {
  const cell = 70
  const cx = Math.floor(wx / cell)
  const cy = Math.floor(wy / cell)
  if (hash(cx, cy) > 0.35) return null
  const px = cx * cell + 12 + hash(cx + 7, cy) * (cell - 24)
  const py = cy * cell + 12 + hash(cx, cy + 7) * (cell - 24)
  const d = Math.hypot(wx - px, wy - py)
  if (d > 7 || d < 2.5) return null
  return d > 5.5 ? 0xb87a22 : 0xe8b04a
}

// --- Road -----------------------------------------------------------------------------------------

export function paintMicroTrack(track: number): Uint8ClampedArray {
  const def = MICRO_RACE_TRACKS[track] ?? (MICRO_RACE_TRACKS[0] as (typeof MICRO_RACE_TRACKS)[0])
  const samples = sampleMicroRaceTrack(def, SPACING)
  const hw = def.halfWidth
  const surface = SURFACES[def.theme]
  const props = PROPS[def.theme]
  const { dist, idx } = roadDistanceField(
    samples,
    TRACK_TEX_W,
    TRACK_TEX_H,
    TEXEL,
    hw + SHOULDER + 12,
    true,
  )
  // Start line frame: sample 0 and its tangent.
  const s0 = samples[0] as MicroRacePoint
  const s1 = samples[1] as MicroRacePoint
  const sN = samples[samples.length - 1] as MicroRacePoint
  const tl = Math.hypot(s1.x - sN.x, s1.y - sN.y) || 1
  const tx0 = (s1.x - sN.x) / tl
  const ty0 = (s1.y - sN.y) / tl
  const out = new Uint8ClampedArray(TRACK_TEX_W * TRACK_TEX_H * 4)
  for (let ty = 0; ty < TRACK_TEX_H; ty++) {
    for (let tx = 0; tx < TRACK_TEX_W; tx++) {
      const k = ty * TRACK_TEX_W + tx
      const wx = tx * TEXEL + TEXEL / 2
      const wy = ty * TEXEL + TEXEL / 2
      const d = dist[k] as number
      const i = idx[k] as number
      let c: Rgb
      if (d < hw) {
        const along = (wx - s0.x) * tx0 + (wy - s0.y) * ty0
        const lat = -(wx - s0.x) * ty0 + (wy - s0.y) * tx0
        if (d > hw - KERB) {
          c = Math.floor(i / 3) % 2 === 0 ? 0xd94141 : 0xeeeeee
        } else if (Math.abs(along) < 8 && Math.abs(lat) < hw) {
          c =
            (Math.floor((along + 8) / 4) + Math.floor((lat + 64) / 4)) % 2 === 0
              ? 0xf4f4f4
              : 0x1a1a1a
        } else if (d < 2 && Math.floor(i / 3) % 2 === 0) {
          c = 0xd8d8d0
        } else {
          c = hash(tx, ty) < 0.14 ? 0x50535e : hash(tx + 3, ty) < 0.1 ? 0x686b76 : 0x5b5e69
        }
      } else {
        c = surface(wx, wy)
        if (def.theme === 'kitchen') c = cerealColor(wx, wy) ?? c
        for (const p of props) {
          const pc = propColor(p, wx, wy)
          if (pc === null) continue
          c = pc === 0x000000 ? mix(c, 0x000000, 0.35) : pc
        }
        // Road verge shadow, so the road reads as laid on top of the table.
        if (d < hw + SHOULDER) c = mix(c, 0x000000, 0.4)
      }
      // Table edge rim.
      if (tx === 0 || ty === 0 || tx === TRACK_TEX_W - 1 || ty === TRACK_TEX_H - 1) {
        c = mix(c, 0x000000, 0.5)
      }
      const o = k * 4
      out[o] = (c >> 16) & 0xff
      out[o + 1] = (c >> 8) & 0xff
      out[o + 2] = c & 0xff
      out[o + 3] = 255
    }
  }
  return out
}

// Top-down racer, 16x10, nose to the right: tyres, dark outline, body in the player's colour with a
// highlight flank, a rear wing, the cockpit glass and headlights.
export const CAR_ROWS: readonly string[] = [
  '__kkk_____kkk___',
  '_ooooooooooooo__',
  'oWbbbbbbbbbbbboo',
  'oWhhhhhhhggbbbyo',
  'oWbbwwwwbgggbbbo',
  'oWbbwwwwbgggbbbo',
  'oWbbbbbbbggbbbyo',
  'oWbbbbbbbbbbbboo',
  '_ooooooooooooo__',
  '__kkk_____kkk___',
]
export const CAR_COLS = 16
export const CAR_LINES = CAR_ROWS.length
