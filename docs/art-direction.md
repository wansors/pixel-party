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
  competitive-banter tone).
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

## 4. UI & motion language

- **Framing**: windows/panels as arcade "sheets" with a thick pixel border and a title bar (reuse a
  single shared frame component across features — as the reference client does with its window frame).
- **Buttons**: chunky, with a pressed/offset state; hover = palette swap, not a soft shadow.
- **Cursor/selection**: blinking pixel caret, arrow/hand pixel cursor for menus.
- **Transitions**: hard cuts, wipe/pixelate transitions, brief countdowns ("3… 2… 1… GO!") between
  rounds.
- **Feedback**: small screen-shake on big moments, sprite flashes on hits, floating pixel "+10" score
  pops, confetti made of pixels on the podium.
- **Optional CRT layer**: a subtle scanline / vignette / slight curvature overlay, **toggleable** and
  off by default for accessibility and performance (must not hurt readability on mobile).

## 5. Sound (later phase, but part of the identity)

- **Chiptune** music (menu loop, tense mini-game loop, victory jingle) and **8-bit SFX** (select,
  confirm, error buzz, countdown beep, score tick, coin, game-over).
- Ships in a later phase (see `backlog.md` Phase 7) but designed for from the start; keep audio optional
  and mutable.

## 6. Player representation (anonymous)

Players are **anonymous** — no accounts, no persistence. Each player in a room is identified by:

- **A unique color** (assigned from the reserved player-color set; unique within the room). This color
  is their identity across the lobby, HUD and scoreboards.
- **A pixel avatar ("monigote")**: a small pixel character. Players can **pick one from a preset set**
  (a handful of retro sprites), tinted/paired with their color.
- **A name**: **typed by the player, or auto-generated** if left blank — arcade-style (e.g., 3-letter
  initials "AAA", or fun generated handles). Name + color + avatar always travel together.

This trio (color + avatar + name) is what shows up everywhere a player is referenced.

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
