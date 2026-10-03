// Shared pixel-art object set used by the estimation/spatial mini-games (Pixel Weight, Pixel Split).
// Objects are hand-drawn as ASCII art ('#' = filled pixel) and compiled to filled-cell lists at load.
// The server owns the truth (filled count, per-column counts) for scoring; the client renders the cells.
// Pixel Weight never shows an object as drawn: it weighs a seeded variant (pixelVariant), so a count
// learnt in one round is no use in the next.

export interface PixelCell {
  x: number
  y: number
}

export interface PixelObject {
  name: string
  cols: number
  rows: number
  // Filled cells only (empty cells are omitted to keep the wire payload small).
  cells: PixelCell[]
  // Total filled pixels — the object's "weight".
  count: number
}

// Each art must be rectangular (all rows equal length). '#' = filled, anything else = empty.
// Several are padded with blank columns on one side (still the same recognizable shape, just off-center
// in its frame). Pixel Split doesn't rely on that padding: it re-frames every puzzle with a seeded
// mirror + offset (see placeObject in the server's pixelSplit.ts), so its ideal cut moves between puzzles.
const ART: Record<string, string[]> = {
  HEART: [
    '..###..###......',
    '.##########.....',
    '############....',
    '############....',
    '.##########.....',
    '..########......',
    '...######.......',
    '....####........',
    '.....##.........',
  ],
  BANANA: [
    '.........##.',
    '........####',
    '.......####.',
    '......####..',
    '.....####...',
    '....####....',
    '..#####.....',
    '.#####......',
    '..###.......',
  ],
  CAR: [
    '.......######...',
    '......########..',
    '....############',
    '....############',
    '.....##......##.',
    '.....##......##.',
  ],
  FISH: [
    '...####.....',
    '..######...#',
    '.#######..##',
    '.#######.###',
    '.#######..##',
    '..######...#',
    '...####.....',
  ],
  TREE: [
    '.......##.....',
    '......####....',
    '.....######...',
    '....########..',
    '...##########.',
    '.....######...',
    '.......##.....',
    '.......##.....',
    '.......##.....',
  ],
  STAR: [
    '........##.....',
    '........##.....',
    '.......####....',
    '...############',
    '....##########.',
    '.....########..',
    '.....##....##..',
    '....##......##.',
    '...##........##',
  ],
  MUSHROOM: [
    '...######........',
    '..########.......',
    '.##########......',
    '############.....',
    '....####.........',
    '....####.........',
    '...######........',
    '...######........',
  ],
  HOUSE: [
    '....####.......',
    '...######......',
    '..########.....',
    '.##########....',
    '############...',
    '############...',
    '###.####.###...',
    '###.####.###...',
    '############...',
  ],
  CAT: [
    '.#........#...',
    '.##......##...',
    '.##########...',
    '############..',
    '#.########.#..',
    '############..',
    '#####..#####..',
    '.##########...',
    '..########....',
  ],
  GHOST: [
    '....####....',
    '..########..',
    '.##########.',
    '.#..####..#.',
    '.#..####..#.',
    '############',
    '############',
    '############',
    '############',
    '##.##..##.##',
    '#...#..#...#',
  ],
  KEY: [
    '..###.........',
    '.#####........',
    '##...#########',
    '##...#########',
    '.#####...##.##',
    '..###....##.##',
  ],
  APPLE: [
    '.....##....',
    '....##.....',
    '..###.###..',
    '.#########.',
    '###########',
    '###########',
    '###########',
    '###########',
    '.#########.',
    '.#########.',
    '..###.###..',
  ],
  CROWN: [
    '#.....#.....#',
    '##...###...##',
    '###.#####.###',
    '#############',
    '#############',
    '#############',
    '.###########.',
  ],
}

function build(name: string, art: string[]): PixelObject {
  const rows = art.length
  const cols = art[0]?.length ?? 0
  const cells: PixelCell[] = []
  art.forEach((line, y) => {
    if (line.length !== cols) throw new Error(`pixel object ${name}: ragged row ${y}`)
    for (let x = 0; x < line.length; x++) if (line[x] === '#') cells.push({ x, y })
  })
  return { name, cols, rows, cells, count: cells.length }
}

export const PIXEL_OBJECTS: readonly PixelObject[] = Object.entries(ART).map(([name, art]) =>
  build(name, art),
)

// A seeded variant of an object, so its exact pixel count changes from round to round while the shape
// stays recognisable: cropped to its filled pixels, stretched by repeating up to two inner rows and two
// inner columns, a few edge pixels nibbled off (tips and corners only, so no part comes loose) and a
// few grown on, then mirrored on a coin flip. `random` is the server's seeded Random port.
export function pixelVariant(obj: PixelObject, random: { next(): number }): PixelObject {
  const pick = (n: number): number => Math.floor(random.next() * n)
  const minX = Math.min(...obj.cells.map((c) => c.x))
  const minY = Math.min(...obj.cells.map((c) => c.y))
  const maxX = Math.max(...obj.cells.map((c) => c.x))
  const maxY = Math.max(...obj.cells.map((c) => c.y))
  const grid = Array.from({ length: maxY - minY + 1 }, () =>
    new Array<boolean>(maxX - minX + 1).fill(false),
  )
  for (const c of obj.cells) (grid[c.y - minY] as boolean[])[c.x - minX] = true
  const width = (): number => grid[0]?.length ?? 0
  for (let k = pick(3); k > 0 && grid.length > 2; k--) {
    const r = 1 + pick(grid.length - 2)
    grid.splice(r, 0, [...(grid[r] as boolean[])])
  }
  for (let k = pick(3); k > 0 && width() > 2; k--) {
    const c = 1 + pick(width() - 2)
    for (const row of grid) row.splice(c, 0, row[c] as boolean)
  }
  const filled = (x: number, y: number): boolean => grid[y]?.[x] === true
  const cellsWhere = (want: boolean, ok: (x: number, y: number) => boolean): PixelCell[] =>
    grid.flatMap((row, y) => row.flatMap((v, x) => (v === want && ok(x, y) ? [{ x, y }] : [])))
  const neighbours = (x: number, y: number) => ({
    n: filled(x, y - 1),
    s: filled(x, y + 1),
    w: filled(x - 1, y),
    e: filled(x + 1, y),
  })
  // A tip (one neighbour) or a corner whose two neighbours still touch through their diagonal.
  const removable = (x: number, y: number): boolean => {
    const { n, s, w, e } = neighbours(x, y)
    const count = Number(n) + Number(s) + Number(w) + Number(e)
    if (count <= 1) return true
    if (count !== 2 || (n && s) || (w && e)) return false
    return filled(e ? x + 1 : x - 1, n ? y - 1 : y + 1)
  }
  const growable = (x: number, y: number): boolean => Object.values(neighbours(x, y)).some(Boolean)
  for (const [want, ok] of [
    [true, removable],
    [false, growable],
  ] as const) {
    for (let k = 1 + pick(3); k > 0; k--) {
      const spots = cellsWhere(want, ok)
      const spot = spots[pick(spots.length)]
      if (spot) (grid[spot.y] as boolean[])[spot.x] = !want
    }
  }
  if (random.next() < 0.5) for (const row of grid) row.reverse()
  const cells = cellsWhere(true, () => true)
  return { name: obj.name, cols: width(), rows: grid.length, cells, count: cells.length }
}

// Filled pixels per column (index 0..cols-1). Used by Pixel Split to score a cut.
export function columnCounts(obj: PixelObject): number[] {
  const counts = new Array<number>(obj.cols).fill(0)
  for (const cell of obj.cells) counts[cell.x] = (counts[cell.x] ?? 0) + 1
  return counts
}
