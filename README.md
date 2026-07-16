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
| [`docs/minigame-catalog.md`](docs/minigame-catalog.md) | Initial mini-game catalog with mechanics, rules, win condition, and scoring. |
| [`docs/scoring-system.md`](docs/scoring-system.md) | Scoring across mini-games, session ranking, and tiebreakers. |

## Concept in one line

Enter a room with a code, wait in the lobby for your group, play N short mini-games in a row, and crown
whoever accumulated the most points.

## Tech (in definition)

Runtime: **Bun**. Real-time, server-authoritative state. Full technical stack is being finalized from a
reference project — see PRD §8.
