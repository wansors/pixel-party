---
name: verify-all
description: Run Pixel Party's full quality gate — Biome lint, the domain determinism check, TypeScript across server/shared/client, server+shared bun tests, the Angular production build, the Vitest client specs and the dependency audit. Use before committing or declaring a change done, and to bootstrap Bun on a machine that lacks it.
---

# Verify everything (the CI gate, locally)

## 0. Bun on the PATH
The repo needs **Bun ≥ 1.3** (`bun --version`). If it's missing and you may not install system-wide,
drop the official binary somewhere private and put it on the PATH for this shell only:
```bash
BUNDIR="${TMPDIR:-/tmp}/pp-bun"; mkdir -p "$BUNDIR" && cd "$BUNDIR"
curl -fsSL -o bun.zip https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip
unzip -o -q bun.zip && ln -sf bun bun-linux-x64/bunx && ln -sf bun bun-linux-x64/node
export PATH="$BUNDIR/bun-linux-x64:$PATH"; cd - && bun install
```
(`node` → bun shim lets the Angular CLI dev server/build run without a Node install — but not the
client specs, see below.)

## 1. The gate (same order as CI — stop at the first failure and fix it)
```bash
bun run lint              # Biome (format + lint); `bun run lint:fix` / `bunx biome check --write <files>`
bun run lint:determinism  # no Math.random / Date.now under apps/server/src/domain
bun run typecheck         # server (incl. tests), shared, client
bun run test              # server + shared suites (bun test, grouped by scripts/test-server.sh)
bun run build:client      # Angular production build — the ONLY check that type-checks templates
```
Client specs (Vitest through Angular's unit-test builder, jsdom — no browser), as CI runs them, and
the dependency audit:
```bash
bun run test:client       # 10 spec files; `ng test --watch=false` under the hood
bun audit                 # known advisories in the dependency tree (0 expected)
```
Vitest's workers need a **real Node**; under the `node` → bun shim they die with `Worker exited
unexpectedly`. Without a system Node, unpack the official LTS tarball privately and put it first on
the PATH:
```bash
V=$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c "import json,sys;print([r['version'] for r in json.load(sys.stdin) if r['lts']][0])")
curl -fsSL "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz" | tar -xJ -C "${TMPDIR:-/tmp}"
export PATH="${TMPDIR:-/tmp}/node-$V-linux-x64/bin:$PATH"
```

## Notes
- `tsc` does **not** type-check Angular templates; a template error only shows up in
  `bun run build:client` or in the running dev server's output. Always run the build after template
  changes.
- The Angular dev server sometimes caches "Could not find stylesheet" for a component whose `.scss`
  was created after the `.ts`; touching the component's `.ts` makes it re-resolve.
- Visual changes also deserve the `playtest-screenshots` skill (desktop + phone).
- Report failures with the actual output; never mark work done with a red gate.
