import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { SudokuRace, type SudokuRaceState, WRONG_DIGIT_COOLDOWN_MS } from './sudokuRace'

const half: Random = { next: () => 0.5 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], random: Random = half, now = 0) =>
  new SudokuRace().init({ players, seed: 1, random, now, config: { durationMs: 75_000 } })

// A cycling sequence of draws so the seeded transforms/shuffles don't all take the same branch.
const cycling = (values: number[]): Random => {
  let i = 0
  return { next: () => values[i++ % values.length] as number }
}

// Small seeded generator (mulberry32) so the uniqueness test walks many real, reproducible seeds.
function seeded(seed: number): Random {
  let a = seed >>> 0
  return {
    next: () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), a | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

// Every valid 4x4 sudoku (there are 288), to count a puzzle's completions independently of the game:
// four rows, each a permutation of 1..4, with no repeat down a column, then the box check.
const ALL_SOLUTIONS: number[][] = (() => {
  const perms: number[][] = []
  const permute = (rest: number[], acc: number[]): void => {
    if (rest.length === 0) perms.push(acc)
    rest.forEach((d, i) => {
      permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, d])
    })
  }
  permute([1, 2, 3, 4], [])
  const clash = (rows: number[][], row: number[]) =>
    rows.some((r) => r.some((v, i) => v === row[i]))
  const out: number[][] = []
  const extend = (rows: number[][]): void => {
    if (rows.length === 4) {
      if (isValidSudoku(rows.flat())) out.push(rows.flat())
      return
    }
    for (const row of perms) if (!clash(rows, row)) extend([...rows, row])
  }
  extend([])
  return out
})()

// A player's copy of the puzzle.
const puz = (s: SudokuRaceState, id = 'p') => nn(s.puzzles.get(id))

function isValidSudoku(solution: number[]): boolean {
  const size = 4
  const box = 2
  const at = (r: number, c: number) => solution[r * size + c] as number
  const hasAllDigits = (values: number[]) => new Set(values).size === size
  for (let r = 0; r < size; r++) {
    if (!hasAllDigits(Array.from({ length: size }, (_, c) => at(r, c)))) return false
  }
  for (let c = 0; c < size; c++) {
    if (!hasAllDigits(Array.from({ length: size }, (_, r) => at(r, c)))) return false
  }
  for (let br = 0; br < size; br += box) {
    for (let bc = 0; bc < size; bc += box) {
      const cell: number[] = []
      for (let r = br; r < br + box; r++) for (let c = bc; c < bc + box; c++) cell.push(at(r, c))
      if (!hasAllDigits(cell)) return false
    }
  }
  return solution.every((v) => v >= 1 && v <= size)
}

describe('SudokuRace', () => {
  test('builds a deterministic, valid 4x4 sudoku for a given seed', () => {
    const a = init(['p'])
    const b = init(['p'])
    expect(puz(a).solution).toEqual(puz(b).solution)
    expect(isValidSudoku(puz(a).solution)).toBe(true)
  })

  test('builds a valid sudoku across varied random draws too', () => {
    const r = cycling([0.1, 0.9, 0.3, 0.7, 0.05, 0.99, 0.4, 0.6, 0.2, 0.8])
    const s = init(['p'], r)
    expect(isValidSudoku(puz(s).solution)).toBe(true)
  })

  test('exactly BLANKS cells are blank and the rest are locked givens', () => {
    const s = init(['p'])
    const blanks = puz(s).givenMask.filter((g) => !g).length
    expect(blanks).toBe(8)
    expect(s.blanksCount).toBe(8)
    expect(puz(s).givenMask.length).toBe(16)
  })

  test('a given cell starts pre-filled with the solved value on every player board', () => {
    const s = init(['p'])
    const givenIndex = puz(s).givenMask.findIndex((g) => g)
    expect(nn(s.grids.get('p'))[givenIndex]).toBe(puz(s).solution[givenIndex])
  })

  test('filling a blank with the correct value increases correctCount', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const blankIndex = puz(s).givenMask.findIndex((g) => !g)
    const correctValue = puz(s).solution[blankIndex] as number
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: correctValue }, 1)
    expect(nn(s.grids.get('p'))[blankIndex]).toBe(correctValue)
    expect(nn(s.correctCount.get('p'))).toBe(1)
  })

  test('filling a blank with the wrong value does not count, and can be corrected', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const blankIndex = puz(s).givenMask.findIndex((g) => !g)
    const correctValue = puz(s).solution[blankIndex] as number
    const wrongValue = (correctValue % 4) + 1
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: wrongValue }, 1)
    expect(nn(s.correctCount.get('p'))).toBe(0)
    // Corrected once the wrong-digit cooldown has run out.
    const later = 1 + WRONG_DIGIT_COOLDOWN_MS
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: correctValue }, later)
    expect(nn(s.correctCount.get('p'))).toBe(1)
  })

  test('a wrong digit stays on the board and starts a cooldown that ignores fills until it expires', () => {
    const game = new SudokuRace()
    let s = init(['p', 'q'])
    const blanks = puz(s).givenMask.flatMap((g, i) => (g ? [] : [i]))
    const a = blanks[0] as number
    const b = blanks[1] as number
    const wrongA = ((puz(s).solution[a] as number) % 4) + 1
    s = game.onInput(s, 'p', { kind: 'fill', index: a, value: wrongA }, 100)
    expect(nn(s.grids.get('p'))[a]).toBe(wrongA)
    expect(nn(game.snapshot(s, 100).boards.p).cooldownMs).toBe(WRONG_DIGIT_COOLDOWN_MS)
    expect(nn(game.snapshot(s, 600).boards.p).cooldownMs).toBe(WRONG_DIGIT_COOLDOWN_MS - 500)
    // Only the offender is penalized.
    expect(nn(game.snapshot(s, 100).boards.q).cooldownMs).toBe(0)

    // During the cooldown every fill is ignored: another cell, a correction, even a clear.
    const end = 100 + WRONG_DIGIT_COOLDOWN_MS
    s = game.onInput(
      s,
      'p',
      { kind: 'fill', index: b, value: puz(s).solution[b] as number },
      end - 1,
    )
    s = game.onInput(
      s,
      'p',
      { kind: 'fill', index: a, value: puz(s).solution[a] as number },
      end - 1,
    )
    s = game.onInput(s, 'p', { kind: 'fill', index: a, value: 0 }, end - 1)
    expect(nn(s.grids.get('p'))[a]).toBe(wrongA)
    expect(nn(s.grids.get('p'))[b]).toBe(0)
    expect(nn(s.correctCount.get('p'))).toBe(0)

    // Accepted again the moment it expires.
    expect(nn(game.snapshot(s, end).boards.p).cooldownMs).toBe(0)
    s = game.onInput(s, 'p', { kind: 'fill', index: a, value: puz(s).solution[a] as number }, end)
    expect(nn(s.grids.get('p'))[a]).toBe(puz(s).solution[a])
    expect(nn(s.correctCount.get('p'))).toBe(1)
  })

  test('a correct digit or a clear starts no cooldown', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const blanks = puz(s).givenMask.flatMap((g, i) => (g ? [] : [i]))
    const a = blanks[0] as number
    const b = blanks[1] as number
    s = game.onInput(s, 'p', { kind: 'fill', index: a, value: puz(s).solution[a] as number }, 10)
    expect(nn(game.snapshot(s, 10).boards.p).cooldownMs).toBe(0)
    s = game.onInput(s, 'p', { kind: 'fill', index: b, value: 0 }, 11)
    expect(nn(game.snapshot(s, 11).boards.p).cooldownMs).toBe(0)
    // The very next fill lands immediately.
    s = game.onInput(s, 'p', { kind: 'fill', index: b, value: puz(s).solution[b] as number }, 12)
    expect(nn(s.correctCount.get('p'))).toBe(2)
  })

  test('a cell already filled correctly is locked against further edits', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const blankIndex = puz(s).givenMask.findIndex((g) => !g)
    const correctValue = puz(s).solution[blankIndex] as number
    const wrongValue = (correctValue % 4) + 1
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: correctValue }, 1)
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: wrongValue }, 2)
    expect(nn(s.grids.get('p'))[blankIndex]).toBe(correctValue)
    expect(nn(s.correctCount.get('p'))).toBe(1)
  })

  test('a given cell, out-of-range index, or out-of-range value are all rejected', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const givenIndex = puz(s).givenMask.findIndex((g) => g)
    const blankIndex = puz(s).givenMask.findIndex((g) => !g)
    s = game.onInput(s, 'p', { kind: 'fill', index: givenIndex, value: 1 }, 1)
    expect(nn(s.grids.get('p'))[givenIndex]).toBe(puz(s).solution[givenIndex])
    const before = [...nn(s.grids.get('p'))]
    s = game.onInput(s, 'p', { kind: 'fill', index: -1, value: 1 }, 1)
    s = game.onInput(s, 'p', { kind: 'fill', index: 16, value: 1 }, 1)
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: 5 }, 1)
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: -1 }, 1)
    expect(s.grids.get('p')).toEqual(before)
  })

  test('filling every blank correctly finishes the puzzle and locks further input', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const blanks = puz(s).givenMask.flatMap((g, i) => (g ? [] : [i]))
    for (const i of blanks) {
      s = game.onInput(s, 'p', { kind: 'fill', index: i, value: puz(s).solution[i] as number }, 10)
    }
    expect(nn(s.doneAt.get('p'))).toBe(10)
    expect(game.isFinished(s, 10)).toBe(true)
    const afterDone = game.onInput(
      s,
      'p',
      { kind: 'fill', index: blanks[0] as number, value: 0 },
      11,
    )
    expect(afterDone).toBe(s)
  })

  test('a finisher ranks above a non-finisher; among non-finishers, more correct cells ranks higher', () => {
    const game = new SudokuRace()
    let s = init(['a', 'b', 'c'])
    const blanksOf = (id: string) => puz(s, id).givenMask.flatMap((g, i) => (g ? [] : [i]))
    for (const i of blanksOf('a')) {
      s = game.onInput(
        s,
        'a',
        { kind: 'fill', index: i, value: puz(s, 'a').solution[i] as number },
        5,
      )
    }
    const b0 = blanksOf('b')[0] as number
    s = game.onInput(
      s,
      'b',
      { kind: 'fill', index: b0, value: puz(s, 'b').solution[b0] as number },
      6,
    )
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('a')
    expect(result.placements[1]).toBe('b')
    expect(result.placements[2]).toBe('c')
    expect(nn(result.stats).a).toBe('solved')
    expect(nn(result.stats).c).toBe('0/8')
  })

  test('isFinished ends the round at the deadline even with unfinished players', () => {
    const game = new SudokuRace()
    const s = init(['a', 'b'])
    expect(game.isFinished(s, s.endsAt)).toBe(true)
    expect(game.isFinished(s, s.endsAt - 1)).toBe(false)
  })

  test('snapshot exposes givens but never a blank cell solved value', () => {
    const game = new SudokuRace()
    const s = init(['p'])
    const board = nn(game.snapshot(s, 0).boards.p)
    for (let i = 0; i < 16; i++) {
      if (puz(s).givenMask[i]) expect(board.given[i]).toBe(puz(s).solution[i])
      else expect(board.given[i]).toBe(0)
    }
    expect(board.grid).toEqual(nn(s.grids.get('p')))
  })

  test('every puzzle has exactly one solution, with 8 blanks, over many seeds', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const s = init(['a', 'b', 'c'], seeded(seed))
      expect(s.blanksCount).toBe(8)
      for (const id of ['a', 'b', 'c']) {
        const { solution, givenMask } = puz(s, id)
        expect(isValidSudoku(solution)).toBe(true)
        expect(givenMask.filter((g) => !g)).toHaveLength(8)
        const fits = ALL_SOLUTIONS.filter((grid) =>
          grid.every((v, i) => !givenMask[i] || v === solution[i]),
        )
        expect(fits).toEqual([solution])
      }
    }
  })

  test('players race the same puzzle under different symmetries', () => {
    let differs = 0
    for (let seed = 1; seed <= 20; seed++) {
      const s = init(['a', 'b'], seeded(seed))
      const a = puz(s, 'a')
      const b = puz(s, 'b')
      // The same puzzle, dressed differently: givens per line (rows and columns may trade places) and
      // per digit (up to relabelling) match.
      const profile = (p: typeof a) => {
        const given = (i: number) => (p.givenMask[i] ? 1 : 0)
        const lines = [0, 1, 2, 3].flatMap((k) => [
          [0, 1, 2, 3].reduce((n, j) => n + given(k * 4 + j), 0),
          [0, 1, 2, 3].reduce((n, j) => n + given(j * 4 + k), 0),
        ])
        const digits = [1, 2, 3, 4].map(
          (d) => p.solution.filter((v, i) => v === d && given(i)).length,
        )
        return { lines: lines.sort(), digits: digits.sort() }
      }
      expect(profile(a)).toEqual(profile(b))
      if (a.solution.join() !== b.solution.join() || a.givenMask.join() !== b.givenMask.join())
        differs++
    }
    expect(differs).toBeGreaterThan(15)
  })

  test('a leaver is not waited for: the round ends once everyone else has solved theirs', () => {
    const game = new SudokuRace()
    let s = init(['p', 'gone'])
    for (const i of puz(s).givenMask.flatMap((g, k) => (g ? [] : [k]))) {
      s = game.onInput(s, 'p', { kind: 'fill', index: i, value: puz(s).solution[i] as number }, 10)
    }
    expect(game.isFinished(s, 20)).toBe(false)
    s = game.leave(s, 'gone', 20)
    expect(game.isFinished(s, 20)).toBe(true)
  })
})
