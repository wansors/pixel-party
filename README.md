# Pixel Party

A browser-based multiplayer collection of mini-games, *Mario Party* style: players connect to a room
from their own device, play a series of short mini-games back to back, and accumulate points to form a
session-wide ranking.

> Current status: **documentation phase**. There is no code yet; the goal of this phase is to define the
> product, the mini-game catalog, and the scoring system before building.

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/PRD.md`](docs/PRD.md) | Product Requirements Document: vision, goals, personas, flows, requirements, and scope. |
| [`docs/minigame-catalog.md`](docs/minigame-catalog.md) | Mini-game catalog with mechanics, rules, win condition, and scoring (grows over time). |
| [`docs/minigame-ideas.md`](docs/minigame-ideas.md) | ~30 mini-game ideas ranked by priority (fun, healthy competition, effort, latency). |
| [`docs/scoring-system.md`](docs/scoring-system.md) | Scoring across mini-games, session ranking, tiebreakers, and handicap. |
| [`docs/technical-architecture.md`](docs/technical-architecture.md) | Stack & architecture — mirrors the `utopia-offline` reference project. |
| [`docs/art-direction.md`](docs/art-direction.md) | Retro classic-arcade pixel-art visual identity (web, HUD, scoreboards). |
| [`docs/backlog.md`](docs/backlog.md) | Phased roadmap: minimal MVP first, then incremental epics. |

## Concept in one line

Enter a room with a code, wait in the lobby for your group, play N short mini-games in a row, and crown
whoever accumulated the most points.

## Tech

**Bun** monorepo · **TypeScript** · **hexagonal** server · **Bun-native WebSockets** · **Angular 20 +
Phaser 3** client · optional **`bun:sqlite`** · **Biome**. Server-authoritative and deterministic,
mirroring the `utopia-offline` reference project. See [`docs/technical-architecture.md`](docs/technical-architecture.md).
