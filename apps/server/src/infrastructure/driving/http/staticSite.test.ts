import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadStaticSite } from './staticSite'

const dir = mkdtempSync(join(tmpdir(), 'pp-site-'))
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Pixel Party</title>')
writeFileSync(join(dir, 'main-ABCD1234.js'), 'console.log("hi")'.repeat(50))
mkdirSync(join(dir, 'fonts'))
writeFileSync(join(dir, 'fonts', 'pixel.woff2'), 'woff')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const site = loadStaticSite(dir)
const get = (path: string, gzip = false): Response | null =>
  site?.serve(
    new Request(`http://party.local${path}`, {
      headers: gzip ? { 'accept-encoding': 'gzip, br' } : {},
    }),
  ) ?? null

describe('loadStaticSite (party mode)', () => {
  test('is null when there is no build', () => {
    expect(loadStaticSite(join(dir, 'missing'))).toBeNull()
  })

  test('hashed bundles are cached for good and gzipped when the browser accepts it', async () => {
    const res = get('/main-ABCD1234.js', true)
    expect(res?.headers.get('cache-control')).toContain('immutable')
    expect(res?.headers.get('content-encoding')).toBe('gzip')
    expect(
      new TextDecoder().decode(
        Bun.gunzipSync(new Uint8Array((await res?.arrayBuffer()) as ArrayBuffer)),
      ),
    ).toContain('console.log')
  })

  test('client routes fall back to a never-cached index.html', async () => {
    const res = get('/room/ABCD')
    expect(res?.headers.get('content-type')).toContain('text/html')
    expect(res?.headers.get('cache-control')).toBe('no-cache')
    expect(await res?.text()).toContain('Pixel Party')
  })

  test('a missing file is not the site (the caller 404s); nested assets are served', () => {
    expect(get('/nope.js')).toBeNull()
    expect(get('/fonts/pixel.woff2')?.headers.get('content-type')).toBe('font/woff2')
  })
})
