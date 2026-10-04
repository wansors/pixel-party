// Release version for CI (docs/docker.md → "Releases"). Every push to develop that passes the gate is
// a release: this picks its version, writes it everywhere the app reads it, and prints it.
//
//   bun scripts/release-version.ts            auto: minor bump, major when a commit says it breaks
//   bun scripts/release-version.ts minor      force a bump kind (major | minor | patch)
//
// No tag for the current version yet (the very first release) → release it as is, no bump.
// Otherwise bump from the commits since that tag: BREAKING CHANGE / `type!:` → major, else minor (the
// trunk ships every change as at least a minor). Files: every package.json + packages/shared's
// APP_VERSION (version.test.ts keeps those two in step).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Bump = 'major' | 'minor' | 'patch'

const ROOT = join(import.meta.dir, '..')
const PACKAGES = [
  'package.json',
  'apps/client/package.json',
  'apps/server/package.json',
  'packages/shared/package.json',
].map((p) => join(ROOT, p))
const VERSION_TS = join(ROOT, 'packages/shared/src/version.ts')

export function nextVersion(current: string, bump: Bump): string {
  const [major = 0, minor = 0, patch = 0] = current.split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

// Conventional-commit breaking markers in any message since the last release.
export function bumpFromCommits(messages: readonly string[]): Bump {
  const breaking = messages.some(
    (m) => /^[a-z]+(\([^)]*\))?!:/.test(m) || /^BREAKING[ -]CHANGE:/m.test(m),
  )
  return breaking ? 'major' : 'minor'
}

const git = (...args: string[]): string => {
  const out = Bun.spawnSync(['git', ...args], { cwd: ROOT })
  return out.success ? out.stdout.toString().trim() : ''
}

function main(): void {
  const current = JSON.parse(readFileSync(PACKAGES[0] as string, 'utf8')).version as string
  const tag = `v${current}`
  if (!git('tag', '--list', tag)) {
    console.log(current)
    return
  }
  const forced = process.argv[2] as Bump | undefined
  if (forced && !['major', 'minor', 'patch'].includes(forced)) {
    throw new Error(`unknown bump "${forced}" (major | minor | patch)`)
  }
  const messages = git('log', '--format=%B%x00', `${tag}..HEAD`)
    .split('\0')
    .map((m) => m.trim())
  const next = nextVersion(current, forced ?? bumpFromCommits(messages))
  // Targeted replaces keep each file's own formatting.
  for (const file of PACKAGES) {
    const text = readFileSync(file, 'utf8')
    writeFileSync(file, text.replace(/"version": "[^"]+"/, `"version": "${next}"`))
  }
  const ts = readFileSync(VERSION_TS, 'utf8')
  writeFileSync(VERSION_TS, ts.replace(/APP_VERSION = '[^']+'/, `APP_VERSION = '${next}'`))
  console.log(next)
}

if (import.meta.main) main()
