# CLAUDE.md — Pixel Party

## What this project is

Pixel Party: a browser-based multiplayer collection of mini-games, *Mario Party* style. Players connect
to a room from their own device, play a series of short mini-games back to back, and accumulate points
for a session-wide ranking. See [`README.md`](README.md).

## Current phase

**Documentation**, not development. Functional documentation lives in `docs/` (PRD, mini-game catalog,
scoring system).

## Project conventions

- **All documentation is written in English** (this is a shared GitHub repository). This overrides the
  global default of writing functional docs in Spanish — for this project everything is English.
- All documents we create go under `docs/`.
- Code, comments, commits, and technical names: English.

## Tech stack

- **Runtime**: Bun (confirmed).
- Real-time with low latency; the server is the authority for state.
- The rest of the stack (front rendering, real-time and other libraries) is being finalized from a
  **reference project** provided by the author (an existing HTML game with reusable libraries).
- Until that decision is closed, do not assume a default stack beyond Bun. PRD §8 tracks the open points.

## Key constraints (from the PRD)

- Real-time, low latency; server-authoritative state.
- Mini-games as pluggable modules (common contract); the engine stays game-agnostic.
- No install, no mandatory sign-up; entry via room code/link.
- Responsive: mobile + desktop.
