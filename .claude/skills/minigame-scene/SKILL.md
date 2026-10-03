---
name: minigame-scene
description: Build, migrate or polish a Pixel Party mini-game Phaser scene on the shared MiniGameScene base (HUD, juice kit, player colors, responsive layout, i18n), and wire a brand-new mini-game end to end. Use for any change under apps/client/src/game/scenes/ or when adding a game to the catalog.
---

# Mini-game scenes

Read `CLAUDE.md` (layout + "Adding a mini-game") and `docs/art-direction.md` first. The server is
authoritative: scenes render snapshots and send inputs — **never put game rules on the client**.

## Anatomy
```ts
export class SimonScene extends MiniGameScene<SimonSnapshot> {
  constructor(...deps: SceneDeps) {
    super('simon', ...deps)               // scene key === mini-game id
  }
  override create(): void {
    super.create()                        // backdrop + HUD; super.create({ hud: false }) = no HUD
    // reset EVERY per-round field here (scene instances survive across rounds), lay out below this.top
  }
  protected frame(snap: SimonSnapshot | null, time: number, delta: number): void {
    // per-frame render; snap is null until THIS game's first snapshot arrives
  }
}
```
Register it in `game/scenes/index.ts` (`SCENES`) — `scenes/index.spec.ts` fails if the map and the
`MINIGAMES` catalog disagree.

Base API (`game/scenes/MiniGameScene.ts`):
- `this.snap` — this game's snapshot or null. Never read `this.state.state` directly (a stale scene
  reading another game's snapshot froze the canvas).
- `this.selfId`, `this.label(id)` ("you"/name), `this.state.nameOf(id)`, `this.state.colorOf(id, fb)`
  (identity color, 0xRRGGBB — use it wherever other players appear).
- `this.sendInput({ kind, ... })`, `this.sfx` (`click tick go correct wrong coin pop pad(i) win
  fanfare`), `this.t(key, params)`.
- HUD (`game/hud.ts`): time bar + seconds fed automatically from `snap.remainingMs`; override
  `protected remainingMs(snap)` if the field differs (return null = no clock). Own score/progress:
  `this.hud?.setScore(text)`. Don't draw a second timer.
- Crash guard: `frame()` errors are logged once (`[<id>] frame failed`) instead of killing the loop.
- Relayout: a real viewport change restarts the scene — keep layout in `create()` and rebuild state
  from the snapshot.

- FINISH moment: when the server flags the round's final snapshot (`ROUND_STATE.final`), the base
  stamps FINISH! into the HUD and plays a whistle; the frozen last frame stays visible for the
  server's grace period (~1.5 s) before the results screen — make sure your end state reads well.

Shared kit — reuse before writing a private helper (duplicates were hoisted out of 20+ scenes):
- `game/fx.ts`: `floatText` (clamped on screen), `burst`, `ring`, `shake`, `flash` (translucent wash,
  not a blinding full-opacity frame), `punch`, `addBanner` + `showBanner` (32/24 px, auto-shrinks in
  8 px steps to fit the width).
- `game/pixelStyle.ts`: `ensurePixelGrid` (ASCII-art sprites), `ensurePixelOrb`, `ensurePixelBlock`
  (square), `ensureBevelPanel(scene, w, h, color, bevel?, outline?)` (beveled panel at its exact size —
  buttons, tiles, cards), `ensureCardTexture` (+ `CARD_FACE`/`CARD_INK`), `fitText(text, maxW, maxSize)`
  / `fitFontSize(str, maxW, maxSize)` (crisp pixel-font sizes), `teamColor(team)` (0xRRGGBB), `shade`,
  `hexToCss`, `headlineStyle` (Press Start 2P) / `bodyStyle` (monospace).
- **Players are always their lobby avatar** (`art-direction.md` §6.1; never a per-scene figure):
  - `game/avatars.ts`: `new AvatarSprite(scene, avatarOf(id), colorOf(id), avatarPx(maxPx), pose)`
    gives you `.image` to position and tween. Then `.setPose('front'|'side'|'back')`, `.face(dx)`
    (side view, flip), `.faceMotion(dx, dy)` (top-down 4-way facing), `.walk(moving, time)` (stride
    frames), `.setExpression('idle'|'happy'|'hurt'|'ko')`, and `.tick(time)` once per frame (it also
    blinks).
  - `ensureAvatarTexture(scene, avatar, color, pixel, pose, expression, step)` for static icons
    (pixel 1 = 16 px).
  - `avatarPx()` keeps sizes on crisp 16-px steps.
- `game/playerMarks.ts`: `YouMarker` (the one "this is you" ▼; `.place(x, topOfSprite, time)`),
  `nameTagStyle(size, color)`, `addShadow(scene, size, depth)`.
- Elimination rounds: `fx.eliminate(scene, x, y, color, this.quip('game.common.stamps', id))` (burst +
  ring + stamp + shake; play `this.sfx.eliminated()` once per batch), `this.hud?.setCenter(this.t(
  'game.common.left', { n, total }))` for the survivors chip, `this.quip('game.common.spectating',
  this.selfId)` for the out state.
- Banter (`docs/implementation-decisions.md` D25): `this.quip(poolKey, seed)` picks a line from an i18n
  array, the same on every client for the same seed (a player id, a moment) and stable across frames —
  never `Math.random` for text. NPCs talk with `fx.speechBubble(scene, x, y, text, size)` (tail on the
  speaker). Dark, acid humor is welcome when it targets the situation or the loser's pride, never real
  people or groups; write each language's lines natively (EN and ES get their own jokes).
- `game/playerStrip.ts`: `PlayerStrip` — wrapping row of chips in identity colors (how everyone else is
  doing). Pass `avatar: this.state.avatarOf(id)` so each chip leads with the player's avatar (KO face
  when `dim`).
- `netcode/SnapshotInterpolator` for real-time motion (see `FruitCatchScene`).
- `setColor` on a Text is cheap to repeat (a boot-time guard skips unchanged colors), but prefer
  updating texts only when their value changes.

## Quality bar
1. Every meaningful event (hit/miss, correct/wrong, level up, knock-out, win/lose) gets a sound AND a
   visual, derived from snapshot deltas — never spammed every frame, never hiding the game.
2. Pixel-art sprites/beveled tiles over flat rectangles; PALETTE colors; identity colors for players;
   one obvious "what do I do now" prompt.
3. A clear end/waiting state (banner: `game.common.waiting`, `out`, `youWin`, `youLose`, `draw`…).
4. No hardcoded user-facing English — add keys with the `add-i18n-keys` skill (EN + ES).
5. Responsive: nothing clipped/overlapping at 1280x800 and 390x844 (`compact = min(w, h) < 520`),
   touch targets ≥ 44 px. The game is PC-first: set the catalog's `mobileFriendly` honestly (true only
   if it plays comfortably with touch on a portrait phone), but never let a scene break on one. Press Start 2P is ~1 em per glyph and crispest at multiples of 8 px — keep
   headline strings short, long sentences in `bodyStyle`. In-font symbols: ★ ▲ ▼ ◀ ▶ ← → ↑ ↓ ×.
6. Player counts: declare the catalog's `players` fit honestly (D27, `docs/player-fit-audit.md`) —
   `min` 2+ for last-standing/head-to-head games, `max` only up to what spawns/lanes/layout really
   hold (12 is the room ceiling), `best` where it's most fun. Check a full room with the playtest's
   `--bots=11`: show every player (or the top N **plus yourself**), never drop rows silently, and keep
   rounds ending early when the remaining seats can't act.
7. Cosmetic randomness that all players should see alike is derived from ids/indices (not
   `Math.random`); domain code never uses `Math.random`/`Date.now` (`bun run lint:determinism`).
8. Short header comment per scene; Biome style; no dead code / `any`.

References: `ButtonMasherScene.ts` (tap game: arcade button + player-colored race lanes),
`FruitCatchScene.ts` (real-time: interpolation, procedural sprites, catch/bomb feedback).

## Verify
`verify-all` skill (typecheck, lint, tests, **client build** — the only template/type check for the
whole client bundle) + `playtest-screenshots` at 1280x800 and 390x844 for every scene you touched.
