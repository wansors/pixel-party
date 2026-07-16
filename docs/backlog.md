# Backlog — Pixel Party

- **Version**: 0.1 (draft)
- **Date**: 2026-07-16

Phased product backlog. The philosophy is **start with a minimal MVP and grow incrementally** — build
the smallest thing that is fun end-to-end, then add features (more mini-games, handicap, post-match
analysis…) phase by phase. Nothing is built "just in case".

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
- [ ] Bun workspaces monorepo skeleton (`apps/*`, `packages/*`), `bunfig.toml`, `tsconfig.base.json`.
- [ ] Biome + TS strict + `bun test` + determinism script + CI (see `technical-architecture.md` §8).
- [ ] `@pp/shared` protocol skeleton (`PROTOCOL_VERSION`, `ClientMsg`, `ServerMsg`, core DTOs).
- [ ] Server hexagonal skeleton + `composition-root.ts` + `config.ts` + `index.ts`.
- [ ] `LiveRooms` in-memory authoritative store; `Clock`, `Random`, `IdGenerator` ports + adapters.

### Rooms & session
- [ ] Create room (code) + join by code/link (HTTP `/api` + WS upgrade with server-resolved identity).
- [ ] Lobby: player list, ready state, host role, host starts session.
- [ ] WS transport (`Bun.serve`) + intent registry + hand-written shape validator.
- [ ] Session engine: sequence N rounds, cycle intro → play → results (random selection).
- [ ] Basic reconnection (rejoin ongoing session, restore scoreboard).

### Mini-games (3, individual, latency-tolerant)
- [ ] Quick reaction ("Go!") — A1.
- [ ] Button masher — A2.
- [ ] Lightning quiz (Trivia) — A3.  *(alt: Simon A4)*

### Scoring
- [ ] Position → points table, cumulative scoreboard after each round.
- [ ] Final ranking + tiebreakers.

### Client
- [ ] Angular 20 shell: join, lobby, round intro, results, final ranking.
- [ ] Phaser scenes for the 3 mini-games; `GameSocketService` + `ServerMsgRouter`; `runOutsideAngular`.
- [ ] Responsive mobile (portrait) + desktop.

---

## Phase 1 — More individual games & robustness

- [ ] Grow catalog to ~6 individual games: Simon (A4), Balloon Chicken (D1), Bug smash (A6), Timing (A10).
- [ ] Host config: number of rounds, no-repeat within a session.
- [ ] Reconnection hardening, host transfer on disconnect, kick player, room inactivity timeout.
- [ ] Observability: structured logging of room events + latency/error metrics.

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
| MVP | P0 | Quick reaction (A1), Button masher (A2), Color Trap (E1), Balloon Chicken (D1), Trivia (A3) — ship 3, rest close behind | 0 |
| +1 | P1 | Simon (A4), Higher/Lower (E5), Quick Math (E2), Odd One Out (E3), Number Rush (E4), Bug smash (A6), Timing (A10), Memory Flash (E8), Pixel Hoops (A5) | 1 |
| +2 | P2 | Tug of War (C1), Sink the Fleet (B2), Match (A11), Bomb Relay (C2), Quick Draw Duel (E7), Pixel Beat (E6), Fruit Catch (D2), Fleet Battle (C3) | 2 |
| +action | P3 | Pong (B1), Sumo (B3), Pixel Dash (A9), Snake (A8), Maze Sprint (E9), Pixel rain (A7), Line Clear (E10), Roulette (D3) | 5 |

> P0 group is 5 games ranked; the MVP ships the top 3 (A1, A2, E1) with D1/A3 as fast-follows. See
> `minigame-ideas.md` for the full ranked table and rationale.

---

## Icebox / ideas (unscheduled)

- [ ] Manual mini-game selection/editor by the host.
- [ ] Spectator mode.
- [ ] Custom trivia packs.
- [ ] Cosmetic pixel themes / seasonal skins.
- [ ] Multi-instance scaling with a Redis pub/sub backplane.
