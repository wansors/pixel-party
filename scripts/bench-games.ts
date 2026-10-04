// Server-side performance bench (launch audit): every mini-game at N players (default 12), driven by
// the playtest bots where one exists (else generic junk inputs), for its full catalog duration at the
// engine's 20 Hz tick. Per game it reports the cost of a tick (simulation + building and serialising the
// snapshot on the ticks that publish one: avg / p99 / max) and the snapshot size (avg / max), plus the
// bandwidth each client receives. A warm-up run comes first so JIT compilation doesn't skew the numbers.
//
// Usage: bun scripts/bench-games.ts [--players=12] [--only=id,id] [--json]
import { existsSync } from 'node:fs'
import type { MiniGame } from '../apps/server/src/domain/minigames/MiniGame'
import { createMiniGame } from '../apps/server/src/domain/minigames/registry'
import { SeededRandom } from '../apps/server/src/infrastructure/driven/random/SeededRandom'
import { MINIGAMES, type MiniGameMeta } from '../packages/shared/src'

const REPO = `${import.meta.dir}/..`
process.env.PP_REPO ??= REPO
const flag = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const PLAYERS = Number(flag('players') ?? 12)
const ONLY = flag('only')?.split(',')
const TICK_HZ = 20
const SNAPSHOT_EVERY = 3
const DT = 1000 / TICK_HZ
const BOT_EVERY_MS = 150

type Strategy = (snapshot: unknown, me: string) => unknown
async function botFor(id: string): Promise<Strategy | null> {
  const file = `${REPO}/.claude/skills/playtest-screenshots/bots/${id}.ts`
  return existsSync(file) ? ((await import(file)).default as Strategy) : null
}

// Same generic junk the playtest's guest bots send to games without a strategy module.
function junk(r: SeededRandom): unknown {
  const x = r.next()
  if (x < 0.3) return { kind: 'mash' }
  if (x < 0.5) return { kind: 'tap' }
  if (x < 0.8) return { kind: 'move', x: r.next() }
  return { kind: 'dir', dir: ['up', 'down', 'left', 'right'][Math.floor(r.next() * 4)] }
}

interface Row {
  id: string
  bot: boolean
  ticks: number
  avgMs: number
  p99Ms: number
  maxMs: number
  avgKB: number
  maxKB: number
  kbps: number
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
}

async function run(meta: MiniGameMeta): Promise<Row> {
  const game = createMiniGame(meta.id) as MiniGame<unknown, unknown>
  const players = Array.from({ length: PLAYERS }, (_, i) => `p${String(i).padStart(2, '0')}`)
  const teams =
    meta.format === 'team'
      ? Object.fromEntries(players.map((p, i) => [p, i % 2 === 0 ? 'red' : 'blue'] as const))
      : undefined
  const durationMs = (meta.durationSec || 10) * 1000
  const random = new SeededRandom(7)
  const noise = new SeededRandom(11)
  let state = game.init({ players, seed: 7, random, now: 0, teams, config: { durationMs } })
  const bot = await botFor(meta.id)
  let snap: unknown = game.snapshot ? game.snapshot(state, 0) : state
  const costs: number[] = []
  const sizes: number[] = []
  let now = 0
  for (let tick = 1; now < durationMs + 20_000; tick++) {
    now += DT
    if (now % BOT_EVERY_MS < DT) {
      for (const p of players) {
        const out = bot ? bot(snap, p) : junk(noise)
        for (const input of Array.isArray(out) ? out : out ? [out] : []) {
          state = game.onInput(state, p, input, now)
        }
      }
    }
    const t0 = performance.now()
    if (game.tick) state = game.tick(state, DT, now)
    if (tick % SNAPSHOT_EVERY === 0) {
      snap = game.snapshot ? game.snapshot(state, now) : state
      const json = JSON.stringify(snap)
      sizes.push(json.length)
      snap = JSON.parse(json)
    }
    costs.push(performance.now() - t0)
    if (game.isFinished(state, now)) break
  }
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
  const avgBytes = sizes.length ? sum(sizes) / sizes.length : 0
  return {
    id: meta.id,
    bot: bot !== null,
    ticks: costs.length,
    avgMs: sum(costs) / Math.max(1, costs.length),
    p99Ms: pct(costs, 0.99),
    maxMs: Math.max(0, ...costs),
    avgKB: avgBytes / 1024,
    maxKB: Math.max(0, ...sizes) / 1024,
    kbps: (avgBytes / 1024) * (TICK_HZ / SNAPSHOT_EVERY),
  }
}

const rows: Row[] = []
for (const meta of MINIGAMES) {
  if (ONLY && !ONLY.includes(meta.id)) continue
  await run(meta) // warm-up
  rows.push(await run(meta))
}
rows.sort((a, b) => b.p99Ms - a.p99Ms)
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  const f = (n: number, d = 2): string => n.toFixed(d).padStart(7)
  console.log(`${PLAYERS} players · tick ${TICK_HZ} Hz · snapshot every ${SNAPSHOT_EVERY} ticks`)
  console.log(
    'game                  bot  ticks  avg ms  p99 ms  max ms  avg KB  max KB  KB/s/client',
  )
  for (const r of rows) {
    console.log(
      `${r.id.padEnd(21)} ${r.bot ? 'yes' : ' - '} ${String(r.ticks).padStart(6)} ${f(r.avgMs, 3)} ${f(r.p99Ms, 3)} ${f(r.maxMs, 3)} ${f(r.avgKB)} ${f(r.maxKB)} ${f(r.kbps, 1)}`,
    )
  }
}
