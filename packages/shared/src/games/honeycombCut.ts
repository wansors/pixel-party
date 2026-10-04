// Honeycomb Cut wire shapes (the dalgona candy). An FFA precision round: everyone gets the same seeded
// shape pressed into a honeycomb candy and carves it out by tracing its outline with a needle (hold the
// mouse button / finger down and follow the line). Each stretch of the outline you trace while on the
// line is cut. Stray off the line — or rush the needle — and the candy cracks; the third crack breaks it
// (ELIMINATED). Cut the whole outline to pop the shape out. Ranked by finishing time, then everyone
// else by how much was cut — a broken candy counts half of its cut, fewer cracks break a tie.
//
// Coordinates are normalized to the candy's square, [0, 1] × [0, 1], centre (0.5, 0.5).

export const HONEYCOMB = {
  segments: 160,
  // Within this distance of the outline the needle cuts; beyond crackTol it cracks the candy.
  lineTol: 0.028,
  crackTol: 0.055,
  // Needle speed (candy widths / s) above which the stress builds toward a crack.
  maxSpeed: 0.5,
  cracks: 3,
  // Share of its cut a broken candy still counts for in the ranking.
  brokenShare: 0.5,
  candyR: 0.46,
} as const

export type HoneycombShape = 'circle' | 'triangle' | 'star' | 'umbrella'

export const HONEYCOMB_SHAPES: readonly HoneycombShape[] = [
  'circle',
  'triangle',
  'star',
  'umbrella',
]

// The outline as a closed polyline of HONEYCOMB.segments points (pure; both apps use it).
export function honeycombOutline(shape: HoneycombShape): { x: number; y: number }[] {
  const n = HONEYCOMB.segments
  const pts: { x: number; y: number }[] = []
  const c = 0.5
  // A closed polygon resampled evenly by perimeter.
  const poly = (corners: [number, number][]): { x: number; y: number }[] => {
    const lens = corners.map((p, i) => {
      const q = corners[(i + 1) % corners.length] as [number, number]
      return Math.hypot(q[0] - p[0], q[1] - p[1])
    })
    const total = lens.reduce((a, b) => a + b, 0)
    const out: { x: number; y: number }[] = []
    for (let k = 0; k < n; k++) {
      let d = (k / n) * total
      let i = 0
      while (d > (lens[i] ?? 0) && i < corners.length - 1) {
        d -= lens[i] ?? 0
        i++
      }
      const p = corners[i] as [number, number]
      const q = corners[(i + 1) % corners.length] as [number, number]
      const t = d / (lens[i] || 1)
      out.push({ x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t })
    }
    return out
  }
  switch (shape) {
    case 'circle':
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 - Math.PI / 2
        pts.push({ x: c + Math.cos(a) * 0.27, y: c + Math.sin(a) * 0.27 })
      }
      return pts
    case 'triangle':
      return poly([
        [c, 0.2],
        [0.79, 0.72],
        [0.21, 0.72],
      ])
    case 'star': {
      const corners: [number, number][] = []
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2
        const r = k % 2 === 0 ? 0.31 : 0.14
        corners.push([c + Math.cos(a) * r, c + 0.02 + Math.sin(a) * r])
      }
      return poly(corners)
    }
    case 'umbrella': {
      // Canopy (a half-disc with a scalloped hem) and a hooked handle, as one outline.
      const corners: [number, number][] = []
      for (let k = 0; k <= 12; k++) {
        const a = Math.PI + (k / 12) * Math.PI
        corners.push([c + Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.26])
      }
      corners.push([0.7, 0.5], [0.62, 0.46], [0.55, 0.5], [0.53, 0.5], [0.53, 0.72])
      for (let k = 0; k <= 4; k++) {
        const a = (k / 4) * Math.PI
        corners.push([0.47 + Math.cos(a) * 0.06, 0.72 + Math.sin(a) * 0.06])
      }
      corners.push(
        [0.41, 0.72],
        [0.45, 0.72],
        [0.47, 0.7],
        [0.47, 0.5],
        [0.45, 0.5],
        [0.38, 0.46],
        [0.3, 0.5],
      )
      return poly(corners)
    }
  }
}

// The cut mask on the wire: hex, four segments per digit (segment 4k + j is bit j of digit k) — 40
// characters for the 160 segments instead of 160.
export function honeycombCutHex(cut: readonly boolean[]): string {
  let hex = ''
  for (let k = 0; k < cut.length; k += 4) {
    const nibble =
      (cut[k] ? 1 : 0) | (cut[k + 1] ? 2 : 0) | (cut[k + 2] ? 4 : 0) | (cut[k + 3] ? 8 : 0)
    hex += nibble.toString(16)
  }
  return hex
}

// Whether segment i is cut in a hex mask from honeycombCutHex.
export function honeycombIsCut(hex: string, i: number): boolean {
  const nibble = Number.parseInt(hex[i >> 2] ?? '0', 16)
  return ((nibble >> (i & 3)) & 1) === 1
}

export interface HoneycombPlayer {
  id: string
  // Cut mask over the outline segments (honeycombCutHex / honeycombIsCut).
  cut: string
  progress: number
  cracks: number
  broken: boolean
  // Left the round (disconnected): out of the running, like a broken candy.
  left: boolean
  doneMs: number | null
}

export interface HoneycombSnapshot {
  shape: HoneycombShape
  players: HoneycombPlayer[]
  remainingMs: number
}

// The needle: its position and whether it is pressed into the candy.
export interface HoneycombInput {
  kind: 'needle'
  x: number
  y: number
  down: boolean
}
