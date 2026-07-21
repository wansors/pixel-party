# CLAUDE.md — Pixel Party

## What this project is

Pixel Party: a browser-based multiplayer collection of mini-games, *Mario Party* style. Players connect
to a room from their own device, play a series of short mini-games back to back, and accumulate points
for a session-wide ranking. See [`README.md`](README.md).

## Current phase

**Phase 0 — MVP essentially complete** (development started 2026-07-20). The stack is scaffolded and the
MVP is playable end-to-end. Run it with `bun run dev` (see `README.md`). Live now: rooms + lobby
(ready/host), host game selector + round count, server-authoritative session engine (intro countdown →
play → per-round result → cumulative scoreboard → final), scoring/scoreboard/final ranking,
**12 mini-games** (`button-masher`, `reaction-duel`, `color-trap`, `trivia`, `balloon-chicken`,
`number-rush`, `quick-math`, `odd-one-out`, `higher-lower`, `bug-smash`, `stop-clock`, `memory-flash`),
**mid-session reconnect/rejoin**, **audio** (background music + synthesized 8-bit SFX + volume sliders),
**GitHub Actions CI**, and the **retro arcade look & feel** (palette theme, arcade
frame, pixel-art avatars, high-score tables). Remaining polish: self-hosted pixel-font binary (scaffold
ready) + per-breakpoint responsive tuning. See `docs/backlog.md` → *Current status* for the
authoritative checklist.

Documentation lives in `docs/`:
- `PRD.md` — product requirements.
- `minigame-catalog.md` — mini-game catalog (grows over time).
- `minigame-ideas.md` — ~30 mini-game ideas ranked by priority.
- `scoring-system.md` — scoring, ranking, handicap.
- `technical-architecture.md` — stack & architecture (mirrors `../utopia-offline`).
- `art-direction.md` — retro classic-arcade pixel-art visual identity.
- `backlog.md` — phased roadmap (MVP first, then incremental epics); tracks implementation status.

## Code layout (implemented)

- `apps/server` — hexagonal: `domain/` (entities `Room`/`Player`, `minigames/` pluggable contract +
  `buttonMasher`/`reactionDuel`/`colorTrap`/`trivia`/`balloonChicken`/`numberRush`/`quickMath`/`oddOneOut`/`higherLower`/`bugSmash`/`stopClock`/`memoryFlash`
  + `registry`, `services/scoring`,
  `ports/Random`), `application/`
  (`session/SessionEngine`+`SessionManager`, `use-cases/`, `ports/`), `infrastructure/`
  (`driving/ws/GameSocket`+`validate`+`simulationLoop`, `driving/http`, `driven/{time,random,id}`,
  `live/LiveRooms`), `composition-root.ts`, `config.ts`, `index.ts`.
- `packages/shared` — `protocol.ts` (wire unions + `PROTOCOL_VERSION`), `catalog/minigames`, `games/`
  (per-game wire snapshot/input types).
- `apps/client` — Angular 20 shell; `features/{join,room}` (RoomComponent drives all phases);
  `core/net/game-socket.service`; `game/` (Phaser, framework-agnostic): `GameClient`,
  `serverMsgRouter`, `RoundState`,
  `scenes/{ButtonMasherScene,ReactionScene,ColorTrapScene,TriviaScene,BalloonChickenScene,NumberRushScene,QuickMathScene,OddOneOutScene,HigherLowerScene,BugSmashScene,StopClockScene,MemoryFlashScene}`.

### Adding a mini-game
One domain module (`domain/minigames/<id>.ts` implementing `MiniGame`) + registry entry + shared wire
types in `packages/shared/src/games/` + one Phaser scene (key === mini-game id) + a `MINIGAMES` catalog
entry. The session engine and wire contract don't change.

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
- **No database in Phase 1** — rooms, sessions, players and scores are in-memory/ephemeral; nothing is
  persisted when a room closes. Players are anonymous (unique color + preset pixel avatar + name).
  `bun:sqlite` is a later-phase add-on only (Phase 6).
- **Retro classic-arcade pixel-art** visual identity across web, HUD and mini-games (see
  `docs/art-direction.md`); self-hosted assets, CSP-safe.
- **Biome** (100 cols, single quotes, semicolons as-needed); `bun test` + Karma for client.
- Mini-games are **pluggable modules** (common contract); the session engine stays game-agnostic.

## Key constraints (from the PRD)

- Real-time, low latency; server-authoritative state.
- Mini-games as pluggable modules (common contract); the engine stays game-agnostic.
- No install, no mandatory sign-up; entry via room code/link.
- Responsive: mobile + desktop.
