import { describe, expect, test } from 'bun:test'
import { cleanName, MAX_NAME_LEN } from './names'

describe('cleanName', () => {
  test('trims, collapses spaces and drops control or invisible characters', () => {
    expect(cleanName('  Ana   la  rápida ')).toBe('Ana la rápida')
    expect(cleanName('Bob\n\t\u0000')).toBe('Bob')
    expect(cleanName('\u202eevil\u200d')).toBe('evil')
  })

  test('caps the length without splitting a character', () => {
    expect(cleanName('x'.repeat(5000))).toHaveLength(MAX_NAME_LEN)
    expect([...cleanName('🐸'.repeat(40))]).toHaveLength(MAX_NAME_LEN)
  })

  test('blank input stays blank (the server rejects it)', () => {
    expect(cleanName('   ')).toBe('')
    expect(cleanName('\u200b\u200b')).toBe('')
  })
})
