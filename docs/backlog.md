# Backlog — Pixel Party

- **Version**: 0.9 (draft)
- **Date**: 2026-08-21

Phased product backlog. The philosophy is **start with a minimal MVP and grow incrementally** — build
the smallest thing that is fun end-to-end, then add features (more mini-games, handicap, post-match
analysis…) phase by phase. Nothing is built "just in case".

## Current status (2026-09-28)

**Phases 0–5 are complete, and that's the whole roadmap.** The game is playable end-to-end (`bun run dev`
→ server :3000 + client :4200, LAN-accessible; see [`../README.md`](../README.md)) with **40
mini-games** — the full `minigame-ideas.md` backlog is built, plus a sports wave (track & field +
Micro Race, 2026-09-28, D20). The deployment target is a **local LAN
party with friends** — one process, on one local network, no accounts — which is why the project is
permanently **stateless, anonymous, and single-instance by design**: no database (D15), no further
social/polish phase (D16), no multi-instance scaling (D17). What remains open-ended is growing the
mini-game catalog with brand-new ideas. Design decisions from the clear-out pass are logged in
[`implementation-decisions.md`](implementation-decisions.md) (D1–D21). The game is **PC-first**; 31
of the 40 games are tagged `mobileFriendly` (lobby badge + filter, D21).

### Foundation & platform
- Bun workspaces monorepo, hexagonal server, `@pp/shared` wire contracts, Biome + TS strict +
  determinism gate + **GitHub Actions CI**. Test suite: **277 server/shared + 7 client (Karma)**, green.
- Server-authoritative, deterministic core (seeded `Random` + `Clock` ports; the domain never touches
  `Math.random`/`Date.now`). Bun-native WS with a hand-written shape validator (no Zod).
- Angular 20 shell + Phaser 3 (decoupled); **i18n EN/ES** (Transloco) across the UI + every scene;
  **audio** (music + synthesized 8-bit SFX + volume sliders); **retro arcade** look & feel (palette
  theme, arcade frame, self-hosted pixel font + avatars, high-score tables, CRT overlay).

### Rooms, session & scoring
- Rooms (create/join over `/api` + WS), lobby (ready/host, game selector, round count), session engine
  (intro → play → per-round result → cumulative scoreboard → final).
- **Robustness**: no-repeat seeded line-ups, mid-session reconnect/rejoin, host transfer
  (auto-on-disconnect + manual) + kick, idle-room reaper, observability (JSON logs + `/api/metrics`).
- Scoring: position→points table with tie-averaging; **final-ranking tiebreakers** (most 1st places →
  best average position, `domain/services/finalRanking`).

### Mini-games — 40 (pluggable domain module + Phaser scene each)
- **34 FFA**: `reaction-duel`, `button-masher`, `color-trap`, `trivia`, `balloon-chicken`,
  `number-rush`, `quick-math`, `odd-one-out`, `higher-lower`, `bug-smash`, `stop-clock`, `memory-flash`,
  `simon`, `pixel-hoops`, `pixel-weight`, `pixel-split`, `fruit-catch`, `pixel-rain`, `pixel-dash`,
  `snake-arena`, `sumo-push`, `match-pairs`, `pixel-roulette`, `sudoku-race`, `pixel-beat`,
  `maze-sprint`, `line-clear-sprint`, `quick-tetris`, `bubble-pop`, `dash-100m`, `hurdles-110m`,
  `long-jump`, `javelin-throw`, `micro-race`.
- **3 team**: `tug-of-war`, `bomb-relay`, `fleet-battle`. **3 duel**: `sink-the-fleet`, `pixel-pong`,
  `quick-draw`.

### Epics
- **Phase 0/1** — MVP + individual-game catalog + robustness/observability. **Complete.**
- **Phase 2** — teams + duels (assignment, pairing, team/duel scoring). **Complete.**
- **Phase 3** — handicap: bounded scoring catch-up lever with a host lobby toggle + on-results
  transparency, off by default. **Complete** — mechanical per-game hooks dropped, not deferred (D14).
- **Phase 4** — post-match analysis: 7 skill axes → per-player radar + session summary. **Complete.**
- **Phase 5** — real-time action games: client snapshot interpolation + 6 games. **Complete.**

**Phase 5 is the last numbered phase.** There is no Phase 6 (DB/accounts — dropped, D15) and no Phase 7
(the remaining polish & social items — avatars/customization, emotes, in-room chat, public matchmaking —
dropped, D16; audio and i18n already shipped in Phase 0). Every candidate in `minigame-ideas.md` (35 of
35) is now built; growing the catalog further means proposing new ideas, not clearing the existing list.

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
- [x] Final ranking + tiebreakers. *Dense ranks + averaged ties; **richer tiebreakers landed 2026-07-23**
      (`domain/services/finalRanking`): equal totals break by most 1st places, then best average
      position (scoring §5.1–5.2). The §5.3 sudden-death tiebreaker mini-game is still future (D12).*

### Client
- [x] Angular 20 shell: join, lobby, round intro, results, final ranking (single `RoomComponent`).
- [x] Phaser scenes for the mini-games; `GameSocketService` + `ServerMsgRouter`; `runOutsideAngular`.
      *All 5 scenes done; GameClient switches scene by `minigameId`.*
- [x] Responsive mobile (portrait) + desktop. *`Scale.RESIZE` + rem-based scaling tuned per breakpoint
      (900/600/380 root-font steps + a landscape/short-height rule); lobby roster wraps its host controls
      on narrow widths; body never scrolls horizontally; the round canvas claims the vertical space on
      landscape phones.*

### Extras done this phase (beyond the original plan)
- [x] Host **game selector** + round-count config in the lobby (`HOST_CONFIG`).
- [x] **Countdown (3-2-1)** before each round (intro phase).
- [x] `bun run dev` one-command launcher (`scripts/dev.sh`); dev commands pre-approved in `.claude/settings.json`.

### Look & feel (retro arcade — see `art-direction.md`)
- [x] Establish the shared theme: palette (`@pp/shared` `theme.ts` + mirrored CSS vars), arcade window
      frame + chunky buttons, optional CRT scanline overlay (reduced-motion aware). *Self-hosted pixel
      font live: `press-start-2p.woff2` (OFL, CSP-safe) is bundled at `public/fonts/` and wired via
      `@font-face` + `--font-pixel` (Courier New monospace fallback while it loads).*
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
- [x] Host config: number of rounds, no-repeat within a session. *Done 2026-07-23: the session engine
      builds each line-up by seeded-shuffling the distinct pool and capping rounds at the number of
      distinct games (a game never plays twice in a session). `HOST_CONFIG` dedupes + clamps rounds to
      the game count so the lobby shows the real number; the rounds input `max` follows the selection.*
- [x] Reconnection hardening, host transfer on disconnect, kick player, room inactivity timeout.
      *Done 2026-07-23: host auto-transfers to the first still-connected member when the host drops
      mid-session (`Room.reassignHostIfDisconnected`); new host-only `TRANSFER_HOST` / `KICK_PLAYER`
      intents + lobby roster controls (kicked clients get a `KICKED` msg → bounce to the entry screen);
      idle-room reaper (`roomSweeper` off a 60 s interval) drops abandoned/never-joined rooms after
      `ROOM_IDLE_TIMEOUT_SEC` (default 15 min), which was previously a wired-but-dead config knob.*
- [x] Observability: structured logging of room events + error metrics. *Done 2026-07-23: JSON logger
      (`observability/logger`) emits one line per lifecycle event (room/session created, join/rejoin,
      left/disconnected, host_transferred, kicked, reaped); in-memory counters (`observability/metrics`)
      + live gauges exposed at `GET /api/metrics` (rooms_created, players_joined, rejoins, disconnects,
      kicks, host_transfers, sessions_started, messages, errors, rooms_reaped, active_rooms,
      running_sessions).*
- [x] **Per-round result screen ("round MVP")**. *Done 2026-07-21: the engine's post-round phase is now
      two dwell steps — `round-result` (highlights who won THIS mini-game: winner banner + per-round
      points, from `ROUND_RESULT`) then `scoreboard` (cumulative) — each with its own duration
      (`SessionConfig.roundResultMs` / `scoreboardMs`, default 4 s + 4 s). New client `round-result` view;
      reconnect (`resumeMessages`) handles both sub-phases. Replaces the old single `resultMs` where
      `ROUND_RESULT` folded straight into the cumulative board and the round winner was never shown.
      Extended 2026-07-22: the round-result rows now also show a per-player, game-specific performance
      detail (reaction ms, correct answers, taps, streak, level, banked points…) via an optional
      `stats: Record<playerId, string>` on `NormalizedResult` → `RoundResultDto`. Purely presentational;
      it never feeds scoring.*

*Depends on: Phase 0.*

---

## Phase 2 — Formats: teams & duels

**Complete** (2026-07-23) — teams (Tug of War, Bomb Relay) and duels (Sink the Fleet) all shipped
end-to-end + playable.

- [x] Team assignment service (random / host-set) + team scoring distribution. *Done 2026-07-23: two
      fixed teams (`red`/`blue`, `@pp/shared` `TEAMS`). `balancedTeams` (domain service) does a seeded
      round-robin split (sizes differ by ≤1); teams are auto-assigned when the line-up gains a team game
      and cleared when it drops back to FFA. Host controls: `SET_TEAM` (move a player) + `SHUFFLE_TEAMS`
      (re-roll); a late joiner slots into the smaller team. `awardTeamPoints` (scoring §2.2) ranks the
      teams via the position table and gives every member their team's points, undiluted by team size
      (tie = averaged team positions). Team membership is snapshotted per round and fed to the game via
      `MiniGameInitCtx.teams`; `RoundResultDto.teams` + `LOBBY_STATE.usesTeams` + `PlayerDto.team` carry
      it on the wire; lobby shows team badges + a "TEAM RED WINS" round banner.*
- [x] Duel pairing service; map results → placements. *Done 2026-07-23: `pairPlayers` (domain service)
      does a seeded simultaneous 1v1 pairing (odd roster → one bye = free win); wins/losses aggregate
      into a round ranking (winners share rank 0, losers rank 1) that feeds the standard position table.
      Chose simultaneous 1v1 over a single-elimination bracket — it keeps everyone playing every round
      (party model) and maps to one round with no idle eliminated players.*
- [x] Team games: Tug of War (C1), Bomb Relay (C2). *Tug of War (`tug-of-war`): real-time team mash,
      progress is average pulls-per-member (fair for uneven teams), win by a decisive per-capita lead or
      by leading at the timer. Bomb Relay (`bomb-relay`, 2026-07-23): hot-potato relay — each team shares
      one bomb held by one member at a time; the holder mashes to fill their leg (12 taps) and pass it on
      (+1 relay), racing a hidden seeded fuse; if it blows first the team takes an explosion and the bomb
      rotates. Most relays wins (fewer explosions breaks ties). Both reuse the team format + scoring.*
- [x] Duel games (turn-based, low latency): Sink the Fleet (B2). *Done 2026-07-23 (`sink-the-fleet`):
      simultaneous 1v1 Battleship on a 5×5 board (fleet [3,2,2]); fleets are auto-placed and never sent
      on the wire (only shot hit/miss results are, so nothing exploitable leaks — no per-player channel
      needed); turn-based firing with a 5 s per-turn timeout so a staller can't freeze their opponent;
      a duel ends on a full sink, else it's decided on hits at the 60 s cap (tie = draw).*

*Depends on: Phase 0 (scoring normalization §2.2 of `scoring-system.md`).*

---

## Phase 3 — Handicap / catch-up

**Complete** (2026-08-21) — the bounded **scoring** lever ships with a host toggle + on-results
transparency (off by default). The mechanical per-game hooks are **dropped, not deferred** — the scoring
lever is the whole feature. See `implementation-decisions.md` D8 / D8-UPDATE / D14.

- [x] Handicap engine: compute per-player factor from current standings (bounded, capped). *Done —
      `domain/services/handicap.ts` `applyScoringHandicap`: trailer bonus scales linearly with distance
      behind, capped at `maxBonusPct`; leader gets 0; never reorders a round. Fully unit-tested.*
- [x] ~~Mechanical handicap hooks in mini-games (leader nerf / trailer boost / team weighting)~~ —
      **dropped (D14)**: would touch all 28 games for a marginal gain over the scoring lever alone.
- [x] Scoring handicap (bounded multiplier), shown transparently on results. *Done — wired in
      `SessionEngine.endRound`; the per-player catch-up bonus rides `RoundResultDto.handicap` and shows
      as a "+N catch-up" badge on the round-result screen.*
- [x] Session config toggles (default off). *Done — host lobby checkbox (`HOST_CONFIG.handicap` →
      `LOBBY_STATE.handicap`), room flag is the source of truth; `HANDICAP_ENABLED` env seeds the default
      for new rooms, `HANDICAP_MAX_BONUS_PCT` sets the cap.*

*Depends on: Phase 0; benefits from Phase 2. See `scoring-system.md` §3.1. The per-game hooks in
`minigame-catalog.md` §H are historical context for a path not taken (D14).*

---

## Phase 4 — Post-match analysis & player profile

**Complete** (2026-07-23). The end-of-session summary evolved from a flat ranking into a richer profile.
See `implementation-decisions.md` D3–D7 for the choices taken.

- [x] **Skill-axis tagging**: *Done — `SkillAxis` (7 axes: reflexes/speed/knowledge/memory/precision/
      nerve/focus) + `SKILL_AXES` in `@pp/shared`; `MiniGameMeta.axes` tags all 19 games (each ≥1 axis).*
- [x] **Player radar / pentagon** (Brain Training / Nintendo DS style): *Done — `app-skill-radar` (dumb
      OnPush inline-SVG, no chart lib) renders the viewing player's normalized per-axis profile on the
      final screen. The wire carries a radar per player (`PlayerRadarDto`), so showing all is a
      client-only follow-up (decision D6).*
- [x] Session summary: per-round breakdown, biggest comeback, MVP moments (banter surface). *Done —
      `SessionSummaryDto` (per-round winners, most round wins, biggest standings comeback), computed in
      the domain service `sessionAnalysis` and shown under the final ranking.*
- [x] Persist enough per-session data to render the analysis. *Done in-memory: the engine accumulates a
      per-round `RoundAnalysis` and computes the radar+summary at session end — no DB, and none is
      planned (D15). Normalization is points-relative (decision D4).*

> Delivery notes: analysis rides on the existing `FINAL_RANKING` message (optional `radars`/`summary`
> fields; `PROTOCOL_VERSION` unchanged — decision D5) and replays on reconnect. Additive only; scoring
> and line-up are untouched.

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

**Complete** (2026-07-23). Netcode hardening landed as a client snapshot interpolator and all six action
games shipped end-to-end. See `implementation-decisions.md` D10.

- [x] Netcode hardening: client interpolation (~100 ms). *Done — `game/netcode/SnapshotInterpolator`
      buffers the two latest snapshots and renders ~100 ms behind, lerping entities by stable id; scenes
      opt in. Input prediction not needed — each scene renders its own avatar locally (immediate) while
      the server stays authoritative for scoring/collision (D10).*
- [x] Pixel Pong (B1), Sumo Push (B3), Pixel Dash (A9), Snake Arena (A8), Pixel rain (A7), Fruit Catch
      (D2). *All shipped as pluggable domain modules + Phaser scenes, each with domain tests. `fruit-catch`
      is the reference (seeded falling stream, item y is a pure function of time). `pixel-pong` is a 1v1
      duel (seeded pairing, server-owned ball, interpolated); `sumo-push` is an FFA shove arena (physics,
      survival ranking); `snake-arena` is grid-stepped; `pixel-rain`/`pixel-dash` are seeded
      dodge/timing FFA. Brought the catalog to 25 (now **28** with Match, Quick Draw, Roulette).*

*Depends on: Phase 0 (tick loop), Phase 2 (duel pairing for Pong).*

---

> Phase numbering keeps its gaps: there is no Phase 6 and no Phase 7. Phase 6 was accounts/history/DB,
> permanently dropped (D15). Phase 7 was "polish & social" — audio and i18n (the two items with real
> value) already shipped, pulled forward into Phase 0; the rest (avatars/customization, emotes, in-room
> chat, public matchmaking) is permanently dropped too, not deferred (D16). The project stops at Phase 5
> plus on-demand catalog growth.

---

## Mini-game catalog growth

The catalog (`minigame-catalog.md`) is a living list; the **prioritized ranking** lives in
`minigame-ideas.md` (~30 games scored on fun, healthy competition, effort, latency). Shipping order
follows the priority tiers there:

| Wave | Tier | Mini-games (id) | Phase |
|------|------|-----------------|-------|
| MVP | P0 | Quick reaction (A1 ✅), Button masher (A2 ✅), Color Trap (E1 ✅), Trivia (A3 ✅), Balloon Chicken (D1 ✅) — all 5 shipped | 0 |
| +1 | P1 | Number Rush (E4 ✅), Quick Math (E2 ✅), Odd One Out (E3 ✅), Higher/Lower (E5 ✅), Bug smash (A6 ✅), Timing (A10 ✅), Memory Flash (E8 ✅), Simon (A4 ✅), Pixel Hoops (A5 ✅), Pixel Weight (E12 ✅), Pixel Split (E11 ✅) — **P1 wave + fast-follows complete** | 1 |
| +2 | P2 | Tug of War (C1 ✅), Sink the Fleet (B2 ✅), Bomb Relay (C2 ✅), Match (A11), Quick Draw Duel (E7), Pixel Beat (E6), Fruit Catch (D2), Fleet Battle (C3) | 2 |
| +action | P3/P5 | Pong (B1 ✅), Sumo (B3 ✅), Pixel Dash (A9 ✅), Snake (A8 ✅), Pixel rain (A7 ✅), Fruit Catch (D2 ✅ — from P2 list); still open: Maze Sprint (E9), Line Clear (E10), Roulette (D3) | 5 |

> P0 group is 5 games ranked; the MVP ships the top 3 (A1, A2, E1) with D1/A3 as fast-follows. See
> `minigame-ideas.md` for the full ranked table and rationale.

**Sports wave (2026-09-28, D20)** — brand-new ideas beyond the ranked list: the Konami-style track &
field events 100 m Dash (`dash-100m`), 110 m Hurdles (`hurdles-110m`), Long Jump (`long-jump`) and
Javelin (`javelin-throw`) on one shared sprint engine, plus Micro Race (`micro-race`) from the racing
cluster below. Catalog section F.

---

## Icebox / ideas (unscheduled)

- [x] **Pixel Split ("cut in half")** — E11 (`pixel-split`, shipped 2026-07-22): drag a vertical cut so
      both halves of a seeded pixel object hold the same number of filled pixels; scored against the best
      achievable split. Server owns the per-column counts.
- [x] **Pixel Weight ("guess the weight")** — E12 (`pixel-weight`, shipped 2026-07-22): a pixel object
      flashes, then guess its filled-pixel count on a slider; points scale with closeness. Server owns
      the counts. *Balance variant not built.*
- [x] **Quick Tetris** — E13 (`quick-tetris`, shipped 2026-08-22; ticked 2026-10-03): short, fast
      Tetris sprint (compact variant of E10 Line Clear Sprint);
      identical seeded piece sequence, clear the most lines in a short window. *P3, rides the action wave.*
- [x] **Sudoku Race** — E14 (`sudoku-race`, shipped 2026-08-21): everyone races the same seeded 4×4
      sudoku (2×2 boxes, 8 of 16 cells blank); tap a blank to cycle it 0→1→2→3→4→0. Winner is
      first-to-solve, else most correct cells placed. The solved grid is drawn from a canonical valid
      sudoku via seeded digit relabeling + row/col/band/stack permutations (no backtracking solver
      needed) and never sent on the wire — only fills + a correctness count.
- [x] **Bubble Pop ("Bust-a-Move")** — E15 (`bubble-pop`, shipped 2026-08-22; ticked 2026-10-03):
      bubble-shooter puzzle — aim and shoot coloured bubbles
      upward at a hanging cluster; 3+ touching same-colour bubbles pop and unattached bubbles drop for a
      bonus. Same seeded starting board + shot-colour queue for everyone; server owns the grid and
      validates each shot. Ranked by bubbles cleared (finishers by fastest board-clear). *P3 — latency-
      tolerant (self-paced, common seed) but high build effort (aim physics + hex-grid snap + cluster
      flood-fill); rides the puzzle/action wave.*
- [x] **Racing cluster** (top-down pixel racers; real-time, high latency sensitivity → ride the Phase 5
      action wave once netcode interpolation/prediction is proven). All seeded so every player gets the
      same track/AI; server-authoritative positions.
  - [x] **Micro Race** (`micro-race`, Micro Machines style) — chaotic top-down sprint on a tabletop-scale
        track; laps around a short circuit, bumping/hazards, first across the line wins (placements →
        position points). FFA, short. *Shipped 2026-09-28 (catalog F5, D20): 3 seeded tabletop circuits,
        3 laps, arcade drift/bump physics, anti-shortcut rescue.*
  - [x] **Rally Stage** (`rally-stage`) — *Shipped 2026-10-03 (catalog F6, D22).* Point-to-point
        time-trial against the clock on a twisty stage
        (no direct contact); rank by finish time. Handles/grip + checkpoints; FFA scored by time.
  - [x] **Speed Circuit** (`speed-circuit`) — *Shipped 2026-10-03 (catalog F7, D22).* Multi-lap
        wheel-to-wheel race on a proper circuit; racing
        line + slipstream/boost pickups; final lap order → placements. FFA (duel/team variants later).
- [x] **Pixel Split — reset the cut to the far left each object** — *Done 2026-07-23: the `pixel-split`
      cut selector now initialises at the leftmost boundary on every object (was centred), so symmetric
      figures are no longer trivially solved by the default cut. Client selector-init change; server
      still owns the per-column counts. See `implementation-decisions.md` D1.*
- [x] **Simon per-pad tones** — *Done 2026-07-23: each Simon (`simon`) pad now plays a distinct pitch
      on tap and during sequence playback, via a new `Sfx.pad()` on the existing WebAudio 8-bit synth
      (no assets, respects the SFX volume). See `implementation-decisions.md` D2.*
- [x] **New mini-game ideas (requested 2026-09-28)** — arcade classics reworked as FFA party rounds; all
      real-time and keyboard-first (PC) unless noted. Each needs a catalog card + the usual module/scene.
  - [x] **Bomber Express** (`bomber-express`, Bomberman style) — *Shipped 2026-10-03 (catalog I5,
        D22).* Grid arena with destructible crates;
        everyone starts fully powered up (**fire range 5+, 5 bombs, speed boost by default**) so it's
        chaos from second one, with extra power-ups dropping from crates. Last one standing, then most
        knock-outs. Seeded crate layout; server owns the grid, bombs and chain reactions.
  - [x] **Vertical shooter** (`star-blaster`, bullet-hell shmup) — *Shipped 2026-10-03 as Star
        Blaster (catalog I3, D22).* A vertically scrolling ship: dodge bullet patterns and
        destroy targets. Same seeded waves for everyone (own lane/viewport each, so it's a fair race);
        ranked by score, hits taken cost points/lives.
  - [x] **Pang** (`pang`, Buster Bros style) — *Shipped 2026-10-02 (catalog I2, D22; own arena per
        player, same seeded waves).* Fire a harpoon straight up to split bouncing balloons into
        smaller ones until they vanish; touching a balloon costs a life. Seeded balloon sets; ranked
        by balloons popped (shared arena variant: steal each other's pops).
  - [x] **Competitive Asteroids** (`asteroids`) — *Shipped 2026-10-03 as Asteroids Arena (catalog I4,
        D22).* Shared wrap-around arena: rotate, thrust and shoot; points for
        asteroids and more for shooting rivals, short respawn after a hit. Ranked by score.
  - [x] **Brawl** (`brawl`, Streets of Rage-style competitive beat 'em up) — *Shipped 2026-10-03 as
        Street Brawl (catalog I6, D22).* Everyone in one side-view street,
        punch/kick/grab combos, weapons and items that drop and can be picked up (pipes, bottles,
        food to heal). Last one standing, then most KOs.
  - [x] **Sumo ICE battle royale** (`sumo-ice`) — *Shipped 2026-10-02 (catalog I1, D22; PC-first + a
        lifebuoy second life).* Sumo Push on an ice floe that melts and shrinks over
        time (low-friction, slippery physics; cracking edge tiles). Last one standing. Can reuse the
        `sumo` physics with lower friction + a shrinking, seeded melt pattern. Likely mobile-friendly.
- [x] **Squid Game-style elimination cluster (requested 2026-09-29, designs refined 2026-10-02)** —
      short, tense, laugh-out-loud FFA rounds where the fun is watching friends get zapped. Shared
      design rules:
      - Ranked by elimination order (survivors share 1st); 30–45 s rounds that end early when only
        one player is left.
      - **Nobody is out in the first seconds**: each game delays or softens the first elimination (a
        heart, a warm-up phase), so being out early never means 40 s of boredom.
      - Eliminated players stay on screen, dimmed, as spectators. Their exit is a big dramatic
        moment: an ELIMINATED stamp, a pixel-burst and a sound sting, so being out is part of the joke.
      - One shared **elimination kit**, built once and reused by all three games: the stamp/burst/sting
        in `fx`, a "7/10 LEFT" survivors counter in the `hud`, and spectator dimming.
      - Server-authoritative with a seeded setup. Original names and art (no show branding).
      - **Players look like their lobby avatar:** each player is drawn with their chosen avatar and
        identity color, using the shared character spec/sprite set from the *Visual consistency audit*
        below, not a per-scene figure. If the audit hasn't landed yet, build these games on the lobby
        avatar sprites directly, so they never need migrating.
  - [x] **Freeze Doll** (`freeze-doll`, "Red Light, Green Light" — the laser one) — *Shipped
        2026-10-02 (catalog G2, D22).* Race down your own lane toward a giant pixel doll. One lane per player (up to 10), so there are no collisions and
        it stays readable on the big screen.
        - **Movement with momentum (the core skill):** hold WALK to move. Releasing does not stop you
          dead: you glide for ~150 ms. An optional **RUN** key (Shift, or a second touch button) is
          ~1.6× faster but slides for ~400 ms. RUN is the risk/reward call: gain ground, but stop late.
        - **Doll cycle:** while she faces away (GREEN), a chant plays at a seeded, varying tempo; she
          turns when it ends. Tells: the last note plus a head twitch. Seeded fake-outs (a half-turn
          that snaps back) punish players who stop too nervously by costing them time.
        - **The laser:** on RED, her eyes **sweep a laser beam across the lanes** (~0.5 s, direction
          seeded and alternating each turn for fairness). Each lane is judged at the instant the beam
          crosses it: still moving (server-side speed > 0) = hit. The sweep *is* the latency grace
          window (≥150 ms before the first lane is judged), and you can see it coming.
        - **Two hearts:** the first hit stuns you for 1 s, knocks you back ~15 % of the field and
          cracks a heart. The second hit gets you lasered: ELIMINATED.
        - **Escalation:** GREEN phases get shorter and fake-outs more frequent as the clock runs down.
        - **Result:** finish order first, then distance covered when the clock ends, then elimination
          time.
        - Input is hold-state (`walk | run | stop`), so it works with keys or two big touch buttons →
          **mobile-friendly**. Axes: reflexes + nerve.
  - [x] **Glass Bridge** (`glass-bridge`) — *Shipped 2026-10-02 (catalog G1, D22).* A bridge of N
        rows, each with a left and a right glass panel; one panel per row is tempered, the other
        shatters.
        - **Order (the first one starts):** players line up on the start platform in a seeded order
          (vest numbers), and #1 steps out first while the rest wait on the platform. When the runner
          falls, the next vest auto-walks to the frontier and picks up from there.
        - **Known rows auto-walk:** nobody re-jumps a row already solved, so the round never drags.
        - **Jump timer:** ~4 s per unknown row; hesitating too long forces a random jump. An overall
          bridge clock ends the round: anyone still on the bridge or in the queue falls.
        - **Glint (skill in a luck game):** a seeded lightning flash lights the bridge for ~150 ms every
          few seconds, and the tempered panel reflects slightly differently. Sharp-eyed players can
          read it (the subtlety is a tuning knob).
        - **Heckle arrows (social twist):** waiting players can point LEFT/RIGHT at the jumper's next
          row. The arrows show in their colors, and the jumper decides whether to trust friends who
          gain from their fall.
        - **Tuning math:** every unknown row costs one fall half the time, so expected falls ≈ rows ÷ 2.
          With rows ≈ players + 2, about 30–40 % survive (8 players → 10 rows → ~3 survive, ~15 jumps,
          ~35 s).
        - **Result:** rows reached; survivors share 1st.
        - **Possible variant:** the current leader goes first, as comic catch-up. Not the default,
          because the mini-game init ctx has no standings today, so this needs a contract change.
        - Turn-based taps → **mobile-friendly** and latency-tolerant. Axes: nerve + focus.
  - [x] **Room Rush** (`room-rush`, "Mingle" — the rooms one) — *Shipped 2026-10-02 (catalog G3,
        D22).* A top-down arena: a slowly rotating
        round carousel in the middle (riders drift with it) and small rooms with doors around the
        edge. Each round has 3–4 calls, and each call runs in two phases:
        - **MUSIC** (~5 s): everyone rides the carousel and the doors stay shut.
        - **CALL:** a giant number ("3!") appears and the doors open for ~6 s. Each room shows a live
          counter ("2/3"). A room **locks** once it has held exactly N players for ~0.5 s: the door
          slams, the counter turns green and those inside are safe. That half-second is the sabotage
          window to barge in and spoil it.
        - **Elimination:** at the buzzer, a room still open with the wrong count eliminates everyone
          inside, and anyone left outside is out too.
        - **Number math:** N is seeded in 1–4 (and N ≤ survivors − 1); rooms = ⌊(survivors − 1) ÷ N⌋,
          so total capacity is always below the survivor count and at least one player goes out per
          call.
        - **Final two:** N = 1 with a single room, a pure race-and-shove duel.
        - **Shoving:** reuse the `sumo` body physics (bouncy collisions) plus a short **dash** (Space,
          ~1 s cooldown) to bump someone out of a doorway. This is what makes it a party game.
        - Real-time movement → **PC-first** (WASD/arrows + Space). Touch gets drag-to-move + a dash
          button (playable, not promised). Axes: speed + nerve.
  - [x] *Suggested extras in the same spirit (not requested — kept, built one by one)*: **Honeycomb Cut**
        (*shipped 2026-10-03, catalog G4*)
        (carve a shape out of a candy by tracing its outline; press too hard or leave the line and it
        cracks → mouse/touch precision), **Jump Rope** (*shipped 2026-10-03, catalog G5*; a giant rope swings faster and faster; tap to
        jump in rhythm or get swept off), **Marbles Duel** (*shipped 2026-10-03, catalog G6*; 1v1 guess odd/even of the marbles your
        rival hides — quick bluffing duel).
- [x] **Visual consistency audit across all mini-games** — *Done 2026-10-03 (D23,
      [`visual-audit.md`](visual-audit.md)):* a new 16×16 avatar set (front/side/back, expressions,
      stride frames, computed outline + shading) used by the lobby and by all 54 scenes; the bespoke
      figures (runner, rikishi, pullers, gunslingers, slime, athletes) are gone; one YOU marker, name
      tags, shadows and avatar strips everywhere; spec in `art-direction.md` §6.1.
      *Original request:* review every scene side by side and make
      them read as one game. Today each scene draws its own player figure (Pixel Dash's capped runner,
      Sumo's top-down rikishi, the track & field rig athlete, Micro Race's cars…) with different sizes,
      proportions, outlines and palettes, and none of them resembles the lobby's pixel avatar
      ("monigote"). Deliverables: (1) an inventory of every character/player sprite and how each game
      shows identity (color, avatar, name); (2) a shared character spec in `art-direction.md` (grid
      size, outline, shading, how the identity color and the chosen avatar show up in-game); (3) ideally
      a designer-made avatar set (front/side/top-down variants + a few poses) that every scene reuses,
      so a player looks like "their" avatar in every game; (4) migrate the scenes to it (one shared
      sprite module instead of per-scene ASCII grids). *Requested 2026-09-28; needs design input.*
- [ ] **Weird Trivia (`weird-trivia`)** — a *fast* trivia round where the questions are **not** general
      knowledge but very strange, absurd, hard-to-believe facts: bizarre animal biology, odd laws, weird
      world records, "which of these is real?". The laugh is the "no way that's true!" moment when the
      answer reveals. *Requested 2026-10-03.*
        - Reuse the Trivia engine and scene (A3) with its own seeded question bank and a shorter answer
          window (fast rounds). Ship it as its own catalog entry so line-ups can pick it on its own.
        - Every answer must be a **real, verifiable fact** (no invented trivia); the distractors are
          plausible-but-absurd. Each question gets a one-line "fun fact" shown on the reveal.
        - Bank written natively in EN and ES (localized jokes, not literal translations).
        - Mobile-friendly (four big answer buttons). Axes: knowledge + reflexes.
- [ ] **Dark / acid humor pass** — review the games and give some of them a touch of black, acid humor:
      elimination stamps, round-result taglines, game-over and waiting quips, NPC reactions (the Freeze
      Doll, the Glass Bridge crowd, the rope turners, the Quick Draw undertaker…), loading/intro blurbs.
      *Requested 2026-10-03.*
        - Aim at the situation and at the loser's pride (friendly banter for a LAN party of friends),
          never at real people or groups.
        - Written per language (EN and ES each get their own jokes), through the i18n keys.
        - Start with an inventory of the existing flavor lines (e.g. the round-result taglines "Nailed
          it!" / "Loser!!") and pick the games where it fits. Open question: a host toggle for the
          spicier lines.
- [ ] Manual mini-game selection/editor by the host.
- [ ] Spectator mode.
- [ ] Custom trivia packs.
- [ ] Cosmetic pixel themes / seasonal skins.
- [x] ~~Multi-instance scaling with a Redis pub/sub backplane~~ — **dropped, not planned** (D17): the
      target deployment is a single-instance LAN party, which never needs more than one process.
