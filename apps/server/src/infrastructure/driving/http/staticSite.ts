import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

// Party mode: the game server also serves the production client build, so a LAN party is one process on
// one port (the page, /api and /ws share an origin). Loaded once at boot: text assets are gzipped up
// front, Angular's hashed bundles are cached for good, index.html never is, and client routes
// (/room/ABCD) fall back to index.html.
export interface StaticSite {
  // The response for a GET/HEAD of a site path, or null when it isn't one (the caller 404s).
  serve(req: Request): Response | null
}

interface Asset {
  file: string
  type: string
  cache: string
  gzip?: Uint8Array<ArrayBuffer>
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg'])
// Angular's output hashing: `main-YIJL4BYC.js`, `chunk-…`, `styles-…`.
const HASHED = /-[A-Z0-9]{8}\.(js|css)$/
const FOREVER = 'public, max-age=31536000, immutable'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

export function loadStaticSite(dir: string): StaticSite | null {
  if (!existsSync(join(dir, 'index.html'))) return null
  const assets = new Map<string, Asset>()
  for (const file of walk(dir)) {
    const path = `/${relative(dir, file).split('\\').join('/')}`
    const ext = extname(file)
    assets.set(path, {
      file,
      type: TYPES[ext] ?? 'application/octet-stream',
      cache:
        path === '/index.html' ? 'no-cache' : HASHED.test(path) ? FOREVER : 'public, max-age=3600',
      gzip: COMPRESSIBLE.has(ext)
        ? (Bun.gzipSync(readFileSync(file)) as Uint8Array<ArrayBuffer>)
        : undefined,
    })
  }
  const index = assets.get('/index.html') as Asset
  return {
    serve(req) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return null
      const path = decodeURIComponent(new URL(req.url).pathname)
      const asset = assets.get(path) ?? (extname(path) === '' ? index : undefined)
      if (!asset) return null
      const headers: Record<string, string> = {
        'content-type': asset.type,
        'cache-control': asset.cache,
      }
      if (asset.gzip && (req.headers.get('accept-encoding') ?? '').includes('gzip')) {
        return new Response(asset.gzip, {
          headers: { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' },
        })
      }
      return new Response(Bun.file(asset.file), { headers })
    },
  }
}
