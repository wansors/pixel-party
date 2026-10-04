import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { MINIGAMES, TEAM_IDS } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { createMiniGame } from './registry'

// Any client can send any MINIGAME_INPUT. The WS validator only guarantees a JSON object, so every
// game must shrug off objects with the wrong kind, wrong field types, extreme values and stray keys:
// no exception, and no NaN/Infinity reaching the snapshot the clients draw. The corpus is every input
// `kind` and field name the shared wire types declare, mixed at random with hostile values.
const gamesDir = `${import.meta.dir}/../../../../../packages/shared/src/games`
const wire = readdirSync(gamesDir)
  .map((f) => readFileSync(`${gamesDir}/${f}`, 'utf8'))
  .join('\n')
const KINDS = [...new Set([...wire.matchAll(/kind: '([a-zA-Z-]+)'/g)].map((m) => m[1] as string))]
const FIELDS = [...new Set([...wire.matchAll(/\b([a-z][a-zA-Z]{0,14})\??: /g)].map((m) => m[1]))]
const VALUES: unknown[] = [
  null,
  true,
  false,
  -1,
  0,
  1,
  2,
  7,
  2.5,
  -0.5,
  1e9,
  -1e9,
  1e308,
  -1e308,
  99999999999,
  'x',
  '',
  'up',
  'left',
  'red',
  '__proto__',
  [],
  {},
  [1, 2],
  [[0, 0]],
  { x: 1 },
]

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function nonFinite(v: unknown, path: string): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path}=${v}`
  if (!v || typeof v !== 'object') return null
  for (const [k, x] of Object.entries(v)) {
    const bad = nonFinite(x, `${path}.${k}`)
    if (bad) return bad
  }
  return null
}

describe('every mini-game survives malformed inputs', () => {
  for (const meta of MINIGAMES) {
    test(meta.id, () => {
      const rnd = lcg(meta.id.length * 7919)
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T
      const junk = (): unknown => {
        const o: Record<string, unknown> = {}
        if (rnd() < 0.9) o.kind = pick(KINDS)
        for (let i = Math.floor(rnd() * 4); i > 0; i--) {
          o[rnd() < 0.9 ? (pick(FIELDS) as string) : '__proto__'] = pick(VALUES)
        }
        return JSON.parse(JSON.stringify(o)) // exactly what arrives over the wire
      }
      for (const n of new Set([meta.players.min, meta.players.max])) {
        const game = createMiniGame(meta.id)
        if (!game) throw new Error(`${meta.id}: no factory`)
        const players = Array.from(
          { length: Math.max(n, meta.format === 'team' ? 2 : 1) },
          (_, i) => `p${i}`,
        )
        const teams =
          meta.format === 'team'
            ? Object.fromEntries(players.map((p, i) => [p, TEAM_IDS[i % 2]]))
            : undefined
        let now = 1_000_000
        let state = game.init({ players, seed: 7, random: new SeededRandom(7), now, teams })
        for (let i = 0; i < 1500; i++) {
          state = game.onInput(state, pick(players), junk(), now)
          if (i % 5 === 0) {
            now += 50
            if (game.tick) state = game.tick(state, 50, now)
          }
          if (i % 250 === 0) {
            const snap = game.snapshot ? game.snapshot(state, now) : state
            expect(nonFinite(snap, 'snapshot')).toBeNull()
            game.isFinished(state, now)
          }
        }
        if (game.leave) state = game.leave(state, 'p0', now)
        game.getResult(state)
      }
    })
  }
})
