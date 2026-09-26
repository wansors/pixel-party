import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { SudokuRace, WRONG_DIGIT_COOLDOWN_MS } from './sudokuRace'

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
    expect(a.solution).toEqual(b.solution)
    expect(isValidSudoku(a.solution)).toBe(true)
  })

  test('builds a valid sudoku across varied random draws too', () => {
    const r = cycling([0.1, 0.9, 0.3, 0.7, 0.05, 0.99, 0.4, 0.6, 0.2, 0.8])
    const s = init(['p'], r)
    expect(isValidSudoku(s.solution)).toBe(true)
  })

  test('exactly BLANKS cells are blank and the rest are locked givens', () => {
    const s = init(['p'])
    const blanks = s.givenMask.filter((g) => !g).length
    expect(blanks).toBe(8)
    expect(s.blanksCount).toBe(8)
    expect(s.givenMask.length).toBe(16)
  })

  test('a given cell starts pre-filled with the solved value on every player board', () => {
    const s = init(['p'])
    const givenIndex = s.givenMask.findIndex((g) => g)
    expect(nn(s.grids.get('p'))[givenIndex]).toBe(s.solution[givenIndex])
  })

  test('filling a blank with the correct value increases correctCount', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const blankIndex = s.givenMask.findIndex((g) => !g)
    const correctValue = s.solution[blankIndex] as number
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: correctValue }, 1)
    expect(nn(s.grids.get('p'))[blankIndex]).toBe(correctValue)
    expect(nn(s.correctCount.get('p'))).toBe(1)
  })

  test('filling a blank with the wrong value does not count, and can be corrected', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const blankIndex = s.givenMask.findIndex((g) => !g)
    const correctValue = s.solution[blankIndex] as number
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
    const blanks = s.givenMask.flatMap((g, i) => (g ? [] : [i]))
    const a = blanks[0] as number
    const b = blanks[1] as number
    const wrongA = ((s.solution[a] as number) % 4) + 1
    s = game.onInput(s, 'p', { kind: 'fill', index: a, value: wrongA }, 100)
    expect(nn(s.grids.get('p'))[a]).toBe(wrongA)
    expect(nn(game.snapshot(s, 100).boards.p).cooldownMs).toBe(WRONG_DIGIT_COOLDOWN_MS)
    expect(nn(game.snapshot(s, 600).boards.p).cooldownMs).toBe(WRONG_DIGIT_COOLDOWN_MS - 500)
    // Only the offender is penalized.
    expect(nn(game.snapshot(s, 100).boards.q).cooldownMs).toBe(0)

    // During the cooldown every fill is ignored: another cell, a correction, even a clear.
    const end = 100 + WRONG_DIGIT_COOLDOWN_MS
    s = game.onInput(s, 'p', { kind: 'fill', index: b, value: s.solution[b] as number }, end - 1)
    s = game.onInput(s, 'p', { kind: 'fill', index: a, value: s.solution[a] as number }, end - 1)
    s = game.onInput(s, 'p', { kind: 'fill', index: a, value: 0 }, end - 1)
    expect(nn(s.grids.get('p'))[a]).toBe(wrongA)
    expect(nn(s.grids.get('p'))[b]).toBe(0)
    expect(nn(s.correctCount.get('p'))).toBe(0)

    // Accepted again the moment it expires.
    expect(nn(game.snapshot(s, end).boards.p).cooldownMs).toBe(0)
    s = game.onInput(s, 'p', { kind: 'fill', index: a, value: s.solution[a] as number }, end)
    expect(nn(s.grids.get('p'))[a]).toBe(s.solution[a])
    expect(nn(s.correctCount.get('p'))).toBe(1)
  })

  test('a correct digit or a clear starts no cooldown', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const blanks = s.givenMask.flatMap((g, i) => (g ? [] : [i]))
    const a = blanks[0] as number
    const b = blanks[1] as number
    s = game.onInput(s, 'p', { kind: 'fill', index: a, value: s.solution[a] as number }, 10)
    expect(nn(game.snapshot(s, 10).boards.p).cooldownMs).toBe(0)
    s = game.onInput(s, 'p', { kind: 'fill', index: b, value: 0 }, 11)
    expect(nn(game.snapshot(s, 11).boards.p).cooldownMs).toBe(0)
    // The very next fill lands immediately.
    s = game.onInput(s, 'p', { kind: 'fill', index: b, value: s.solution[b] as number }, 12)
    expect(nn(s.correctCount.get('p'))).toBe(2)
  })

  test('a cell already filled correctly is locked against further edits', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const blankIndex = s.givenMask.findIndex((g) => !g)
    const correctValue = s.solution[blankIndex] as number
    const wrongValue = (correctValue % 4) + 1
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: correctValue }, 1)
    s = game.onInput(s, 'p', { kind: 'fill', index: blankIndex, value: wrongValue }, 2)
    expect(nn(s.grids.get('p'))[blankIndex]).toBe(correctValue)
    expect(nn(s.correctCount.get('p'))).toBe(1)
  })

  test('a given cell, out-of-range index, or out-of-range value are all rejected', () => {
    const game = new SudokuRace()
    let s = init(['p'])
    const givenIndex = s.givenMask.findIndex((g) => g)
    const blankIndex = s.givenMask.findIndex((g) => !g)
    s = game.onInput(s, 'p', { kind: 'fill', index: givenIndex, value: 1 }, 1)
    expect(nn(s.grids.get('p'))[givenIndex]).toBe(s.solution[givenIndex])
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
    const blanks = s.givenMask.flatMap((g, i) => (g ? [] : [i]))
    for (const i of blanks) {
      s = game.onInput(s, 'p', { kind: 'fill', index: i, value: s.solution[i] as number }, 10)
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
    const blanks = s.givenMask.flatMap((g, i) => (g ? [] : [i]))
    for (const i of blanks) {
      s = game.onInput(s, 'a', { kind: 'fill', index: i, value: s.solution[i] as number }, 5)
    }
    s = game.onInput(
      s,
      'b',
      {
        kind: 'fill',
        index: blanks[0] as number,
        value: s.solution[blanks[0] as number] as number,
      },
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
    const snap = game.snapshot(s, 0)
    for (let i = 0; i < 16; i++) {
      if (s.givenMask[i]) expect(snap.given[i]).toBe(s.solution[i])
      else expect(snap.given[i]).toBe(0)
    }
    expect(nn(snap.boards.p).grid).toEqual(nn(s.grids.get('p')))
  })
})
