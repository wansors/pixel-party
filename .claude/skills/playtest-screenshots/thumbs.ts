// Game-picker thumbnail generator (see SKILL.md, D40). Bots host a room and run the given games (all of
// the catalog by default) as one session; a headless Chrome page plays along as "Me", and ~DELAY ms into
// each round the game canvas is captured, center-cropped to 16:10, scaled down and saved as
// `$PP_REPO/apps/client/public/thumbs/<game-id>.webp`. The host bot then skips the round, so a whole
// catalog sweep takes ~10 s per game.
//
// Usage: PP_REPO=<repo root> bun thumbs.ts [<game-id>[,<game-id>...]] [--delay=4500] [--out=<dir>]
//        [--nopoke]  (don't press keys first: for quick games where a stray key ends your round)
//        [--tap=Space:560]  (tap a key every N ms until the shot: keeps a flapping bird in the air)
// Env:   PP_CLIENT (http://localhost:4200)  PP_SERVER (http://localhost:3000)  CHROME (auto-detected)
import { existsSync, mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const REPO = process.env.PP_REPO
if (!REPO) throw new Error('Set PP_REPO=<repo root> (the catalog and the output folder live there)')
const args = process.argv.slice(2)
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const { MINIGAMES } = (await import(`${REPO}/packages/shared/src/catalog/minigames.ts`)) as {
  MINIGAMES: readonly { id: string }[]
}
const idsArg = args.find((a) => !a.startsWith('--'))
const ids = idsArg ? idsArg.split(',') : MINIGAMES.map((g) => g.id)
const DELAY = Number(flag('delay') ?? 4500)
const POKE = !args.includes('--nopoke')
const [TAP_KEY, TAP_MS] = (flag('tap') ?? '').split(':') as [string, string | undefined]
const OUT = flag('out') ?? `${REPO}/apps/client/public/thumbs`
const [TW, TH] = [384, 240]
mkdirSync(OUT, { recursive: true })

const CLIENT = process.env.PP_CLIENT ?? 'http://localhost:4200'
const SERVER = process.env.PP_SERVER ?? 'http://localhost:3000'
const CHROME =
  process.env.CHROME ??
  [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((p) => existsSync(p))
if (!CHROME) throw new Error('No Chrome/Chromium found — set CHROME=/path/to/chrome')

const { code } = (await (await fetch(`${SERVER}/api/rooms`, { method: 'POST' })).json()) as {
  code: string
}
console.log('room', code, '·', ids.length, 'games')

type Msg = { type: string; [k: string]: unknown }
type Strategy = (snapshot: unknown, me: string) => unknown
const bots: WebSocket[] = []
const botIds = new Map<WebSocket, string>()
const botSnaps = new Map<WebSocket, unknown>()
const strategies = new Map<string, Strategy | null>()
async function strategyFor(game: string): Promise<Strategy | null> {
  if (!strategies.has(game)) {
    const file = `${import.meta.dir}/bots/${game}.ts`
    strategies.set(game, existsSync(file) ? ((await import(file)).default as Strategy) : null)
  }
  return strategies.get(game) ?? null
}
function bot(name: string, color: string, avatar: string, onMsg?: (m: Msg) => void): WebSocket {
  // @ts-expect-error Bun-specific constructor options
  const ws = new WebSocket(`${SERVER.replace(/^http/, 'ws')}/ws?room=${code}`, {
    headers: { Origin: CLIENT },
  })
  ws.onopen = () => ws.send(JSON.stringify({ type: 'JOIN', name, color, avatar }))
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as Msg
    if (m.type === 'WELCOME') botIds.set(ws, m.playerId as string)
    if (m.type === 'ROUND_STATE') botSnaps.set(ws, m.state)
    onMsg?.(m)
  }
  bots.push(ws)
  return ws
}

let current = ''
let round = 0
let playing = false
let finished: () => void = () => {}
const done = new Promise<void>((r) => {
  finished = r
})
const saved: string[] = []
const failed: string[] = []

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))

// Canvas → 16:10 center crop → TW×TH webp, done in the page (no image tooling needed here).
async function capture(id: string): Promise<void> {
  const canvas = await page.$('#game-container canvas')
  if (!canvas) throw new Error('no canvas')
  const png = (await canvas.screenshot({ encoding: 'base64' })) as string
  const webp = await page.evaluate(
    async (b64: string, tw: number, th: number) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const want = tw / th
      let sw = img.width
      let sh = img.height
      if (sw / sh > want) sw = Math.round(sh * want)
      else sh = Math.round(sw / want)
      const c = document.createElement('canvas')
      c.width = tw
      c.height = th
      const g = c.getContext('2d') as CanvasRenderingContext2D
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, tw, th)
      return c.toDataURL('image/webp', 0.8).split(',')[1] as string
    },
    png,
    TW,
    TH,
  )
  await Bun.write(`${OUT}/${id}.webp`, Buffer.from(webp, 'base64'))
  saved.push(id)
  console.log('thumb', id)
}

// A few generic presses so the scene shows some action (games ignore keys they don't use).
async function poke(): Promise<void> {
  for (const k of ['ArrowRight', 'Space', 'ArrowUp', 'ArrowLeft'] as const) {
    await page.keyboard.down(k)
    await Bun.sleep(220)
    await page.keyboard.up(k)
  }
  await page.mouse.click(640 * 0.9, 400)
}

const host = bot('HostBot', '#ff3e7f', 'fox', (m) => {
  if (m.type === 'ROUND_INTRO') {
    round = m.round as number
    current = m.minigameId as string
    playing = false
  } else if (m.type === 'ROUND_STATE' && !playing) {
    playing = true
    const g = current
    const r = round
    const tapper = TAP_KEY
      ? setInterval(
          () => void page.keyboard.press(TAP_KEY as 'Space').catch(() => {}),
          Number(TAP_MS ?? 500),
        )
      : undefined
    setTimeout(async () => {
      if (POKE) await poke().catch(() => {})
      await Bun.sleep(Math.max(0, DELAY - (POKE ? 1200 : 0)))
      clearInterval(tapper)
      if (round !== r) return
      await capture(g).catch((e) => {
        failed.push(g)
        console.log('failed', g, String(e))
      })
      host.send(JSON.stringify({ type: 'SKIP_ROUND' }))
    }, 300)
  } else if (m.type === 'ROUND_SKIPPED' || m.type === 'ROUND_RESULT') {
    playing = false
  } else if (m.type === 'FINAL_RANKING') {
    finished()
  }
})
await Bun.sleep(300)
for (const [name, color, avatar] of [
  ['Luna', '#8be94b', 'owl'],
  ['Rex', '#ffcf4b', 'dog'],
] as const)
  bot(name, color, avatar)

// Bots play the game for real when a strategy exists, otherwise send junk the games ignore.
const chatter = setInterval(async () => {
  if (!playing) return
  const play = await strategyFor(current)
  for (const b of bots) {
    const id = botIds.get(b)
    const snap = botSnaps.get(b)
    if (!id) continue
    if (play) {
      if (!snap) continue
      const out = play(snap, id)
      for (const input of Array.isArray(out) ? out : out ? [out] : [])
        b.send(JSON.stringify({ type: 'MINIGAME_INPUT', input }))
      continue
    }
    const r = Math.random()
    const input =
      r < 0.4 ? { kind: 'mash' } : r < 0.7 ? { kind: 'move', x: Math.random() } : { kind: 'tap' }
    b.send(JSON.stringify({ type: 'MINIGAME_INPUT', input }))
  }
}, 150)

await page.goto(`${CLIENT}/room/${code}?name=Me&color=%2329d3f2&avatar=cat`, {
  waitUntil: 'networkidle2',
})
host.send(JSON.stringify({ type: 'HOST_CONFIG', minigameIds: ids, rounds: ids.length }))
await Bun.sleep(1200)
host.send(JSON.stringify({ type: 'START_SESSION' }))
await done
clearInterval(chatter)
for (const b of bots) b.close()
await browser.close()
const missing = ids.filter((id) => !saved.includes(id))
console.log(`saved ${saved.length}/${ids.length} → ${OUT}`)
if (missing.length) console.log('missing:', missing.join(','))
process.exit(missing.length ? 1 : 0)
