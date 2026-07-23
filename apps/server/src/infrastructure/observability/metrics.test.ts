import { describe, expect, test } from 'bun:test'
import { createMetrics } from './metrics'

describe('createMetrics', () => {
  test('counts and accumulates by key', () => {
    const m = createMetrics()
    m.inc('players_joined')
    m.inc('players_joined')
    m.inc('rooms_created', 3)
    expect(m.snapshot()).toEqual({ players_joined: 2, rooms_created: 3 })
  })

  test('snapshot omits untouched keys', () => {
    const m = createMetrics()
    m.inc('errors')
    expect(m.snapshot()).toEqual({ errors: 1 })
  })
})
