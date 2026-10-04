import { describe, expect, test } from 'bun:test'
import { MEMORY_FLASH_COLORS } from '@pp/shared'
import type { Random } from '../ports/Random'
import { MemoryFlash, type MemoryFlashState } from './memoryFlash'

const half: Random = { next: () => 0.5 }
const init = (players: string[]): MemoryFlashState =>
  new MemoryFlash().init({ players, seed: 1, random: half, now: 0, config: { durationMs: 40_000 } })

// The right count for a level, and a listed choice that is wrong.
const right = (s: MemoryFlashState, level: number): number => s.answers[level] as number
const wrong = (s: MemoryFlashState, level: number): number =>
  s.boards[level]?.choices.find((c) => c !== right(s, level)) as number
const answer = (level: number, value: number) => ({ kind: 'answer' as const, level, value })

describe('MemoryFlash', () => {
  test('the true count is never on the wire, only the choices (which include it)', () => {
    const game = new MemoryFlash()
    const s = init(['a'])
    const snap = game.snapshot(s, 0)
    expect(snap.at.a).toBe(0)
    const board = snap.boards.find((b) => b.level === snap.at.a)
    expect(board?.choices).toContain(right(s, 0))
    expect(board).not.toHaveProperty('answer')
  })

  test('the packed burst holds exactly the cells drawn, and the target count matches the answer', () => {
    const s = init(['a'])
    s.boards.forEach((board, level) => {
      expect(board.cells).toHaveLength(board.cols * board.rows)
      expect(board.cells).toMatch(/^[.0-3]+$/)
      const target = MEMORY_FLASH_COLORS.findIndex((c) => c.hex === board.targetColor)
      const count = [...board.cells].filter((ch) => ch === String(target)).length
      expect(count).toBe(right(s, level))
    })
  })

  test('a board shared by several players goes on the wire once', () => {
    const game = new MemoryFlash()
    let s = init(['a', 'b', 'c'])
    s = game.onInput(s, 'c', answer(0, right(s, 0)), 1000)
    const snap = game.snapshot(s, 1000)
    expect(snap.at).toEqual({ a: 0, b: 0, c: 1 })
    expect(snap.boards.map((b) => b.level)).toEqual([0, 1])
  })

  test('a right answer scores; a wrong one advances without scoring; stale levels are dropped', () => {
    const game = new MemoryFlash()
    let s = init(['a'])
    s = game.onInput(s, 'a', answer(0, right(s, 0)), 1000)
    s = game.onInput(s, 'a', answer(1, wrong(s, 1)), 2000)
    s = game.onInput(s, 'a', answer(1, right(s, 1)), 2100) // already answered level 1
    expect(s.correct.get('a')).toBe(1)
    expect(s.pointer.get('a')).toBe(2)
  })

  test('the tiebreak is the time of the last CORRECT answer — misses never move it', () => {
    const game = new MemoryFlash()
    let s = init(['a', 'b'])
    // Both get level 0 right; a at 1 s, b at 2 s. Then a misses three times, quickly.
    s = game.onInput(s, 'a', answer(0, right(s, 0)), 1000)
    s = game.onInput(s, 'b', answer(0, right(s, 0)), 2000)
    for (let level = 1; level <= 3; level++) {
      s = game.onInput(s, 'a', answer(level, wrong(s, level)), 2000 + level * 1000)
    }
    expect(s.lastClearMs.get('a')).toBe(1000)
    const r = game.getResult(s)
    expect(r.placements).toEqual(['a', 'b'])
    expect(r.ranks).toEqual({ a: 0, b: 1 })
  })

  test('a leaver is skipped to the end so the round finishes once the rest are done', () => {
    const game = new MemoryFlash()
    let s = init(['a', 'gone'])
    for (let level = 0; level < s.boards.length; level++) {
      s = game.onInput(s, 'a', answer(level, right(s, level)), 100 + level)
    }
    expect(game.isFinished(s, 500)).toBe(false)
    s = game.leave(s, 'gone', 500)
    expect(game.isFinished(s, 500)).toBe(true)
    expect(game.snapshot(s, 500).at.gone).toBeNull()
  })
})
