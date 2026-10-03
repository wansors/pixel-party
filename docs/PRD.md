# PRD — Pixel Party

- **Version**: 0.2 (draft)
- **Date**: 2026-07-17
- **Author**: Andrés Cisneros
- **Status**: In review

---

## 1. Executive summary

Pixel Party is a social multiplayer browser game inspired by *Mario Party*. A group of players connects
to a **room** via a code and plays a **series of short mini-games** (30–90 s each) back to back. Each
mini-game awards points based on the result; points accumulate over the session, and at the end a
**global ranking** crowns the winner.

Unlike the Jackbox model (shared screen + phone as controller), in Pixel Party **each player plays on
their own device**: every client renders the full mini-game and shows its own view, synchronized in
real time with the rest.

### Value proposition
- Instant group fun for **4–12 players** (usually up to 8), nothing to install (just a browser and a link/code).
- Short, replayable matches: 10–20 minute sessions with a variety of mini-games.
- **Highly competitive and banter-driven** (*pique*): overtakes, comebacks, and laugh-out-loud moments
  are the point — a ranking plus catch-up/handicap keeps every session close.
- **Pixel-art, arcade-classic inspired**: simple, recognizable ideas (basketball, battleship, pong…)
  reskinned in a coherent pixel aesthetic.
- Mix of **individual, duel (1v1/bracket), and team** mini-games so the social dynamic keeps shifting.
- Ideal for friends and family sharing a **local network** (LAN party style) — the target is people
  physically together, not a remote/internet-scale deployment (see §8, §12).

---

## 2. Goals and success metrics

### Product goals
1. Let a group (**4–12 players**, usually up to 8) play a full session with zero setup friction.
2. Offer a catalog of mini-games that vary in mechanics, input type, and format (individual/duel/team).
3. Keep every session competitive and fun via a ranking plus catch-up/handicap mechanics.
4. Keep the real-time experience smooth and fair for all players.

### Success metrics (post-launch)
| Metric | Initial target |
|--------|----------------|
| "Link → first game" time | < 60 s |
| Completed sessions (reach final ranking) | > 70% of started sessions |
| Players who play ≥ 2 sessions in a row | > 40% |
| Perceived latency in real-time mini-games | < 150 ms (p95) |
| Disconnections that break the match | < 5% of sessions |

---

## 3. Target audience and personas

- **Groups of remote friends**: want to play together over a video call with nothing to install.
- **Work teams (remote / hybrid)**: quick team-building activities.
- **Families**: short, simple matches, including casual players.

### Personas
- **Ana (host, 28)**: creates the room, shares the link via chat, and wants to start fast.
- **Luis (casual player, 35)**: joins from his phone, doesn't want to register or install.
- **Marta (competitive, 24)**: plays on a laptop, motivated by the ranking and tiebreakers.

---

## 4. Game model

### 4.1 Connection model
- **Each player on their own device** (phone, tablet, or desktop), remotely.
- No mandatory central screen; each client renders the full game.
- State synchronization happens in real time via the server (see §8).
- **Host** role: the player who creates the room. Can start the match, adjust configuration (number of
  rounds, mini-game selection), and kick players. The role is transferable if the host disconnects.

### 4.2 Session structure
```
Session
 └─ Lobby (waiting for players)
 └─ Round 1  → Mini-game A → Results screen + points
 └─ Round 2  → Mini-game B → Results screen + points
 └─ ...
 └─ Round N  → Mini-game X → Results screen + points
 └─ Final ranking (podium, session winner)
```

### 4.3 Mini-game formats (by interaction)
- **Free-for-all**: everyone competes simultaneously. (Majority of the catalog.)
- **Duel (1v1 / bracket)**: players are paired; winners advance or pair results feed the round ranking.
  Drives head-to-head rivalry.
- **Team-based**: players split into teams; the team result awards points to all members. Requires ≥ 4
  players. Team assignment random or host-set.
- **Turn-based**: within any format, some games alternate turns (e.g., battleship).

### 4.4 Handicap / catch-up
The engine can apply optional, bounded **handicap** based on current standings (leader nerf / trailer
boost / team weighting) to keep sessions close and comebacks possible. It narrows gaps, never decides
outcomes. See `minigame-catalog.md` §H and `scoring-system.md`.

---

## 5. Main user flows

### 5.1 Create room (host)
1. Open the site → "Create room".
2. Enter a nickname (and optionally pick avatar/color).
3. The system generates a **room code** (e.g., 4–6 characters) and a shareable link.
4. Enter the **lobby** as host.

### 5.2 Join room (player)
1. Open the link or enter the code.
2. Enter nickname + avatar/color.
3. Enter the lobby; see the other connected players in real time.

### 5.3 Lobby
- List of connected players (nickname, avatar, "ready" status).
- Host configures: number of rounds, mini-game selection (random or manual), difficulty/timers.
- Host starts the match. Design range is **4–8 players** (the sweet spot for banter), up to **12**.
  Every mini-game declares the headcounts it supports (hard min/max + a recommended range): the lobby
  only offers the games that fit the room, and a game outside its range sits the session out (D27).

### 5.4 Mini-game round
1. **Intro**: screen with the mini-game name, brief rules, and a countdown.
2. **Play**: players play; state is synchronized in real time.
3. **End**: the result is determined (mini-game ranking) and points are awarded.
4. **Results**: positions and points earned are shown; the cumulative scoreboard updates.

### 5.5 End of session
- Final ranking with podium and winner.
- Options: "Rematch" (same room, new session) or "Leave".

---

## 6. Functional requirements

### FR-1 — Room management
- FR-1.1 Create a room with a unique, shareable code.
- FR-1.2 Join by code or direct link.
- FR-1.3 Configurable player limit per room (usual party 4–8; default and ceiling 12); each mini-game
  declares its min/max/recommended players and only the ones that fit the room can be picked (D27).
- FR-1.4 Ephemeral room: destroyed after the session ends or after inactivity (timeout).
- FR-1.5 Host role with configuration and start permissions; automatic transfer if the host leaves.

### FR-2 — Players
- FR-2.1 **Anonymous players, no registration**: each player gets a **unique color** (per room), a
  **pixel avatar ("monigote")** picked from a preset set, and a **name** (typed, or auto-generated if
  blank). Color + avatar + name identify the player everywhere. See `art-direction.md` §6.
- FR-2.2 "Ready/not ready" status in the lobby.
- FR-2.3 Reconnection: if a player drops, they can rejoin the ongoing session keeping their points.
- FR-2.4 Kick by the host.

### FR-3 — Session engine
- FR-3.1 Sequence N configurable mini-games (random or manual host selection).
- FR-3.2 Manage the intro → play → results cycle of each round.
- FR-3.3 No mini-game repeats within the same session (unless the catalog is exhausted).
- FR-3.4 Handle mid-session drop-out (recompute without breaking the match).
- FR-3.5 Form pairings (duel bracket) and teams (random or host-set) for the mini-games that need them.

### FR-4 — Mini-games
- FR-4.1 Each mini-game exposes: rules, win condition, timer, and an orderable result.
- FR-4.2 Mini-game architecture as a **pluggable module** (common contract, see §8.3), so new ones can
  be added without touching the engine.
- FR-4.3 Support touch and keyboard/mouse input (depending on device).
- FR-4.4 Each mini-game returns a **normalized result** (ranking or raw score) to the engine.

### FR-5 — Real time and synchronization
- FR-5.1 Synchronize room and mini-game state across all clients with low latency.
- FR-5.2 The server is the **authority** for state (basic anti-cheat); clients send inputs.
- FR-5.3 Countdowns and timers are synchronized (server clock as reference).

### FR-6 — Scoring and ranking
- FR-6.1 Award points per mini-game based on position (see `scoring-system.md`).
- FR-6.2 Accumulate points over the session and show the scoreboard after each round.
- FR-6.3 Distribute team/duel results to individual player scores.
- FR-6.4 Apply optional, bounded handicap/catch-up based on current standings.
- FR-6.5 Final ranking with defined tiebreakers.
- FR-6.6 (Optional/future) Session history and statistics.

---

## 7. Non-functional requirements

- **NFR-1 Performance**: sync latency < 150 ms p95; 60 FPS target on the client for action mini-games.
- **NFR-2 Concurrency**: support multiple simultaneous rooms; initial target ≥ 100 active rooms.
- **NFR-3 Compatibility**: modern browsers (Chrome, Firefox, Safari, Edge); **PC-first** (desktop with
  keyboard/mouse), phones supported.
- **NFR-4 Responsive**: the UI adapts to mobile (portrait) and desktop, and no mini-game may break on a
  phone; but only mini-games flagged `mobileFriendly` in the catalog promise a comfortable phone
  experience (see `implementation-decisions.md` D21).
- **NFR-5 Resilience**: tolerate transient disconnections (reconnection, FR-2.3) without breaking the
  session.
- **NFR-6 Fairness / anti-cheat**: result and input validation on the server; never trust the client.
- **NFR-7 Frictionless**: no install, no mandatory sign-up; entry via link/code.
- **NFR-8 Accessibility**: adequate contrast, touch target sizes, alternatives where feasible.
- **NFR-9 Internationalization**: text prepared for ES/EN from the design (i18n architecture).
- **NFR-10 Observability**: logging of room events and latency/error metrics.
- **NFR-11 Visual identity**: consistent **retro classic-arcade pixel-art** look across the web shell,
  HUD, and mini-games (self-hosted assets, CSP-safe), without compromising readability/accessibility.
  See `art-direction.md`.

---

## 8. Technical considerations

> **Stack decided.** Pixel Party mirrors the architecture of the reference project `utopia-offline`:
> **Bun** monorepo, **TypeScript**, **hexagonal** server, **Bun-native WebSockets**, **Angular 20 +
> Phaser 3** client, **no database** (permanently stateless/anonymous — see below), **Biome**,
> server-authoritative + deterministic core.
> Full blueprint in [`technical-architecture.md`](technical-architecture.md). This section is a summary.

### 8.1 Key technical needs
- **Bidirectional real-time** communication (WebSockets) with low latency.
- **Server-authoritative** room state.
- Frontend game rendering (**Canvas 2D**, WebGL as an option for heavier graphics).
- Ephemeral in-memory rooms; **no persistence** — the game is stateless and players stay anonymous by
  design (not an MVP simplification; see `technical-architecture.md` §7).

### 8.2 Stack (decided — mirrors `utopia-offline`)

| Area | Choice |
|------|--------|
| Runtime | Bun (workspaces monorepo) |
| Language | TypeScript (shared model/validation via `@pp/shared`) |
| Server | Hexagonal (domain / application / infrastructure) |
| Real time | Bun-native WebSockets (topic pub/sub) — no ws/socket.io |
| Wire validation | Hand-written discriminated unions + shape validator (no Zod) |
| Client shell | Angular 20 (`@angular/build`) — all DOM/UI |
| Game rendering | Phaser 3 — mini-game canvas only |
| State authority | Server-authoritative + deterministic (seeded `Random`, `Clock`) |
| Persistence | **No DB, permanently** — all in-memory/ephemeral, by design (see `technical-architecture.md` §7) |

The main advantage of Bun + TypeScript is sharing the data model and validation logic between client and
server. See [`technical-architecture.md`](technical-architecture.md) for the full mapping and the
mini-game plugin contract.

### 8.3 Mini-game contract (conceptual draft)
Each mini-game should implement a common contract to be pluggable into the engine:
- `init(config, players)` — set up initial state.
- `onInput(playerId, input)` — process a player input (validated on the server).
- `tick(dt)` — advance the simulation (for action mini-games).
- `isFinished()` — end condition.
- `getResult()` — normalized result: player ranking or orderable raw score.

The **session engine** only knows this contract, not the internal logic of each mini-game → new
mini-games can be added without modifying the core.

### 8.4 Logical architecture (high level)
```
[ Client (browser) ]  <-- WebSocket -->  [ Game server (Bun) ]
   - Lobby/ranking UI                       - Room manager (in-memory state)
   - Mini-game rendering (Canvas)           - Session engine (round sequence)
   - Input sending                          - Mini-game instances (authority)
   - Visual interpolation/prediction        - Scoring computation
```

---

## 9. Scope — MVP vs future

The scope is delivered **incrementally by phases** — see `backlog.md` for the full roadmap. The MVP is
deliberately minimal; formats, handicap, and analysis come in later phases.

### MVP (v1 — Phase 0)
- Create/join a room by code (up to 12 players); lobby with player list.
- **Fixed default number of rounds** (host-configurable from Phase 1); random mini-game selection.
- **3 individual, latency-tolerant mini-games**: Quick reaction (A1), Button masher (A2), Color Trap
  (E1). Trivia (A3) and Balloon Chicken (D1) are the fast-follows (see `minigame-ideas.md`, `backlog.md`).
- Full session cycle: rounds → results → final ranking.
- Position-based scoring and session ranking with tiebreakers.
- Basic reconnection.
- Responsive mobile + desktop.

### Out of MVP (later phases — see `backlog.md`)
- More mini-games (the catalog grows wave by wave).
- **Team and duel formats** (Phase 2) with team/duel result distribution.
- **Handicap / catch-up** (Phase 3).
- **Post-match analysis & player radar/pentagon** (Brain Training style — per-axis score profile, Phase 4).
- **Real-time action mini-games** once the netcode is proven (Phase 5).

> Phase 5 is the last numbered phase. There is no Phase 6 (accounts/persistent history/achievements,
> permanently dropped — the game stays stateless and anonymous by design, `technical-architecture.md`
> §7) and no Phase 7 (avatars/customization, emotes, in-room chat, public matchmaking, also permanently
> dropped; audio and i18n already shipped in Phase 0). See `backlog.md` and `implementation-decisions.md`
> D15/D16.

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Latency/desync in action mini-games | High | Server-authoritative + client interpolation; start with latency-tolerant mini-games |
| Cheating (client manipulation) | Medium | Server-side result and input validation (NFR-6) |
| Disconnections break the match | High | Reconnection (FR-2.3) + timeouts and recompute without blocking |
| Complexity of adding mini-games | Medium | Pluggable contract (§8.3) and game-agnostic engine |
| Device/input fragmentation | Medium | Design mini-games with simple, responsive-first inputs |
| Abuse/toxicity (nicknames) | Low | Private code-based rooms only — no public matchmaking is planned (D16), so exposure stays limited to whoever the host shares the room code with |

---

## 11. Glossary

- **Room**: an ephemeral space identified by a code where the players of a session gather.
- **Session**: a full match (series of rounds up to the final ranking).
- **Round**: an instance of a mini-game within a session.
- **Host**: the player who creates and controls the room configuration.
- **Free-for-all**: a simultaneous everyone-vs-everyone mini-game.
- **Normalized result**: a mini-game's standard output (ranking/score) consumed by the engine.

---

## 12. Open questions / pending decisions

1. Default number of rounds per session and target total duration (MVP uses a fixed default; value TBD).
2. Room code length/format.

Resolved:
- **Persistence** — no DB, permanently; strictly in-memory/ephemeral by design, not just for the MVP
  (see §8, `technical-architecture.md` §7).
- **Art direction** — retro classic-arcade pixel-art identity (see `art-direction.md`).
- **Mini-game selection** — MVP is **random-only**; host **manual** selection/editor is a later add (see
  `backlog.md` Icebox). Configuring the **number of rounds** moves to **Phase 1** (`backlog.md`).
- **Scaling** — single-instance, permanently. The target is a LAN party (players physically together on
  one local network), not an internet-scale deployment, so a multi-instance/Redis backplane has no
  use case and is dropped from the roadmap (see `implementation-decisions.md` D17).

> Stack is decided (§8). Remaining technical open points are tracked in `technical-architecture.md` §10.
