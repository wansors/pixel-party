// Renders docs/promo/promo.html to an MP4 (see README.md next to this file).
//
// Serves the repo over HTTP (Chrome refuses web fonts from file:// pages), opens the page in headless
// Chrome in render mode, steps the timeline frame by frame through window.__seek(t), pipes every
// frame as a PNG into ffmpeg and muxes the soundtrack ("Pixel Party Panic", faded out at the end).
//
// Usage (from a folder where puppeteer-core is installed — see README):
//   bun render.ts <repo-root> <out.mp4> [--fps=30] [--scale=1.5] [--stills=2,9.5,20]
// --scale multiplies the 1280x720 stage (1.5 → 1920x1080). --stills writes PNGs of single moments
// instead of a video (handy to preview composition quickly).
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const [rootArg, outArg, ...flags] = process.argv.slice(2)
if (!rootArg || !outArg) {
  console.error(
    'usage: bun render.ts <repo-root> <out.mp4> [--fps=30] [--scale=1.5] [--stills=t,t]',
  )
  process.exit(1)
}
const root = resolve(rootArg)
const flag = (name: string): string | undefined =>
  flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3)
const fps = Number(flag('fps') ?? 30)
const scale = Number(flag('scale') ?? 1.5)
const stills = flag('stills')
  ?.split(',')
  .map(Number)
  .filter((n) => Number.isFinite(n))
const chrome =
  process.env.CHROME ??
  ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) =>
    existsSync(p),
  )
if (!chrome) throw new Error('No Chrome/Chromium found — set CHROME=/path/to/chrome')

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname)
    const file = Bun.file(`${root}${path}`)
    return new Response(file)
  },
})

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--mute-audio', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: scale })
page.on('pageerror', (e) => console.error('[pageerror]', String(e)))
await page.goto(`http://localhost:${server.port}/docs/promo/promo.html?render=1`, {
  waitUntil: 'networkidle0',
})
await page.evaluate(() => (window as unknown as { __ready: Promise<void> }).__ready)
const duration = await page.evaluate(() => (window as unknown as { __duration: number }).__duration)

// Seek, then wait one animation frame so layout and canvases are painted before the capture.
const frameAt = async (t: number): Promise<Uint8Array> => {
  await page.evaluate(
    (time) =>
      new Promise<void>((done) => {
        ;(window as unknown as { __seek: (t: number) => void }).__seek(time)
        requestAnimationFrame(() => done())
      }),
    t,
  )
  return page.screenshot({ type: 'png' })
}

if (stills) {
  for (const t of stills) {
    const file = `${outArg.replace(/\.[a-z0-9]+$/i, '')}-${t.toFixed(2)}s.png`
    await Bun.write(file, await frameAt(t))
    console.log('still', file)
  }
} else {
  const song = `${root}/apps/client/public/audio/background-song.mp3`
  const fadeAt = Math.max(0, duration - 2.2)
  const ffmpeg = Bun.spawn(
    [
      'ffmpeg',
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-i',
      '-',
      '-i',
      song,
      '-filter_complex',
      `[1:a]atrim=0:${duration.toFixed(3)},afade=t=out:st=${fadeAt.toFixed(3)}:d=2.2[a]`,
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-preset',
      'medium',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      outArg,
    ],
    { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' },
  )
  const frames = Math.ceil(duration * fps)
  const started = Date.now()
  for (let i = 0; i < frames; i++) {
    ffmpeg.stdin.write(await frameAt(i / fps))
    if (i % fps === 0) {
      const elapsed = (Date.now() - started) / 1000
      console.log(`frame ${i}/${frames}  (${elapsed.toFixed(0)} s)`)
    }
  }
  await ffmpeg.stdin.end()
  const code = await ffmpeg.exited
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`)
  console.log('video', outArg, `${duration.toFixed(1)} s @ ${fps} fps`)
}

await browser.close()
server.stop(true)
process.exit(0)
