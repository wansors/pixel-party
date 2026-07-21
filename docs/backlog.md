# Backlog — Pixel Party

- **Version**: 0.3 (draft)
- **Date**: 2026-07-20

Phased product backlog. The philosophy is **start with a minimal MVP and grow incrementally** — build
the smallest thing that is fun end-to-end, then add features (more mini-games, handicap, post-match
analysis…) phase by phase. Nothing is built "just in case".

## Current status (2026-07-22)

**MVP is playable end-to-end, now with 16 mini-games + audio.** The full stack is scaffolded and runnable
(`bun run dev` → server :3000 + client :4200, LAN-accessible; see [`../README.md`](../README.md)). What
works today:

- Bun monorepo, hexagonal server, `@pp/shared` contracts, Biome + TS strict + determinism gate +
  `bun test` (40 passing) + **GitHub Actions CI**. *Foundation complete.*
- Rooms (create/join over `/api` + WS), lobby with ready state + host role, **host game selector +
  round count**, server-authoritative **session engine** (intro countdown → play → per-round result →
  final), position→points scoring with tie-averaging, cumulative scoreboard + final ranking.
- **16 mini-games** — the 5 P0-tier: Quick reaction (A1, `reaction-duel`), Button masher (A2,
  `button-masher`), Color Trap (E1, `color-trap`), Lightning Quiz (A3, `trivia`), Balloon Chicken
  (D1, `balloon-chicken`); the complete **P1 wave** (2026-07-21): Number Rush (E4, `number-rush`),
  Quick Math (E2, `quick-math`), Odd One Out (E3, `odd-one-out`), Higher or Lower (E5, `higher-lower`),
  Bug Smash (A6, `bug-smash`), Stop the Clock (A10, `stop-clock`), Memory Flash (E8, `memory-flash`),
  Simon (A4, `simon`), Pixel Hoops (A5, `pixel-hoops`); plus the two P1 fast-follows (2026-07-22):
  Pixel Weight (E12, `pixel-weight`), Pixel Split (E11, `pixel-split`). Each is a pluggable domain
  module + Phaser scene.
- **Audio** (Phase 7 pulled forward): looping background music + synthesized 8-bit SFX (click,
  correct/wrong, coin, pop, countdown) across UI and every mini-game; in-app music/SFX volume sliders
  persisted per device. *WebAudio-synthesized SFX (no asset binaries); music is a self-hosted mp3.*
- Angular shell (join → lobby → intro countdown → round canvas → scoreboard → final) with socket
  reconnect backoff **and mid-session rejoin** (REJOIN reclaims a seat, scores survive, state replayed).
- **Retro arcade look & feel**: shared palette theme (`theme.ts` + CSS vars), arcade window frame +
  chunky buttons, pixel-art avatars (self-hosted SVG sprites) with a join-screen picker, high-score
  scoreboard/final ranking, optional CRT overlay.

Phase 0 is essentially complete. Remaining polish: drop in the self-hosted pixel-font woff2 (scaffold
ready) and per-breakpoint responsive tuning. Next up is Phase 1 (more games + robustness).

## How this backlog works

- **Phases** are ordered by priority. Phase 0 is the MVP; later phases are independent epics that can be
  re-prioritized.
- Each item has a status: `[ ]` todo · `[~]` in progress · `[x]` done.
- **Dependencies** are noted where a phase needs an earlier one.
- The **mini-game catalog grows over time** (see `minigame-catalog.md`): the MVP ships **3 games**; more
  are designed and added later — we do not build the whole catalog up front.

---

## Phase 0 — MVP (minimum playable session)

Goal: a group of 4–10 players can play a full session of **3 individual mini-games** and see a final
ranking. Latency-tolerant games only; no teams/duels/handicap yet.

### Foundation
- [x] Bun workspaces monorepo skeleton (`apps/*`, `packages/*`), `bunfig.toml`, `tsconfig.base.json`.
- [x] Biome + TS strict + `bun test` + determinism script + CI (see `technical-architecture.md` §8).
      *`scripts/check-determinism.sh` + `scripts/test-server.sh` + `.github/workflows/ci.yml` (server/shared
      + headless-Chrome client jobs).*
- [x] `@pp/shared` protocol skeleton (`PROTOCOL_VERSION`, `ClientMsg`, `ServerMsg`, core DTOs).
- [x] Server hexagonal skeleton + `composition-root.ts` + `config.ts` + `index.ts`.
- [x] `LiveRooms` in-memory authoritative store; `Clock`, `Random`, `IdGenerator` ports + adapters.

### Rooms & session
- [x] Create room (code) + join by code/link (HTTP `/api` + WS upgrade with server-resolved identity).
- [x] Lobby: player list, ready state, host role, host starts session.
- [x] WS transport (`Bun.serve`) + intent dispatch + hand-written shape validator (`validate.ts`).
- [x] Session engine (`SessionEngine`/`SessionManager` + `simulationLoop`): sequence N rounds, cycle
      intro → play → results. *Host-configurable line-up + rounds already in (ahead of the Phase 1 plan).*
- [x] Basic reconnection (rejoin ongoing session, restore scoreboard). *REJOIN intent reclaims a seat
      (id persisted in sessionStorage → survives reload); disconnected seats stay in the roster so scores
      survive; `SessionEngine.resumeMessages()` replays the current state to the reconnecting socket.*

### Mini-games (individual, latency-tolerant) — all 5 P0-tier games shipped
- [x] Quick reaction ("Go!") — A1 (`reaction-duel`, seeded green-light delay via the Random port).
- [x] Button masher — A2 (`button-masher`, real-time tick).
- [x] Color Trap (Stroop) — E1 (`color-trap`, seeded word/ink sequence; tap the ink color).
- [x] Lightning Quiz (Trivia) — A3 (`trivia`, seeded question subset; correct + speed bonus). *fast-follow shipped.*
- [x] Balloon Chicken (Nerve) — D1 (`balloon-chicken`, hidden seeded burst threshold; pump vs. cash out). *fast-follow shipped.*

### Scoring
- [x] Position → points table (`DEFAULT_AWARD_TABLE`) with tie-averaging, cumulative scoreboard per round.
- [x] Final ranking + tiebreakers. *Dense ranks + averaged ties; richer tiebreakers can come later.*

### Client
- [x] Angular 20 shell: join, lobby, round intro, results, final ranking (single `RoomComponent`).
- [x] Phaser scenes for the mini-games; `GameSocketService` + `ServerMsgRouter`; `runOutsideAngular`.
      *All 5 scenes done; GameClient switches scene by `minigameId`.*
- [~] Responsive mobile (portrait) + desktop. *`Scale.RESIZE` + basic CSS; not yet tuned per breakpoint.*

### Extras done this phase (beyond the original plan)
- [x] Host **game selector** + round-count config in the lobby (`HOST_CONFIG`).
- [x] **Countdown (3-2-1)** before each round (intro phase).
- [x] `bun run dev` one-command launcher (`scripts/dev.sh`); dev commands pre-approved in `.claude/settings.json`.

### Look & feel (retro arcade — see `art-direction.md`)
- [~] Establish the shared theme: palette (`@pp/shared` `theme.ts` + mirrored CSS vars), arcade window
      frame + chunky buttons, optional CRT scanline overlay (reduced-motion aware). *Self-hosted pixel
      font: `@font-face` scaffold + CSS var in place; drop the woff2 at
      `assets/fonts/press-start-2p.woff2` to enable it (chunky monospace fallback until then).*
- [x] Anonymous player identity: unique color + preset pixel avatar ("monigote") + name (typed/auto).
      *Join screen picks avatar + color + name; avatars are self-hosted SVG pixel sprites (`PixelAvatarComponent`).*
- [x] Scoreboard & final ranking as a classic arcade high-score table. *Avatar + color + name rows,
      blinking leader, "NEW HIGH SCORE" flourish.*
- [x] **No database** — everything in-memory; nothing persisted when a room closes.

---

## Phase 1 — More individual games & robustness

- [x] Grow the individual-game catalog — **full P1 wave shipped 2026-07-21**: Number Rush (E4), Quick
      Math (E2), Odd One Out (E3), Higher or Lower (E5), Bug Smash (A6), Stop the Clock (A10), Memory
      Flash (E8), Simon (A4), Pixel Hoops (A5); plus the P1 fast-follows Pixel Weight (E12) and Pixel
      Split (E11) on 2026-07-22. **16 mini-games total.**
- [~] Host config: number of rounds, no-repeat within a session. *Rounds + game selection done in Phase 0;
      no-repeat-within-a-session still pending.*
- [ ] Reconnection hardening, host transfer on disconnect, kick player, room inactivity timeout.
- [ ] Observability: structured logging of room events + latency/error metrics.
- [x] **Per-round result screen ("round MVP")**. *Done 2026-07-21: the engine's post-round phase is now
      two dwell steps — `round-result` (highlights who won THIS mini-game: winner banner + per-round
      points, from `ROUND_RESULT`) then `scoreboard` (cumulative) — each with its own duration
      (`SessionConfig.roundResultMs` / `scoreboardMs`, default 4 s + 4 s). New client `round-result` view;
      reconnect (`resumeMessages`) handles both sub-phases. Replaces the old single `resultMs` where
      `ROUND_RESULT` folded straight into the cumulative board and the round winner was never shown.*

*Depends on: Phase 0.*

---

## Phase 2 — Formats: teams & duels

- [ ] Team assignment service (random / host-set) + team scoring distribution.
- [ ] Duel bracket + pairing service; map bracket ordering → placements.
- [ ] Team games: Tug of War (C1), Bomb Relay (C2).
- [ ] Duel games (turn-based, low latency): Sink the Fleet (B2).

*Depends on: Phase 0 (scoring normalization §2.2 of `scoring-system.md`).*

---

## Phase 3 — Handicap / catch-up

- [ ] Handicap engine: compute per-player/team factor from current standings (bounded, capped).
- [ ] Mechanical handicap hooks in mini-games (leader nerf / trailer boost / team weighting).
- [ ] Scoring handicap (bounded multiplier), shown transparently on results.
- [ ] Session config toggles (default off).

*Depends on: Phase 0; benefits from Phase 2. See `scoring-system.md` §3.1 and `minigame-catalog.md` §H.*

---

## Phase 4 — Post-match analysis & player profile

The end-of-session summary evolves from a flat ranking into a richer profile.

- [ ] **Skill-axis tagging**: tag each mini-game by axis (see below) so results can be aggregated per axis.
- [ ] **Player radar / pentagon** (Brain Training / Nintendo DS style): a radar chart per player showing
      their normalized score on each skill axis across the session (agility high, thinking lower, etc.).
- [ ] Session summary: per-round breakdown, biggest comeback, MVP moments (banter surface).
- [ ] Persist enough per-session data to render the analysis (see Phase 6 if long-term history is wanted).

### Proposed skill axes (for the radar)
| Axis | Fed by (catalog) |
|------|------------------|
| Reflexes / reaction | A1, A6, B1 |
| Speed / endurance | A2, A9, C1 |
| Knowledge / thinking | A3 |
| Memory | A4, A11 |
| Precision / timing | A5, A10, B2 |
| Nerve / luck | D1, D3 |

> Each mini-game contributes its normalized result to its axis; the radar plots the player's average per
> axis. This is a **presentation/analytics** feature — it does not change scoring or ranking.

*Depends on: Phase 0; richer with a broad catalog (Phases 1–2).*

---

## Phase 5 — Real-time action mini-games

Deferred until the netcode/sync layer is proven (higher latency sensitivity).

- [ ] Netcode hardening: client interpolation (~100 ms), input prediction where needed.
- [ ] Pixel Pong (B1), Sumo Push (B3), Pixel Dash (A9), Snake Arena (A8), Pixel rain (A7), Fruit Catch (D2).

*Depends on: Phase 0 (tick loop), ideally Phase 2 (duels for Pong/Sumo).*

---

## Phase 6 — Accounts, history & progression

> This is the **first phase that introduces a database**. Phases 0–5 are fully in-memory/ephemeral.

- [ ] `bun:sqlite` persistence layer (raw SQL, migrations, seed) — follow utopia conventions.
- [ ] Optional accounts (lightweight); persistent session history & lifetime stats.
- [ ] Achievements, seasons, leaderboards.

*Depends on: Phase 0; Phase 4 for analysis persistence.*

---

## Phase 7 — Polish & social

- [ ] Avatars/customization, emotes, in-room chat.
- [ ] Audio: music + SFX.
- [ ] Public matchmaking (open rooms / quick match).
- [ ] i18n ES/EN across the UI.

---

## Mini-game catalog growth

The catalog (`minigame-catalog.md`) is a living list; the **prioritized ranking** lives in
`minigame-ideas.md` (~30 games scored on fun, healthy competition, effort, latency). Shipping order
follows the priority tiers there:

| Wave | Tier | Mini-games (id) | Phase |
|------|------|-----------------|-------|
| MVP | P0 | Quick reaction (A1 ✅), Button masher (A2 ✅), Color Trap (E1 ✅), Trivia (A3 ✅), Balloon Chicken (D1 ✅) — all 5 shipped | 0 |
| +1 | P1 | Number Rush (E4 ✅), Quick Math (E2 ✅), Odd One Out (E3 ✅), Higher/Lower (E5 ✅), Bug smash (A6 ✅), Timing (A10 ✅), Memory Flash (E8 ✅), Simon (A4 ✅), Pixel Hoops (A5 ✅), Pixel Weight (E12 ✅), Pixel Split (E11 ✅) — **P1 wave + fast-follows complete** | 1 |
| +2 | P2 | Tug of War (C1), Sink the Fleet (B2), Match (A11), Bomb Relay (C2), Quick Draw Duel (E7), Pixel Beat (E6), Fruit Catch (D2), Fleet Battle (C3) | 2 |
| +action | P3 | Pong (B1), Sumo (B3), Pixel Dash (A9), Snake (A8), Maze Sprint (E9), Pixel rain (A7), Line Clear (E10), Roulette (D3) | 5 |

> P0 group is 5 games ranked; the MVP ships the top 3 (A1, A2, E1) with D1/A3 as fast-follows. See
> `minigame-ideas.md` for the full ranked table and rationale.

---

## Icebox / ideas (unscheduled)

- [x] **Pixel Split ("cut in half")** — E11 (`pixel-split`, shipped 2026-07-22): drag a vertical cut so
      both halves of a seeded pixel object hold the same number of filled pixels; scored against the best
      achievable split. Server owns the per-column counts.
- [x] **Pixel Weight ("guess the weight")** — E12 (`pixel-weight`, shipped 2026-07-22): a pixel object
      flashes, then guess its filled-pixel count on a slider; points scale with closeness. Server owns
      the counts. *Balance variant not built.*
- [ ] **Quick Tetris** — E13: short, fast Tetris sprint (compact variant of E10 Line Clear Sprint);
      identical seeded piece sequence, clear the most lines in a short window. *P3, rides the action wave.*
- [ ] **Sudoku Race** — E14: everyone solves the same seeded Sudoku (small/quick grid); winner is
      first-to-solve, else most correct cells placed (server validates each cell). *P2, puzzle.*
- [ ] Manual mini-game selection/editor by the host.
- [ ] Spectator mode.
- [ ] Custom trivia packs.
- [ ] Cosmetic pixel themes / seasonal skins.
- [ ] Multi-instance scaling with a Redis pub/sub backplane.
