# Art direction & visual identity — Pixel Party

- **Version**: 0.1 (draft)
- **Date**: 2026-07-16

Pixel Party leans fully into a **retro, classic-arcade, pixel-art** identity — the name and the
mini-games invite it. Everything the player sees (the web shell, the lobby, the HUD, the results and the
scoreboards) should feel like an early-90s arcade cabinet / 8–16-bit console. This document is the
shared visual language so all screens and mini-games read as one coherent system.

## 1. Design pillars

- **Arcade-cabinet feel**: chunky borders, high-score tables, blinking "PRESS START", coin-op energy.
- **Pixel-perfect**: crisp pixel art, integer scaling, `image-rendering: pixelated` — never blur sprites.
- **Limited retro palette**: a small, punchy palette (console-era), not photorealistic gradients.
- **Snappy, not smooth**: stepped/instant transitions, hard cuts, small screen-shake and flashes —
  arcade responsiveness over easing curves.
- **Loud and playful**: bold, celebratory, meant to make the group laugh (aligned with the game's
  competitive-banter tone). The copy has a dark, acid streak — callouts, stamps, heckling NPCs — aimed
  at the situation and the loser's pride, never at real people or groups (`implementation-decisions.md`
  D25).
- **Coherent across mini-games**: even though mini-games vary, they share palette, font, framing and SFX.

## 2. Color palette

- Use a **fixed, limited palette** (aim ~16–32 colors) reminiscent of NES/PICO-8-era hardware.
  Deep near-black background, bright accent hues (magenta, cyan, lime, amber), a couple of neutrals.
- **Player colors**: reserve a set of **highly distinct, high-contrast hues** for players; each player
  gets a **unique color per room** (see §6). These must stay distinguishable side by side on a
  scoreboard.
- **Accessibility**: never rely on color alone — pair player color with the player's pixel avatar and
  name everywhere; keep text/background contrast high (see §7).

> **Implemented palette** — the single source of truth is `packages/shared/src/theme.ts` (`PALETTE` as
> `0xRRGGBB` for Phaser); the Angular shell mirrors it as CSS custom properties in `styles.scss`.
>
> | Token | Hex | Use |
> |-------|-----|-----|
> | `bg` | `#10121c` | deep near-black background |
> | `panel` / `panelAlt` | `#1b1e2e` / `#252a40` | window fills, rows |
> | `frame` / `frameLit` | `#3a3f66` / `#5b62a6` | arcade window borders |
> | `text` / `dim` | `#eef1f7` / `#7b88a8` | body / muted text |
> | `magenta` `cyan` `lime` `amber` `orange` `red` | `#ff3e7f` `#29d3f2` `#8be94b` `#ffcf4b` `#ff7b3d` `#ff5252` | accents |
>
> **Player colors** (`PLAYER_COLORS`, unique per room, paired with avatar + name): magenta, cyan, lime,
> amber, orange, purple `#b06bff`, teal `#4be3c3`, red, blue `#5b8cff`, pink `#f062d0`.

## 3. Typography

- **Bitmap / pixel font** for all UI (headings, buttons, HUD, scores) — a "Press Start 2P"-style
  monospaced pixel typeface vibe. **Self-hosted** (CSP-safe, no external CDN).
- Use pixel fonts at **integer multiples** of their native size to stay crisp.
- For long-form/body text (rules, tooltips) a slightly more legible pixel/mono face may be used if the
  headline font hurts readability — legibility wins over theme for instructions.

> **Implemented** — `apps/client/public/fonts/press-start-2p.woff2` is the full Press Start 2P (OFL,
> `OFL.txt` alongside), exposed as the `PixelArcade` family. It is an 8 px bitmap design, so pixel-font
> text uses the fixed type scale in `styles.scss` — `--fs-xs` 8 px, `--fs-sm` 12, `--fs-md` 16,
> `--fs-lg` 24, `--fs-xl` 32, `--fs-xxl` 48, `--fs-huge` 64 (crisp at multiples of 8, and of 4 on 2x
> screens) — while spacing stays rem-based. Longer sentences (blurbs, how-to-play, stats) use plain
> monospace. On canvas: `headlineStyle()` (pixel font) vs `bodyStyle()` (monospace) in
> `game/pixelStyle.ts`. The font has ★ ▲ ▼ ◀ ▶ ← → ↑ ↓ × but no ✔ ✕ ⇄: the UI draws its check mark
> with CSS (`.tick`).

## 4. UI & motion language

- **Framing**: windows/panels as arcade "sheets" with a thick pixel border and a title bar (reuse a
  single shared frame component across features — as the reference client does with its window frame).
- **Buttons**: chunky, with a pressed/offset state; hover = palette swap, not a soft shadow.
- **Cursor/selection**: blinking pixel caret, arrow/hand pixel cursor for menus.
- **Transitions**: hard cuts, wipe/pixelate transitions, brief countdowns ("3… 2… 1… GO!") between
  rounds.
- **Feedback**: small screen-shake on big moments, sprite flashes on hits, floating pixel "+10" score
  pops, confetti made of pixels on the podium.
- **Implemented kit**: `game/fx.ts` (`floatText`, `burst`, `ring`, `shake`, `flash`, `punch`, banners)
  and `game/hud.ts` (score chip + seconds + a segmented draining time bar that goes lime → amber →
  red and ticks in the last seconds) are shared by every mini-game scene; the Angular shell uses
  stepped CSS animations (`steps()`) for pops, podium bounce and pixel confetti, all disabled under
  `prefers-reduced-motion`.
- **Optional CRT layer**: a subtle scanline / vignette / slight curvature overlay, **toggleable** and
  off by default for accessibility and performance (must not hurt readability on mobile).

## 5. Sound (shipped)

- **Chiptune** music (menu loop, tense mini-game loop, victory jingle) and **8-bit SFX** (select,
  confirm, error buzz, countdown beep, score tick, coin, game-over).
- Shipped in Phase 0 (pulled forward from the original later-phase plan); audio stays optional and
  mutable via volume sliders.

## 6. Player representation (anonymous)

Players are **anonymous** — no accounts, no persistence. Each player in a room is identified by:

- **A unique color** (assigned from the reserved player-color set; unique within the room). This color
  is their identity across the lobby, HUD and scoreboards.
- **A pixel avatar ("monigote")**: a small pixel character. Players can **pick one from a preset set**
  (a handful of retro sprites), tinted/paired with their color.
- **A name**: **typed by the player, or auto-generated** if left blank — arcade-style (e.g., 3-letter
  initials "AAA", or fun generated handles). Name + color + avatar always travel together.

This trio (color + avatar + name) is what shows up everywhere a player is referenced.

### 6.1 Character spec — one cast for every screen and mini-game

A player looks like **their** avatar everywhere: the join picker, the lobby, the results, the podium
and inside every mini-game that draws a figure for them. There is one sprite source,
`apps/client/src/game/avatarSprites.ts` (pure data, no Phaser), rendered by `PixelAvatarComponent`
(SVG) in the Angular shell and by `game/avatars.ts` (`ensureAvatarTexture`, `AvatarSprite`) in the
scenes. Scenes never draw their own player figure. The per-game audit and migration log is in
[`visual-audit.md`](visual-audit.md).

- **The cast**: six chibi animals, all built the same way: cat, dog, fox, owl, frog and bear. They are
  big-headed and small-bodied, with 3×3 eyes and a smile.
- **Grid**: **16×16** per view, drawn as ASCII silhouettes plus feature letters. Every grid keeps a
  1-cell empty margin for the outline. Feet sit on row 14, so all six share one ground line.
- **Computed style** (identical for the whole cast, never hand-painted per sprite):
  - **Outline**: a 1-px outline in a dark tone of the identity color (`shade −0.7`), so dark colors still
    separate from dark backgrounds.
  - **Body shading** in 3 tones, lit from the top-left: highlight (`+0.32`) on the top/left edges,
    shade (`−0.28`) on the bottom/right edges. Markings (dog ears, owl wings, tails) use `−0.42`.
  - **Light parts**: muzzle and belly are the identity color mixed 72 % with warm white, shaded along
    their lower edge.
  - **Fixed accents**: pink (ears, cheeks, nose), ink, white and amber (beak, feet).
- **Identity color**: the avatar *is* the identity color. Never re-tint, lighten or swap it in a scene,
  including for pilots, ghosts or teams. Show a team with a frame or the side of the screen, not by
  recoloring the player.
- **Views**:
  - **front**: the default. Lobby, results, and also **top-down arenas**. Like classic Bomberman or
    Zelda, top-down games show the character from the front instead of a literal overhead view.
  - **side**: faces right; flip it to face left. Use it for side-scrollers, platformers and lane races.
  - **back**: no face, shows the tail and markings. Use it when a character walks away from the camera.
- **Expressions** (the eyes): `idle` (with an automatic blink every ~3.4 s, offset per player),
  `happy` (won, safe, scored), `hurt` (a hit, stun or trip; brief), `ko` (eliminated; stays), and `blink`.
- **Size**: display at whole steps of the 16-px grid (16 / 32 / 48 / 64…; 24 is the one half-step for
  small UI). Use `avatarPx(maxPx)`, which gives the largest step that fits. Never stretch to an
  arbitrary size: uneven pixels look broken. The one exception is a size that is a gameplay contract
  (Pixel Rain's hit zone).
- **Motion**: two stride frames (`AvatarSprite.walk()`): on the side view the feet pass under the body;
  on the front and back views one foot lifts, then the other. On top of that, juice tweened on the same
  sprite: a bob, a lean, a ±6° waddle, a hop arc, a squash on landing, a recoil on hits.
- **Grounding**: a standing character gets a soft dark ellipse shadow (~0.8× its width, alpha ~0.35).
- **Who is who on the canvas**:
  - **You**: an amber ▼ with a dark outline, bobbing above your own character (`YouMarker`). It is
    the same in every game.
  - **Others**: a name tag in their identity color with a dark outline (`nameTagStyle`), where space
    allows.
  - **Standings**: the `PlayerStrip` chips lead with each player's avatar, showing the KO face when
    that player is out.
- **Out / eliminated**: switch to the KO face and play the shared `eliminate()` effect. Then, if the
  figure stays on the field, lie it down (±90°) at ~0.4 alpha. If the rules take it away (fell, sank),
  play the fall instead.
- **Vehicles and props**: when a player drives or flies something (a car, a ship), their avatar rides
  it as the **pilot**, so the vehicle never replaces the player.
- **No figure at all** (quiz, puzzle and board games): identity shows through the `PlayerStrip`
  (avatar + name + stat) or that game's rival board, always with the avatar, never a plain color.
- **Non-player characters** (the doll, rope turners, referees) are drawn separately, in neutral
  colors, so they never read as a player.

## 7. Scoreboards & results (the retro payoff)

- Render the cumulative scoreboard and the **final ranking as a classic arcade high-score table**:
  monospaced rows, rank, player (avatar + color + name), points, with the leader highlighted/blinking.
- Between-round results: animated score pops and a quick re-sort of the table (arcade "ranking climb").
- The end-of-session podium: pixel confetti, a victory jingle (when audio lands), and a "NEW HIGH
  SCORE!"-style flourish for the winner.
- The **post-match radar/pentagon** (backlog Phase 4) should also be drawn in the pixel style —
  a chunky, low-res radar reminiscent of *Brain Training* stat screens.

## 8. Accessibility guardrails (theme must not break usability)

- High contrast text; pixel fonts sized large enough on mobile portrait.
- Color is **never** the only signal — always accompany with avatar + name + shape/icon.
- CRT/scanline effects and heavy screen-shake are **optional and reducible** (respect reduced-motion).
- Touch targets stay comfortably tappable despite the chunky pixel styling.

## 9. Where this applies

- The **Angular shell** (join, lobby, results, ranking, HUD) carries the arcade chrome, framing, fonts
  and palette.
- Each **Phaser mini-game** uses the shared palette, player colors and pixel style so the whole session
  feels like one cabinet.
- All assets are **self-hosted** (fonts, sprites, audio) — the client bundles them; no external hosts.
