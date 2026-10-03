import { AVATARS, type AvatarId } from '@pp/shared'

// The players' "monigote" avatars — the single source for the Angular chrome (PixelAvatarComponent)
// and every Phaser scene (game/avatars.ts), so a player looks the same in the lobby and in every
// mini-game (art-direction §6). Pure data + pure functions, no Phaser import: the join screen's avatar
// picker must not pull the game engine into the initial bundle.
//
// Each species is hand-drawn as a 16×16 silhouette with feature letters; the rest is computed the same
// way for every sprite so the whole cast shares one style:
//   - a 1-px outline around the silhouette in a dark tone of the player's colour,
//   - 3-tone shading of the body (light from the top-left: highlight on top/left edges, shade on the
//     bottom/right ones),
//   - the eyes (two 3×3 'E' blocks) drawn from an expression: idle, blink, happy, hurt, KO.
//
// Grid legend: '.' empty · '#' body (player colour, auto-shaded) · 'm' light muzzle/belly · 's' darker
// body (ears, wings) · 'p' pink · 'k' ink · 'w' white · 'y' beak/feet · 'E' eye cell.

export type AvatarPose = 'front' | 'side' | 'back'
export type AvatarExpression = 'idle' | 'blink' | 'happy' | 'hurt' | 'ko'
// Walk/run frames: 0 = both feet down; side view: 1 = feet passing under the body; front and back
// views: 1 = left foot lifted, 2 = right foot lifted.
export type AvatarStep = 0 | 1 | 2

// Final pixel roles (after shading, outline and eyes).
export type AvatarRole = 'O' | 'B' | 'H' | 'S' | 'D' | 'M' | 'N' | 'P' | 'K' | 'W' | 'Y' | 'Z'

export const AVATAR_SIZE = 16
// Every grid stands on this row (the feet), so all six share one ground line.
const FEET_ROW = 14

const FRONT: Record<AvatarId, readonly string[]> = {
  cat: [
    '................',
    '..#..........#..',
    '..##........##..',
    '..#p#......#p#..',
    '..#pp######pp#..',
    '.##############.',
    '.##############.',
    '.##EEE####EEE##.',
    '.##EEE####EEE##.',
    '.#pEEE####EEEp#.',
    '.######pp######.',
    '.####k####k####.',
    '...###kkkk###...',
    '....#mmmmmm#....',
    '...###....###...',
    '................',
  ],
  dog: [
    '................',
    '................',
    '....########....',
    '..ss########ss..',
    '.sss########sss.',
    '.ss##########ss.',
    '.ss#EEE##EEE#ss.',
    '.ss#EEE##EEE#ss.',
    '.s##EEE##EEE##s.',
    '..###mmmmmm###..',
    '..##mmmkkmmm##..',
    '...#mkmmmmkm#...',
    '....#mkkkkm#....',
    '....#mmppmm#....',
    '...###....###...',
    '................',
  ],
  fox: [
    '................',
    '.#............#.',
    '.##..........##.',
    '.#p#........#p#.',
    '.#pp#......#pp#.',
    '.#pp########pp#.',
    '..############..',
    '.##EEE####EEE##.',
    '.##EEE####EEE##.',
    '.m#EEE####EEE#m.',
    '.mm####kk####mm.',
    '..mmmkmmmmkmmm..',
    '...mmmkkkkmmm...',
    '....##mmmm##....',
    '...###....###...',
    '................',
  ],
  owl: [
    '................',
    '..#..........#..',
    '..##........##..',
    '..############..',
    '.##############.',
    '.#mmmmm##mmmmm#.',
    '.#mEEEm##mEEEm#.',
    '.#mEEEmyymEEEm#.',
    '.#mEEEmyymEEEm#.',
    '.##mmm#yy#mmm##.',
    '.##############.',
    '.#s##mmmmmm##s#.',
    '.#s#mmsmmsmm#s#.',
    '..##mmmmmmmm##..',
    '....yy....yy....',
    '................',
  ],
  frog: [
    '................',
    '..###......###..',
    '.#EEE#....#EEE#.',
    '.#EEE######EEE#.',
    '.#EEE######EEE#.',
    '.##############.',
    '.##p########p##.',
    '.#k##########k#.',
    '.##kkkkkkkkkk##.',
    '..############..',
    '..############..',
    '...#mmmmmmmm#...',
    '...#mmmmmmmm#...',
    '..##mmmmmmmm##..',
    '.###........###.',
    '................',
  ],
  bear: [
    '................',
    '..###......###..',
    '.#mm##....##mm#.',
    '.#mm########mm#.',
    '..############..',
    '.##############.',
    '.##EEE####EEE##.',
    '.##EEE####EEE##.',
    '.##EEE####EEE##.',
    '.####mmmmmm####.',
    '.###mmmkkmmm###.',
    '..##mkmmmmkm##..',
    '...##mkkkkm##...',
    '...#mmmmmmmm#...',
    '..###......###..',
    '................',
  ],
}

// Side view, facing right (scenes flip it to face left).
const SIDE: Record<AvatarId, readonly string[]> = {
  cat: [
    '................',
    '.....#...#......',
    '.....##..##.....',
    '.....#p##p#.....',
    '....########....',
    '....#########...',
    '....####EEE###..',
    '.#..####EEE####.',
    '.#..####EEE###p.',
    '.#...####p##k...',
    '.#..#######.....',
    '..##########....',
    '...#########....',
    '...#mmmmmmm#....',
    '...##....##.....',
    '................',
  ],
  dog: [
    '................',
    '................',
    '.....######.....',
    '....########....',
    '....sss######...',
    '...ssss#EEE##...',
    '...ssss#EEE###..',
    '...ssss#EEEmmmk.',
    '.#..sss#####mmm.',
    '.#...ss####mmk..',
    '.#..#######pp...',
    '.###########....',
    '..##########....',
    '...#mmmmmmm#....',
    '...##....##.....',
    '................',
  ],
  fox: [
    '................',
    '.....#...#......',
    '.....##..##.....',
    '.....#p##p#.....',
    '....########....',
    '.m..#########...',
    '.mm.####EEE###..',
    '.mm.####EEE####.',
    '.##.####EEE###k.',
    '.##.######mmm...',
    '.###..mmmmmmm...',
    '..###.#######...',
    '...##########...',
    '....#mmmmmmm#...',
    '....##....##....',
    '................',
  ],
  owl: [
    '................',
    '........#.......',
    '........##......',
    '.....########...',
    '....##########..',
    '....#####mmmm#..',
    '....####mEEEm#..',
    '....####mEEEmyy.',
    '....####mEEEmy..',
    '....#ss##mmm##..',
    '....ssss#mmmm#..',
    '....ssss#msmm#..',
    '.....sss#mmmm#..',
    '......###mm##...',
    '........y.y.....',
    '................',
  ],
  frog: [
    '................',
    '................',
    '................',
    '........###.....',
    '.......#EEE#....',
    '......##EEE##...',
    '.....###EEE####.',
    '....###########.',
    '...#####k######.',
    '...####p#kkkkkk.',
    '..#############.',
    '.####mmmmmmmm##.',
    '.####mmmmmmm##..',
    '.###..mmmmm##...',
    '.###......###...',
    '................',
  ],
  bear: [
    '................',
    '......###.......',
    '.....#mm#.......',
    '....#########...',
    '...##########...',
    '...#####EEE##...',
    '...#####EEE###..',
    '...#####EEEmmmk.',
    '...########mmmm.',
    '....#######mk...',
    '..##########....',
    '.###########....',
    '.##mmmmmmmm#....',
    '..#mmmmmmm##....',
    '..###...###.....',
    '................',
  ],
}

// Back view (walking away from the camera): no face, the tail and markings instead.
const BACK: Record<AvatarId, readonly string[]> = {
  cat: [
    '................',
    '..#..........#..',
    '..##........##..',
    '..#s#......#s#..',
    '..#ss######ss#..',
    '.######ss######.',
    '.##############.',
    '.#####s##s#####.',
    '.##############.',
    '.###########s##.',
    '.##########s###.',
    '.#########s####.',
    '...######s###...',
    '....####s###....',
    '...###....###...',
    '................',
  ],
  dog: [
    '................',
    '................',
    '....########....',
    '..ss########ss..',
    '.sss########sss.',
    '.ss##########ss.',
    '.ss##########ss.',
    '.ss##########ss.',
    '.s############s.',
    '..############..',
    '..#####ss#####..',
    '...####ss####...',
    '....###ss###....',
    '....########....',
    '...###....###...',
    '................',
  ],
  fox: [
    '................',
    '.#............#.',
    '.##..........##.',
    '.#s#........#s#.',
    '.#ss#......#ss#.',
    '.#ss########ss#.',
    '..############..',
    '.##############.',
    '.##############.',
    '.######ss######.',
    '.#####ssss#####.',
    '..####ssss####..',
    '...###ssss###...',
    '....##mmmm##....',
    '...###.mm.###...',
    '................',
  ],
  owl: [
    '................',
    '..#..........#..',
    '..##........##..',
    '..############..',
    '.##############.',
    '.##############.',
    '.##############.',
    '.#ss########ss#.',
    '.#sss######sss#.',
    '.#sss######sss#.',
    '.#sss######sss#.',
    '.#ss###ss###ss#.',
    '.##s##ssss##s##.',
    '..####ssss####..',
    '....yy....yy....',
    '................',
  ],
  frog: [
    '................',
    '..###......###..',
    '.#####....#####.',
    '.##############.',
    '.##############.',
    '.##ss##########.',
    '.##ss#####ss###.',
    '.#########ss###.',
    '.#####ss#######.',
    '.#####ss#######.',
    '..#########ss#..',
    '...##ss####ss...',
    '...##ss######...',
    '..############..',
    '.###........###.',
    '................',
  ],
  bear: [
    '................',
    '..###......###..',
    '.#####....#####.',
    '.##############.',
    '..############..',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '..#####mm#####..',
    '...###mmmm###...',
    '...####mm####...',
    '..###......###..',
    '................',
  ],
}

// Eye patterns per expression, one 3×3 block per eye ('.' keeps the body pixel under it). The right
// eye mirrors the left one.
const EYES: Record<AvatarExpression, readonly string[]> = {
  idle: ['KKK', 'KWK', 'KKK'],
  blink: ['...', '...', 'KKK'],
  happy: ['.K.', 'K.K', '...'],
  hurt: ['K..', '.K.', 'K..'],
  ko: ['K.K', '.K.', 'K.K'],
}

const SPRITES: Record<AvatarPose, Record<AvatarId, readonly string[]>> = {
  front: FRONT,
  side: SIDE,
  back: BACK,
}

// Narrows an untrusted roster value (it travels as a plain string) to a known avatar id.
export function toAvatarId(value: string | undefined): AvatarId {
  return (AVATARS as readonly string[]).includes(value ?? '') ? (value as AvatarId) : 'cat'
}

// Fixed-colour features (the rest of the letters are shaded from the body or the light tone).
const FEATURE: Record<string, AvatarRole> = { s: 'D', p: 'P', k: 'K', w: 'W' }

// A stride frame: rewrites the feet row of a view (see AvatarStep).
function stepFeet(row: string[], pose: AvatarPose, step: AvatarStep): void {
  const runs: [number, number][] = []
  for (let x = 0; x < row.length; ) {
    if (row[x] === '.') {
      x++
      continue
    }
    let end = x
    while (end < row.length && row[end] !== '.') end++
    runs.push([x, end])
    x = end
  }
  const first = runs[0]
  const last = runs[runs.length - 1]
  if (step === 0 || !first || !last || runs.length < 2) return
  if (pose === 'side') {
    const ch = row[first[0]] ?? '#'
    const w = Math.min(
      4,
      runs.reduce((n, [a, b]) => n + b - a, 0),
    )
    const start = Math.round((first[0] + last[1] - w) / 2)
    row.fill('.')
    for (let x = start; x < start + w; x++) row[x] = ch
  } else {
    const [a, b] = step === 1 ? first : last
    for (let x = a; x < b; x++) row[x] = '.'
  }
}

const cache = new Map<string, (AvatarRole | null)[][]>()

// The sprite as a 16×16 grid of roles (null = transparent): silhouette + features, the stride frame,
// eyes for the expression, shading and the outline. Pure and cached.
export function avatarPixels(
  avatar: AvatarId,
  pose: AvatarPose = 'front',
  expression: AvatarExpression = 'idle',
  step: AvatarStep = 0,
): (AvatarRole | null)[][] {
  const key = `${avatar}:${pose}:${expression}:${step}`
  const hit = cache.get(key)
  if (hit) return hit
  const rows = (SPRITES[pose][avatar] ?? FRONT.cat).map((r) => [...r])
  const feet = rows[FEET_ROW]
  if (feet) stepFeet(feet, pose, step)
  const n = AVATAR_SIZE
  const at = (x: number, y: number): string => rows[y]?.[x] ?? '.'
  const filled = (x: number, y: number): boolean => at(x, y) !== '.'
  // Eyes: find each 3×3 'E' block (top-left corners) and stamp the expression's pattern.
  const eyes: [number, number][] = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (at(x, y) === 'E' && at(x - 1, y) !== 'E' && at(x, y - 1) !== 'E') eyes.push([x, y])
    }
  }
  const out: (AvatarRole | null)[][] = rows.map((r) => r.map(() => null))
  const get = (x: number, y: number): AvatarRole | null => out[y]?.[x] ?? null
  const set = (x: number, y: number, role: AvatarRole): void => {
    const row = out[y]
    if (row) row[x] = role
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = at(x, y)
      if (c === '#' || c === 'E') {
        // Light from the top-left: highlight on the top/left edge, shade on the bottom/right edge.
        const top = !filled(x, y - 1) || !filled(x - 1, y)
        const bottom = !filled(x, y + 1) || !filled(x + 1, y)
        set(x, y, bottom ? 'S' : top ? 'H' : 'B')
      } else if (c === 'm' || c === 'y') {
        // Light parts (muzzle, belly; beak, feet) take their shade along their lower edge.
        const lower = at(x, y + 1) !== c
        set(x, y, c === 'm' ? (lower ? 'N' : 'M') : lower ? 'Z' : 'Y')
      } else if (c !== '.') {
        set(x, y, FEATURE[c] ?? 'B')
      }
    }
  }
  // Eyes on top of the shading (the cells under a '.' of the pattern stay plain body).
  const pattern = EYES[expression]
  eyes.forEach(([ex, ey], i) => {
    const mirror = i % 2 === 1
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const p = pattern[dy]?.[mirror ? 2 - dx : dx] ?? '.'
        const [x, y] = [ex + dx, ey + dy]
        if (p === 'K' || p === 'W') set(x, y, p)
        else if (get(x, y) === 'S' || get(x, y) === 'H') set(x, y, 'B')
      }
    }
  })
  // Outline: every empty cell touching the silhouette (4-neighbours). The grids keep a 1-cell margin.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (filled(x, y)) continue
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))
        set(x, y, 'O')
    }
  }
  cache.set(key, out)
  return out
}

function shadeRgb(hex: number, amount: number): number {
  const f = (c: number): number =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))))
  return (f((hex >> 16) & 0xff) << 16) | (f((hex >> 8) & 0xff) << 8) | f(hex & 0xff)
}

function mixRgb(a: number, b: number, t: number): number {
  const ch = (s: number): number =>
    Math.round(((a >> s) & 0xff) + (((b >> s) & 0xff) - ((a >> s) & 0xff)) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

// The colour of every role for a player colour (0xRRGGBB).
export function avatarPalette(color: number): Record<AvatarRole, number> {
  const light = mixRgb(color, 0xfff4e2, 0.72)
  return {
    O: shadeRgb(color, -0.7),
    B: color,
    H: shadeRgb(color, 0.32),
    S: shadeRgb(color, -0.28),
    D: shadeRgb(color, -0.42),
    M: light,
    N: shadeRgb(light, -0.14),
    P: 0xff8fb0,
    K: 0x1a1426,
    W: 0xfffdf6,
    Y: 0xffbf3f,
    Z: 0xd98a24,
  }
}
