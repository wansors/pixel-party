import {
  type CourseDef,
  type CourseTheme,
  type MicroRacePoint,
  inStretch,
  sampleCourse,
} from '@pp/shared'

// Pixel-art painter for the course racers (Rally Stage, Speed Circuit) plus the road distance field
// shared with Micro Race's painter. Pure (no Phaser): paints a whole course into an RGBA buffer at
// COURSE_TEXEL world units per pixel — the countryside for its theme, then the road from the same
// spline the server races on: gravel or tarmac stretches, kerbs, the start (and stage finish) line,
// checkpoint lines and boost-pad chevrons. Cosmetic detail is hashed from positions, so every player
// sees the same course.

export const COURSE_TEXEL = 4

type Rgb = number

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

// Per-texel distance to the centreline + nearest segment index, stamping a box around every
// centreline segment (true point-to-segment distance, so road edges come out straight). `closed` joins
// the last sample back to the first.
export function roadDistanceField(
  samples: readonly MicroRacePoint[],
  texW: number,
  texH: number,
  texel: number,
  reach: number,
  closed: boolean,
): { dist: Float32Array; idx: Int32Array } {
  const dist = new Float32Array(texW * texH).fill(Number.POSITIVE_INFINITY)
  const idx = new Int32Array(texW * texH).fill(-1)
  const rt = Math.ceil(reach / texel) + 4
  const segments = closed ? samples.length : samples.length - 1
  for (let i = 0; i < segments; i++) {
    const s = samples[i] as MicroRacePoint
    const e = samples[(i + 1) % samples.length] as MicroRacePoint
    const ex = e.x - s.x
    const ey = e.y - s.y
    const len2 = ex * ex + ey * ey || 1
    const tx0 = Math.floor(s.x / texel)
    const ty0 = Math.floor(s.y / texel)
    // Squared distances in the hot loop (this runs millions of times when a course is first painted);
    // the square roots are taken once at the end.
    for (let ty = Math.max(0, ty0 - rt); ty <= Math.min(texH - 1, ty0 + rt); ty++) {
      const py = ty * texel + texel / 2 - s.y
      const row = ty * texW
      for (let tx = Math.max(0, tx0 - rt); tx <= Math.min(texW - 1, tx0 + rt); tx++) {
        const px = tx * texel + texel / 2 - s.x
        let u = (px * ex + py * ey) / len2
        u = u < 0 ? 0 : u > 1 ? 1 : u
        const dx = px - ex * u
        const dy = py - ey * u
        const d2 = dx * dx + dy * dy
        const k = row + tx
        if (d2 < (dist[k] as number)) {
          dist[k] = d2
          idx[k] = i
        }
      }
    }
  }
  for (let k = 0; k < dist.length; k++) dist[k] = Math.sqrt(dist[k] as number)
  return { dist, idx }
}

// The countryside around the road.
function scenery(theme: CourseTheme, wx: number, wy: number, d: number): Rgb {
  const tx = Math.floor(wx / COURSE_TEXEL)
  const ty = Math.floor(wy / COURSE_TEXEL)
  const n = hash(tx, ty)
  switch (theme) {
    case 'forest': {
      // Grass with clumps of pines away from the road.
      const cell = 56
      const cx = Math.floor(wx / cell)
      const cy = Math.floor(wy / cell)
      const tree = hash(cx * 7, cy * 13) < 0.45 && d > 70
      if (tree) {
        const ox = (hash(cx, cy) - 0.5) * 20
        const oy = (hash(cy, cx) - 0.5) * 20
        const r = Math.hypot(wx - (cx + 0.5) * cell - ox, wy - (cy + 0.5) * cell - oy)
        if (r < 18) return r < 7 ? 0x1f4a26 : 0x2c6b33
        if (r < 21) return 0x1d3a20
      }
      return n < 0.12 ? 0x4d8a3c : n < 0.2 ? 0x3f7a33 : 0x467f37
    }
    case 'desert': {
      // Scattered round boulders with a sunlit top.
      const cell = 48
      const cx = Math.floor(wx / cell)
      const cy = Math.floor(wy / cell)
      if (hash(cx * 5, cy * 11) < 0.08 && d > 60) {
        const r = Math.hypot(wx - (cx + 0.5) * cell, wy - (cy + 0.5) * cell)
        const size = 9 + hash(cy, cx) * 8
        if (r < size) return wy < (cy + 0.5) * cell - size * 0.2 ? 0xa8875f : 0x86684a
      }
      return n < 0.1 ? 0xc9a46a : n < 0.18 ? 0xe2c48c : 0xd8b77c
    }
    case 'gp': {
      // Mown stripes, with gravel run-off right next to the track.
      if (d < 90) return n < 0.3 ? 0xb9a983 : 0xc8b892
      return Math.floor((wx + wy) / 80) % 2 === 0 ? 0x4f9a43 : 0x47903c
    }
    case 'night': {
      if (d < 70) return n < 0.3 ? 0x2a2f3c : 0x30364a
      return n < 0.1 ? 0x1c3a2a : 0x183224
    }
  }
}

export function paintCourse(def: CourseDef): { rgba: Uint8ClampedArray; w: number; h: number } {
  const samples = sampleCourse(def)
  const n = samples.length
  const closed = def.kind === 'circuit'
  const texW = Math.ceil(def.world.w / COURSE_TEXEL)
  const texH = Math.ceil(def.world.h / COURSE_TEXEL)
  const hw = def.halfWidth
  const { dist, idx } = roadDistanceField(samples, texW, texH, COURSE_TEXEL, hw + 100, closed)
  // Lines across the road: the start, the stage finish and the stage checkpoints (samples + tangents).
  const across: { i: number; color: 'check' | 'white' }[] = [{ i: 0, color: 'check' }]
  if (!closed) {
    across.push({ i: n - 1, color: 'check' })
    for (let k = 1; k <= 3; k++) across.push({ i: Math.round((k * (n - 1)) / 4), color: 'white' })
  }
  const frames = across.map(({ i, color }) => {
    const p = samples[i] as MicroRacePoint
    const a = samples[Math.max(0, i - 1)] as MicroRacePoint
    const b = samples[Math.min(n - 1, i + 1)] as MicroRacePoint
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { p, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l, color }
  })
  const out = new Uint8ClampedArray(texW * texH * 4)
  for (let ty = 0; ty < texH; ty++) {
    for (let tx = 0; tx < texW; tx++) {
      const k = ty * texW + tx
      const wx = tx * COURSE_TEXEL + COURSE_TEXEL / 2
      const wy = ty * COURSE_TEXEL + COURSE_TEXEL / 2
      const d = dist[k] as number
      const i = idx[k] as number
      let c: Rgb
      if (d < hw) {
        const gravel = !closed && inStretch(def.gravel, i, n)
        const grain = hash(tx, ty)
        if (gravel) c = grain < 0.18 ? 0x7a6448 : grain < 0.3 ? 0xa48a64 : 0x8f7655
        else c = grain < 0.14 ? 0x50535e : grain < 0.22 ? 0x686b76 : 0x5b5e69
        if (closed && d > hw - 6) c = Math.floor(i / 3) % 2 === 0 ? 0xd94141 : 0xeeeeee
        else if (!gravel && !closed && d < 2 && Math.floor(i / 4) % 2 === 0) c = 0xd8d8d0
        if (closed && inStretch(def.boosts, i, n) && d < hw * 0.6) {
          // Cyan chevrons pointing down the road.
          const phase = (i % 4) / 4
          if (phase + (d / hw) * 0.2 < 0.35) c = 0x29d3f2
        }
        for (const f of frames) {
          const along = (wx - f.p.x) * f.tx + (wy - f.p.y) * f.ty
          const lat = -(wx - f.p.x) * f.ty + (wy - f.p.y) * f.tx
          if (Math.abs(along) >= 8 || Math.abs(lat) >= hw) continue
          c =
            f.color === 'white'
              ? Math.abs(along) < 2
                ? 0xf4f4f4
                : c
              : (Math.floor((along + 8) / 4) + Math.floor((lat + 64) / 4)) % 2 === 0
                ? 0xf4f4f4
                : 0x1a1a1a
        }
      } else {
        c = scenery(def.theme, wx, wy, d - hw)
        if (d < hw + 5) c = mix(c, 0x000000, 0.35)
      }
      const o = k * 4
      out[o] = (c >> 16) & 0xff
      out[o + 1] = (c >> 8) & 0xff
      out[o + 2] = c & 0xff
      out[o + 3] = 255
    }
  }
  return { rgba: out, w: texW, h: texH }
}
