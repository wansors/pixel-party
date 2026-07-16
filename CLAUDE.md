# CLAUDE.md — Pixel Party

## What this project is

Pixel Party: a browser-based multiplayer collection of mini-games, *Mario Party* style. Players connect
to a room from their own device, play a series of short mini-games back to back, and accumulate points
for a session-wide ranking. See [`README.md`](README.md).

## Current phase

**Documentation**, not development. All documentation lives in `docs/`:
- `PRD.md` — product requirements.
- `minigame-catalog.md` — mini-game catalog (grows over time).
- `minigame-ideas.md` — ~30 mini-game ideas ranked by priority.
- `scoring-system.md` — scoring, ranking, handicap.
- `technical-architecture.md` — stack & architecture (mirrors `../utopia-offline`).
- `backlog.md` — phased roadmap (MVP first, then incremental epics).

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
- **`bun:sqlite`** raw SQL — optional; MVP rooms are in-memory/ephemeral.
- **Biome** (100 cols, single quotes, semicolons as-needed); `bun test` + Karma for client.
- Mini-games are **pluggable modules** (common contract); the session engine stays game-agnostic.

## Key constraints (from the PRD)

- Real-time, low latency; server-authoritative state.
- Mini-games as pluggable modules (common contract); the engine stays game-agnostic.
- No install, no mandatory sign-up; entry via room code/link.
- Responsive: mobile + desktop.
