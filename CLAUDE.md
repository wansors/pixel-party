# CLAUDE.md — Pixel Party

## What this project is

Pixel Party: a browser-based multiplayer collection of mini-games, *Mario Party* style. Players connect
to a room from their own device, play a series of short mini-games back to back, and accumulate points
for a session-wide ranking. See [`README.md`](README.md).

**Deployment target: a local LAN party with friends** — one process, on one local network, no accounts.
This is the reason the project is permanently stateless/anonymous/single-instance by design (no DB, no
social/public-matchmaking phase, no multi-instance scaling — see `docs/implementation-decisions.md`
D15–D17). Don't propose features that assume an internet-facing, multi-tenant, or persistent deployment.

## Current phase

**Phases 0 & 1 complete** (development started 2026-07-20; closed out 2026-07-23). The stack is
scaffolded and the game is playable end-to-end. Run it with `bun run dev` (see `README.md`). Live now:
rooms + lobby (ready/host), host game selector + round count, server-authoritative session engine (intro
countdown → play → per-round result → cumulative scoreboard → final), scoring/scoreboard/final ranking,
**Phases 0–5 complete** (2026-08-21). **44 mini-games** — 38 FFA
(`button-masher`, `reaction-duel`, `color-trap`, `trivia`, `balloon-chicken`, `number-rush`,
`quick-math`, `odd-one-out`, `higher-lower`, `bug-smash`, `stop-clock`, `memory-flash`, `simon`,
`pixel-hoops`, `pixel-weight`, `pixel-split`, `fruit-catch`, `pixel-rain`, `pixel-dash`, `snake-arena`,
`sumo-push`, `match-pairs`, `pixel-roulette`, `sudoku-race`, `pixel-beat`, `maze-sprint`,
`line-clear-sprint`, `quick-tetris`, `bubble-pop`, and the 2026-09-28 sports wave `dash-100m`,
`hurdles-110m`, `long-jump`, `javelin-throw`, `micro-race` — D20, and the 2026-10-02 roadmap wave
`glass-bridge`, `freeze-doll`, `room-rush`, `sumo-ice` — D22) + 3 team (`tug-of-war`,
`bomb-relay`, `fleet-battle`) + 3 duel (`sink-the-fleet`, `pixel-pong`, `quick-draw`) — with **no-repeat
seeded line-ups** (also avoids repeating a game's primary skill axis back-to-back when possible),
**mid-session reconnect/rejoin** + **host transfer (auto-on-disconnect + manual) /
kick / idle-room reaper**, **observability** (structured JSON logs + `GET /api/metrics`),
**teams** (2 fixed teams, balanced seeded assignment + host move/shuffle, team scoring distribution),
**duels** (seeded simultaneous 1v1 pairing + win/loss aggregation),
**audio** (background music + synthesized 8-bit SFX + volume sliders),
**i18n (EN/ES)** (Transloco, runtime toggle, all UI + Phaser scenes translated),
**post-match analysis** (Phase 4: 7 skill axes tagged on the catalog → per-player skill radar +
session summary on the final screen, from `sessionAnalysis`),
**handicap** (Phase 3, **complete**: bounded scoring catch-up lever from `handicap` with a host lobby
toggle + on-results transparency, **off by default**; mechanical per-game hooks were considered and
dropped, not built — scoring lever is the whole feature, see D14),
**real-time action games** (Phase 5: client snapshot interpolation `game/netcode/SnapshotInterpolator`
+ 6 games — `fruit-catch`, `pixel-rain`, `pixel-dash`, `snake-arena`, `pixel-pong`, `sumo-push`),
**GitHub Actions CI**, the self-hosted pixel font + per-breakpoint responsive tuning, and the
**retro arcade look & feel** (palette theme, arcade frame, pixel-art avatars, high-score tables).
A **polish pass (2026-09-26, D19)** added the shared scene base/HUD/juice kit, split the room shell
into a store + view components, fixed the never-loading pixel font and closed the open playtest bugs.
**Phase 5 is the last numbered phase.** The project is **permanently stateless and anonymous by
design** — no database, no accounts, no "Phase 6" (dropped, not deferred; see D15) — and there's no
further social/polish phase either: no "Phase 7" (chat/emotes/avatar customization/public matchmaking,
dropped; see D16 — audio and i18n already shipped in Phase 0). All ~35 candidates from
`minigame-ideas.md` are now built — growing the catalog further means adding brand-new ideas, not
picking up existing backlog rows (the sports wave, D20, was the first such batch). Design decisions
from the clear-out pass live in `docs/implementation-decisions.md`. See `docs/backlog.md` → *Current status* for the authoritative
checklist.

Documentation lives in `docs/`:
- `PRD.md` — product requirements.
- `minigame-catalog.md` — mini-game catalog (grows over time).
- `minigame-ideas.md` — ~30 mini-game ideas ranked by priority.
- `scoring-system.md` — scoring, ranking, handicap.
- `technical-architecture.md` — stack & architecture (mirrors `../utopia-offline`).
- `art-direction.md` — retro classic-arcade pixel-art visual identity.
- `backlog.md` — phased roadmap (MVP first, then incremental epics); tracks implementation status.
- `implementation-decisions.md` — KISS decision log (what was built/deferred and why; revertable).

## Code layout (implemented)

- `apps/server` — hexagonal: `domain/` (entities `Room`/`Player`, `minigames/` pluggable contract +
  `buttonMasher`/`reactionDuel`/`colorTrap`/`trivia`/`balloonChicken`/`numberRush`/`quickMath`/`oddOneOut`/`higherLower`/`bugSmash`/`stopClock`/`memoryFlash`/`simon`/`pixelHoops`/`pixelWeight`/`pixelSplit`/`tugOfWar`/`sinkTheFleet`/`bombRelay`/`fruitCatch`/`pixelRain`/`pixelDash`/`snakeArena`/`pong`/`sumo`/`matchPairs`/`quickDraw`/`roulette`/`sudokuRace`/`pixelBeat`/`fleetBattle`/`mazeSprint`/`lineClearSprint`/`quickTetris`/`bubblePop`/`trackRace`/`fieldEvent`/`microRace`/`glassBridge`/`freezeDoll`/`roomRush`/`sumoIce`
  (`tetrisCore` holds the shared engine behind `lineClearSprint`/`quickTetris`; `athleticsCore` the
  sprint model behind `trackRace` (`Dash100m`, `Hurdles110m`) and `fieldEvent` (`LongJump`,
  `JavelinThrow`))
  + `registry`, `services/{scoring,teamAssignment,pairing,sessionAnalysis,handicap,finalRanking}`,
  `ports/Random`), `application/`
  (`session/SessionEngine`+`SessionManager`, `use-cases/`, `ports/`), `infrastructure/`
  (`driving/ws/GameSocket`+`validate`+`simulationLoop`, `driving/http`, `driven/{time,random,id}`,
  `live/{LiveRooms,roomSweeper}`, `observability/{logger,metrics}`), `composition-root.ts`, `config.ts`,
  `index.ts`.
- `packages/shared` — `protocol.ts` (wire unions + `PROTOCOL_VERSION`), `catalog/minigames`, `theme.ts`
  (palette + `TEAMS`), `games/` (per-game wire snapshot/input types; `pixelObjects` holds the shared
  pixel-art set for weight/split; `tetrisSprint` is shared by `line-clear-sprint`/`quick-tetris`;
  `athletics` by the four track & field events; `microRace` also holds the circuit layouts).
- `apps/client` — Angular 20 shell; `features/join`; `features/room` = `RoomStore` (per-room state,
  ServerMsg handling, intents, Phaser bridge) + `RoomComponent` shell + one view component per phase
  (`lobby/`, `intro/`, `result/`, `final/`, `live-board/`); `core/net/game-socket.service`; `game/`
  (Phaser, framework-agnostic): `GameClient`, `serverMsgRouter`, `RoundState` (snapshot + roster
  names/colors/avatars), `hud` (standard HUD strip), `fx` (juice kit, incl. the `eliminate` moment),
  `pixelStyle` (pixel-art textures/text), `avatars` (the lobby "monigote" grids + per-player textures),
  `scenes/MiniGameScene` (common base: own-snapshot guard, HUD, crash guard, relayout),
  `scenes/index` (`SCENES` id → scene map),
  `scenes/{ButtonMasherScene,ReactionScene,ColorTrapScene,TriviaScene,BalloonChickenScene,NumberRushScene,QuickMathScene,OddOneOutScene,HigherLowerScene,BugSmashScene,StopClockScene,MemoryFlashScene,SimonScene,PixelHoopsScene,PixelWeightScene,PixelSplitScene,TugOfWarScene,SinkTheFleetScene,BombRelayScene,FruitCatchScene,PixelRainScene,PixelDashScene,SnakeArenaScene,PongScene,SumoScene,MatchPairsScene,QuickDrawScene,RouletteScene,SudokuRaceScene,PixelBeatScene,FleetBattleScene,MazeSprintScene,LineClearSprintScene,QuickTetrisScene,BubblePopScene,Dash100mScene,Hurdles110mScene,LongJumpScene,JavelinThrowScene,MicroRaceScene,GlassBridgeScene,FreezeDollScene,RoomRushScene,SumoIceScene}`
  (`TetrisSprintSceneBase` is the shared base behind the two Tetris-style scenes; `TrackRaceSceneBase`
  / `FieldEventSceneBase` + `athleticsKit` behind the athletics scenes; `microRaceArt` paints the
  racer's tracks and cars)
  + `netcode/SnapshotInterpolator` (client-side interpolation for real-time scenes).

### Adding a mini-game
One domain module (`domain/minigames/<id>.ts` implementing `MiniGame`) + registry entry + shared wire
types in `packages/shared/src/games/` + one Phaser scene extending `MiniGameScene` (key === mini-game
id) registered in `game/scenes/index.ts` + a `MINIGAMES` catalog entry (incl. the required
`mobileFriendly` call) + `catalog.minigame.<id>` name/blurb in both `en.json` and `es.json`. The session engine and wire contract don't change.

### Project skills (`.claude/skills/`)
`verify-all` (full quality gate; bootstraps Bun if missing), `playtest-screenshots` (bots + headless
Chrome screenshot a whole session), `minigame-scene` (build/polish a scene on the shared base — the
quality bar lives there), `add-i18n-keys` (locked EN+ES merge helper), `promo-video` (update/re-render
`docs/promo/`). Use them instead of ad-hoc scripts.

## Project conventions

- **All documentation is written in English** (this is a shared GitHub repository). This overrides the
  global default of writing functional docs in Spanish — for this project everything is English.
- All documents we create go under `docs/`.
- Code, comments, commits, and technical names: English.

## Tech stack (decided)

Mirrors the reference project **`../utopia-offline`** — same architecture and conventions. Full
blueprint in `docs/technical-architecture.md`.

- **Bun** workspaces monorepo, **TypeScript** (`strict`, `noEmit`).
- **Hexagonal** server (domain / application / infrastructure); server-authoritative + deterministic
  (seeded `Random`, `Clock` ports; the domain never calls `Math.random`/`Date.now`).
- **Bun-native WebSockets** (topic pub/sub); wire contracts in `@pp/shared` as discriminated unions with
  a **hand-written** shape validator (**no Zod**).
- **Angular 20** shell (all DOM/UI) + **Phaser 3** (mini-game canvas only), kept decoupled.
- **i18n**: **Transloco** (`@jsverse/transloco`), EN/ES, mirroring `../utopia-offline` — static bundled
  loader (`assets/i18n/{en,es}.json`), `LanguageService` (signal + localStorage `pp_lang`, default EN),
  `CatalogI18nService` for mini-game names/blurbs (English fallback to `@pp/shared` meta), runtime
  EN|ES toggle. Phaser scenes receive a `Translate` fn injected via `GameClient` (framework-agnostic).
- **No database, permanently** — rooms, sessions, players and scores are in-memory/ephemeral; nothing is
  persisted when a room closes. Players are anonymous (unique color + preset pixel avatar + name). This
  is a durable product decision, not an MVP simplification — there is no future phase that adds
  `bun:sqlite`, accounts, or history (see `docs/implementation-decisions.md` D15).
- **Retro classic-arcade pixel-art** visual identity across web, HUD and mini-games (see
  `docs/art-direction.md`); self-hosted assets, CSP-safe.
- **Biome** (100 cols, single quotes, semicolons as-needed); `bun test` + Karma for client.
- Mini-games are **pluggable modules** (common contract); the session engine stays game-agnostic.

## Key constraints (from the PRD)

- Real-time, low latency; server-authoritative state.
- Mini-games as pluggable modules (common contract); the engine stays game-agnostic.
- No install, no mandatory sign-up; entry via room code/link.
- **PC-first** (keyboard/mouse on a big screen, D21). Every scene still has touch controls and must not
  break at phone sizes, but only games flagged `mobileFriendly` in the catalog promise a good phone
  experience (lobby badge + "Mobile" filter, "Best on PC" on the round intro).
