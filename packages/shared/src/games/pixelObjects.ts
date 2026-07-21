// Shared pixel-art object set used by the estimation/spatial mini-games (Pixel Weight, Pixel Split).
// Objects are hand-drawn as ASCII art ('#' = filled pixel) and compiled to filled-cell lists at load.
// The server owns the truth (filled count, per-column counts) for scoring; the client renders the cells.

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
const ART: Record<string, string[]> = {
  HEART: [
    '..###..###..',
    '.##########.',
    '############',
    '############',
    '.##########.',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....',
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
    '...######...',
    '..########..',
    '############',
    '############',
    '.##......##.',
    '.##......##.',
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
    '.....##.....',
    '....####....',
    '...######...',
    '..########..',
    '.##########.',
    '...######...',
    '.....##.....',
    '.....##.....',
    '.....##.....',
  ],
  STAR: [
    '.....##.....',
    '.....##.....',
    '....####....',
    '############',
    '.##########.',
    '..########..',
    '..##....##..',
    '.##......##.',
    '##........##',
  ],
  MUSHROOM: [
    '...######...',
    '..########..',
    '.##########.',
    '############',
    '....####....',
    '....####....',
    '...######...',
    '...######...',
  ],
  HOUSE: [
    '....####....',
    '...######...',
    '..########..',
    '.##########.',
    '############',
    '############',
    '###.####.###',
    '###.####.###',
    '############',
  ],
  CAT: [
    '.#........#.',
    '.##......##.',
    '.##########.',
    '############',
    '#.########.#',
    '############',
    '#####..#####',
    '.##########.',
    '..########..',
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

// Filled pixels per column (index 0..cols-1). Used by Pixel Split to score a cut.
export function columnCounts(obj: PixelObject): number[] {
  const counts = new Array<number>(obj.cols).fill(0)
  for (const cell of obj.cells) counts[cell.x] = (counts[cell.x] ?? 0) + 1
  return counts
}
