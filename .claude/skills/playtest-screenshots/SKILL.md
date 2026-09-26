---
name: playtest-screenshots
description: Visually check Pixel Party in a real browser by simulating a full session — WS bots host a room while headless Chrome plays as a player and screenshots every phase (join, lobby, round intro, gameplay, round result, final). Use to verify UI/scene changes, reproduce rendering bugs, or review a mini-game on desktop and phone sizes.
---

# Playtest screenshots (bots + headless Chrome)

`shoot.ts` (next to this file) drives a whole session: a bot creates the room over `/api/rooms`,
becomes host, configures the requested mini-games and starts; two guest bots send generic junk inputs;
a headless Chrome page joins as the non-host player **"Me"** and is screenshotted at each phase.

## 1. Servers must be running
```bash
bun run dev   # or, in two background shells:
# NODE_ENV=development bun run --watch apps/server/src/index.ts
# bun run --filter client start
```
The client dev server live-reloads, so edit → re-shoot without restarting.

## 2. One-time driver setup (outside the repo — puppeteer is NOT a project dependency)
```bash
WORK="${TMPDIR:-/tmp}/pp-playtest"; mkdir -p "$WORK"
cp .claude/skills/playtest-screenshots/shoot.ts "$WORK/"
cd "$WORK" && [ -d node_modules/puppeteer-core ] || { echo '{"private":true}' > package.json; bun add puppeteer-core@23; }
```
(Re-copy `shoot.ts` if the skill's copy changed.) Uses the system Chrome/Chromium (`CHROME=` to
override).

## 3. Shoot
```bash
cd "$WORK" && timeout 180 bun shoot.ts <tag> 1280x800 fruit-catch,simon --join --lobby --me-host
cd "$WORK" && timeout 180 bun shoot.ts <tag>-phone 390x844 fruit-catch
```
- Flags: `--join` also shoots the entry screen, `--lobby` the lobby, `--me-host` makes the browser
  player the host (host-only lobby controls; it presses START itself), `--lang=es` runs the UI in
  Spanish (check that longer Spanish strings still fit).
- Output: `$WORK/shots/<tag>/NNN-<phase>.png` — look at them with the Read tool.
- Per game: `-intro` (≈1.8 s into the countdown), `-play1` (≈1.5 s into the round), `-play2` (after a
  few clicks + Space, ≈4 s later), `-finish` (the frozen last frame with the FINISH stamp),
  `-result`; then `final`.
- The driver prints page console errors/warnings (deduplicated). `[<game-id>] frame failed` means a
  scene threw inside its frame hook; `Missing translation` means an i18n gap.
- Use unique tags when several agents shoot in parallel, and keep runs targeted (each costs a Chrome
  plus a full round's duration).
- Team games get real teams (the lobby assigns them when the line-up has a team game). Bots never
  play properly, so opponents look idle and turn-based games mostly show waiting states.

## Checklist when reviewing shots
Nothing clipped or overlapping at 1280x800 **and** 390x844; the HUD strip (score chip, seconds,
draining bar) fully visible; one obvious "what do I do now" prompt; player identity colors used for
other players; end/waiting states show a banner; no console errors.
