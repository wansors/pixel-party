// Playtest screenshot driver (see SKILL.md). A WebSocket bot creates + hosts a room with two more bots,
// configures the given mini-games and starts the session, while a headless Chrome page plays as a
// regular (non-host) player "Me". PNGs of every phase (lobby, intro, play, result, final) land in
// $PP_SHOTS_DIR/<tag>/ (default ./shots/<tag>/).
//
// Usage: bun shoot.ts <tag> <width>x<height> <game-id>[,<game-id>...] [--join] [--lobby] [--me-host]
//        [--lang=es]
// Env:   PP_CLIENT (http://localhost:4200)  PP_SERVER (http://localhost:3000)
//        CHROME (auto-detected)  PP_SHOTS_DIR (./shots)
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const [tag = 'run', size = '1280x800', idsArg = 'button-masher', ...flags] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number) as [number, number]
const ids = idsArg.split(',')
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
const dir = `${process.env.PP_SHOTS_DIR ?? `${process.cwd()}/shots`}/${tag}`
await Bun.$`mkdir -p ${dir}`

const { code } = (await (await fetch(`${SERVER}/api/rooms`, { method: 'POST' })).json()) as {
  code: string
}
console.log('room', code)

type Msg = { type: string; [k: string]: unknown }
const bots: WebSocket[] = []
const listeners: ((m: Msg) => void)[] = []
function bot(name: string, color: string, avatar: string, onMsg?: (m: Msg) => void): WebSocket {
  // Bun's WebSocket accepts headers; the server's origin allowlist admits the dev client origin.
  // @ts-expect-error Bun-specific constructor options
  const ws = new WebSocket(`${SERVER.replace(/^http/, 'ws')}/ws?room=${code}`, {
    headers: { Origin: CLIENT },
  })
  ws.onopen = () => ws.send(JSON.stringify({ type: 'JOIN', name, color, avatar }))
  ws.onmessage = (e) => onMsg?.(JSON.parse(String(e.data)) as Msg)
  bots.push(ws)
  return ws
}
let lastLobby: { players: { id: string; name: string }[] } | undefined
const host = bot('HostBot', '#ff3e7f', 'fox', (m) => {
  if (m.type === 'LOBBY_STATE') lastLobby = m as unknown as typeof lastLobby
  for (const l of listeners) l(m)
})
await Bun.sleep(300)
bot('Luna', '#8be94b', 'owl')
bot('Rex', '#ffcf4b', 'dog')

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
// --lang=es: preselect the UI language (LanguageService reads localStorage `pp_lang`).
const lang = flags.find((f) => f.startsWith('--lang='))?.slice('--lang='.length)
if (lang) {
  await page.evaluateOnNewDocument((l) => localStorage.setItem('pp_lang', l), lang)
}
const warned = new Set<string>()
page.on('console', async (m) => {
  if (m.type() !== 'error' && m.type() !== 'warn') return
  const parts = await Promise.all(
    m
      .args()
      .map((a) => a.evaluate((e) => (e instanceof Error ? e.stack : String(e))).catch(() => '')),
  )
  const text = parts.join(' ').trim().slice(0, 1500)
  if (!text || warned.has(text)) return
  warned.add(text)
  console.log(`[console.${m.type()}]`, text)
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e)))

let n = 0
const shot = async (name: string): Promise<void> => {
  const file = `${dir}/${String(n++).padStart(3, '0')}-${name}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}

if (flags.includes('--join')) {
  await page.goto(`${CLIENT}/`, { waitUntil: 'networkidle2' })
  await Bun.sleep(800)
  await shot('join')
}
await page.goto(`${CLIENT}/room/${code}?name=Me&color=%2329d3f2&avatar=cat`, {
  waitUntil: 'networkidle2',
})
host.send(JSON.stringify({ type: 'HOST_CONFIG', minigameIds: ids, rounds: ids.length }))
await Bun.sleep(1200)
// --me-host: the bot hands the host role to the browser player, which then starts the session itself
// (so the host-only lobby UI gets screenshotted too).
const meHost = flags.includes('--me-host')
if (meHost && lastLobby) {
  const me = lastLobby.players.find((p) => p.name === 'Me')
  if (me) host.send(JSON.stringify({ type: 'TRANSFER_HOST', playerId: me.id }))
  await Bun.sleep(800)
}
if (flags.includes('--lobby')) await shot('lobby')

// Generic junk inputs from the guest bots so rounds have some opponent activity (each game ignores
// input kinds it doesn't understand).
let playing = false
const chatter = setInterval(() => {
  if (!playing) return
  for (const b of bots.slice(1)) {
    const r = Math.random()
    const input =
      r < 0.3
        ? { kind: 'mash' }
        : r < 0.5
          ? { kind: 'tap' }
          : r < 0.8
            ? { kind: 'move', x: Math.random() }
            : { kind: 'dir', dir: ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)] }
    b.send(JSON.stringify({ type: 'MINIGAME_INPUT', input }))
  }
}, 250)

let current = ''
let round = 0
const done = new Promise<void>((resolve) => {
  listeners.push((m) => {
    if (m.type === 'ROUND_INTRO') {
      round = m.round as number
      current = m.minigameId as string
      playing = false
      setTimeout(() => void shot(`${current}-intro`), 1800)
    } else if (m.type === 'ROUND_STATE' && !playing) {
      playing = true
      const g = current
      const r = round
      setTimeout(async () => {
        if (round !== r) return
        await shot(`${g}-play1`)
        // A few taps around the middle of the canvas + Space, then a second look.
        for (let i = 0; i < 4; i++) {
          await page.mouse.click(w * (0.3 + Math.random() * 0.4), h * (0.35 + Math.random() * 0.4))
          await Bun.sleep(120)
        }
        await page.keyboard.press('Space')
        await Bun.sleep(2500)
        if (round === r && playing) await shot(`${g}-play2`)
      }, 1500)
    } else if (m.type === 'ROUND_STATE' && m.final) {
      // The round's frozen last frame (FINISH stamp), shown for the server's grace period.
      setTimeout(() => void shot(`${current}-finish`), 450)
    } else if (m.type === 'ROUND_RESULT') {
      playing = false
      setTimeout(() => void shot(`${current}-result`), 900)
    } else if (m.type === 'FINAL_RANKING') {
      setTimeout(async () => {
        await shot('final')
        resolve()
      }, 1500)
    }
  })
})
if (meHost) await page.click('button.start')
else host.send(JSON.stringify({ type: 'START_SESSION' }))
await done
clearInterval(chatter)
for (const b of bots) b.close()
await browser.close()
process.exit(0)
