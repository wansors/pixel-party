# Technical architecture — Pixel Party

- **Version**: 0.1 (draft)
- **Date**: 2026-07-16

This document defines the technical stack and architecture for Pixel Party. It deliberately **mirrors
the `utopia-offline` reference project** (Bun monorepo, hexagonal server, Angular 20 + Phaser 3 client,
Bun-native WebSockets, server-authoritative + deterministic core). The same conventions apply; only the
domain changes (rooms / sessions / mini-games / scoring instead of an MMORPG world).

> Reference: `../utopia-offline`. When in doubt about a convention, follow that project.

---

## 1. Stack summary

| Layer | Technology |
|-------|-----------|
| Runtime | **Bun** (workspaces monorepo) |
| Language | **TypeScript** (ESNext, `strict`, `noEmit` — tsc is type-checker only) |
| Server | Bun process, **hexagonal** (domain / application / infrastructure) |
| Real-time transport | **Bun-native WebSockets** (`Bun.serve`) with topic pub/sub — no ws, no socket.io |
| Wire validation | **Hand-written** discriminated-union types + shape validator — **no Zod** |
| Client shell | **Angular 20** (standalone components, `@angular/build`) — all DOM/UI |
| Game rendering | **Phaser 3** — mini-game canvas only, decoupled from Angular |
| Shared contracts | `packages/shared` (`@pp/shared`): protocol + catalog data, consumed by both apps |
| Persistence | **None in Phase 1** — everything in-memory/ephemeral. `bun:sqlite` is a **later-phase** add-on only |
| Lint/format | **Biome** (100 cols, single quotes, semicolons as-needed) |
| Tests | **`bun test`** (server/shared) + **Karma/Jasmine** (client) |
| CI | GitHub Actions: determinism → lint → typecheck → test |

---

## 2. Monorepo layout

Bun workspaces, private root. Package alias `@pp/*` → `packages/*/src` (mirrors utopia's `@uo/*`).

```
pixel-party/
├── package.json            # private root, workspaces ["apps/*","packages/*"], scripts
├── bunfig.toml             # [install] exact = true
├── tsconfig.base.json      # shared compiler options, @pp/* path alias, noEmit
├── biome.json              # lint + format
├── bun.lock
├── apps/
│   ├── server/             # Bun game server (hexagonal)
│   └── client/             # Angular 20 + Phaser 3
└── packages/
    └── shared/             # @pp/shared — wire contracts + mini-game catalog metadata
```

### apps/server/src (hexagonal)
```
domain/
  entities/                 # Room, Player, Session, Round, Scoreboard, Team
  value-objects/            # RoomCode, PlayerId, Placement, Points
  services/                 # pure fns: scoring, tiebreakers, handicap, pairing/bracket
  minigames/                # mini-game contract + per-game pure logic (see §6)
  ports/                    # Random (domain-level port, consumed by minigames)
application/
  use-cases/                # one per intent: CreateRoom, JoinRoom, SetReady, StartSession,
                            #   StartRound, SubmitInput, EndRound, EndSession, Reconnect…
  ports/                    # Clock, IdGenerator, LiveRoomRegistry, SessionRepository (optional)
infrastructure/
  driving/ws/               # Bun.serve WS adapter + intent registry + shape validator
  driven/time/              # SystemClock
  driven/random/            # SeededRandom (mulberry32)
  driven/id/                # room code + id generation
  driven/persistence/       # (optional) Sqlite* repos for history
  live/                     # LiveRooms — in-memory authoritative room/session state
composition-root.ts         # the single wiring point
config.ts                   # env-driven config
index.ts                    # bootstrap().catch(...)
```

### apps/client/src
```
app/
  core/{net, ui, i18n, audio, a11y}     # GameSocketService, panel service, transloco…
  features/{lobby, room, round, scoreboard, final-ranking, join}
  shared/                                # reusable UI (frames, buttons, avatars)
  app.config.ts, app.routes.ts
game/                                     # Phaser, framework-agnostic
  GameClient.ts                           # boots Phaser, ServerMsgRouter dispatch
  serverMsgRouter.ts                      # typed ServerMsg dispatch
  RoundState.ts                           # server snapshots → scene reads
  scenes/                                 # one Phaser scene per mini-game (or a host scene)
environments/
```

### packages/shared/src
```
index.ts        # re-exports protocol + catalog
protocol.ts     # PROTOCOL_VERSION, ClientMsg, ServerMsg, all DTOs (discriminated unions)
catalog/        # mini-game metadata (id, name, format, timing, rules blurbs), scoring config
```

### Workspace wiring (same rules as utopia)
- Root `package.json`: `"workspaces": ["apps/*","packages/*"]`; scripts for `dev:server`,
  `dev:client`, `lint`, `lint:determinism`, `typecheck`, `test`, `test:client`.
- `bunfig.toml`: `[install] exact = true` (pin versions, no `^` drift).
- `tsconfig.base.json`: `target/module ESNext`, `moduleResolution bundler`, `strict`, `noEmit`,
  `paths { "@pp/*": ["packages/*/src"] }`. Server/shared extend it; the Angular client has its own
  Angular tsconfigs (does not extend base).
- `@pp/shared` consumed via `"@pp/shared": "workspace:*"` in both apps; `main: src/index.ts`, no build.

---

## 3. Hexagonal architecture (server)

Strict dependency rule: **infrastructure → application → domain**, never reverse. The domain knows
nothing about Bun, WebSocket, or SQLite.

- **domain/** — pure, zero I/O. Entities use private constructor + static `create()` (enforces
  invariants) + `reconstitute()` (trusts persisted/live state). Domain services are stateless pure
  functions (scoring, tiebreakers, handicap, bracket generation). The mini-game logic lives here and is
  pure (see §6).
- **application/** — one **use case per intent** (plain class, constructor-injected ports, single
  `execute({...})` returning a typed discriminated-union result). Defines **ports** (interfaces) at real
  external boundaries only.
- **infrastructure/** — adapters implementing ports: WS driving adapter, `SystemClock`,
  `SeededRandom`, id/room-code generator, `LiveRooms` (in-memory authoritative store), optional Sqlite
  repos.

### Ports (define only at real boundaries — KISS hexagonal)
| Port | Adapter | Notes |
|------|---------|-------|
| `Clock` | `SystemClock` | `now(): number` — timers/countdowns reference the server clock |
| `Random` (domain) | `SeededRandom` | `next(): number` 0..1, mulberry32 — deterministic mini-game seeds |
| `IdGenerator` | crypto-based | player ids, room codes |
| `LiveRoomRegistry` | `LiveRooms` | in-memory authoritative rooms/sessions (structural port) |
| `SessionRepository` | `SqliteSessionRepository` | **not in Phase 1** — future only, for session history |

### Wiring
Single **composition root** (`composition-root.ts`), no DI framework: reads config, (optionally) opens
`bun:sqlite`, `new`s the clock/random/id/live-rooms and every use case with its ports, then calls
`startGameServer({...})`. `index.ts` is just `bootstrap().catch(...)`.

---

## 4. Real-time transport

### Bun-native WebSockets
`Bun.serve({ port, fetch, websocket: { open, message, close, idleTimeout } })`. Uses Bun's built-in
pub/sub: `ws.subscribe(topic)` / `server.publish(topic, data)`.

- **Upgrade flow**: `fetch` handles `/api/*` (HTTP: create/join room, health) and upgrades WS
  connections. On upgrade, attach server-resolved identity (`playerId`, `roomCode`, `isHost`) to
  `ws.data` — **never client-asserted**. Origin allowlist check (fail-closed).
- **Topics**:
  - `room:<code>` — all lobby/round/scoreboard events for that room publish here.
  - `player:<id>` — targeted server-internal pushes (e.g., a result the tick loop emits).
- JSON messages to start; switch to binary only if measurements demand it.

### Protocol (typed, shared — no Zod)
`packages/shared/src/protocol.ts` is the single source of truth for both apps:
- `PROTOCOL_VERSION` — bumped on breaking wire changes; stamped on `WELCOME`, compared client-side,
  mismatch → "please refresh".
- `ClientMsg` — discriminated union keyed on `type`: `JOIN`, `SET_READY`, `HOST_CONFIG`,
  `START_SESSION`, `MINIGAME_INPUT`, `LEAVE`, plus host/admin actions. Intents carry **ids only**;
  identity is resolved server-side from `ws.data`.
- `ServerMsg` — union: `WELCOME`, `LOBBY_STATE`, `ROUND_INTRO`, `ROUND_STATE` (snapshot),
  `ROUND_RESULT`, `SCOREBOARD`, `FINAL_RANKING`, `ACK`, `ERROR`, typed `*RejectReason` code unions.
- **Validation**: a hand-written `isValidClientMsg` shape gate (known discriminant, required fields,
  primitive typeof checks, closed wire enums derived from the union). Domain refinements stay in
  handlers/use-cases.

### Routing
- **Server**: self-assembling dispatch table — an intent registry (`reg()`/`buildIntentHandlers(ctx)`)
  folding per-domain arrays into a handler map (throws on duplicate). Adding an intent = append one
  registration.
- **Client**: `ServerMsgRouter.on(type, handler)` with `Extract<ServerMsg,{type}>` narrowing; unhandled
  types are no-ops.

### Server-authoritative game loop
Fixed-timestep tick (`buildSimulationLoop`) for **real-time mini-games**:
- Monotonic integer `tick` counter; `setInterval(simulate, 1000 / TICK_HZ)` (default TICK_HZ ~15–30,
  not 60 — party mini-games don't need it).
- Per-tick pipeline: advance the active mini-game (`tick(dt)`), then `snapshotTick` (throttled, e.g.
  every N ticks) publishing `ROUND_STATE` to `room:<code>`.
- The **active mini-game instance is the authority**; clients send inputs, the server validates and
  applies them. Countdowns/timers use the server clock.
- **Test seam**: a `stepTick(n)` synchronous driver (swaps the wall-clock `setInterval`) so tests drive
  the sim deterministically.
- Not every mini-game needs the loop: turn-based (Battleship) and instantaneous-scoring games
  (reaction, button-masher, balloon) resolve on intent/timeout without a continuous tick.

---

## 5. Client (Angular 20 + Phaser 3)

Same split as utopia: **Angular owns all DOM/UI** (join screen, lobby, host config, results,
scoreboard, final ranking, HUD/overlays); **Phaser owns the mini-game canvas only**. The two are
decoupled and talk through one thin service.

- `GameClient.ts` — `gameConfig()` factory returns a `Phaser.Types.Core.GameConfig`
  (`type: Phaser.AUTO`, `pixelArt: true`, arcade physics if needed); boots Phaser, owns `RoundState`,
  builds the `ServerMsgRouter`.
- **One Phaser scene per mini-game** (or a host scene that swaps mini-game modules), loaded from a
  declarative asset registry; unknown mini-game kind → neutral placeholder (new games don't break the
  wire).
- `core/net/game-socket.service.ts` `GameSocketService` (root singleton) owns the raw `WebSocket`:
  `state$: Subject<ServerMsg>`, `connected$`, `reconnecting$`, `send(msg): boolean`. `connect()` is
  cookie/identity-resolved server-side.
- **Zone boundary**: boot Phaser + `connect()` inside `NgZone.runOutsideAngular()` so Phaser's 60 Hz
  rAF never drives Angular change detection; server messages re-enter via `zone.run` (CD per message,
  not per frame).
- **Reconnect**: bounded exponential backoff `min(1000 * 2^attempts, 30_000)`, suppressed on
  intentional close or protocol mismatch. Rejoin restores the player's session scoreboard (FR-2.3).
- **Build**: Angular 20 via `@angular/build` (`ng serve`/`ng build`); dev proxy `/api` + `/ws` →
  `localhost:3000` so only the Angular dev port is exposed. WS URL derived from `location` at runtime.

---

## 6. Mini-game plugin model (maps FR-4.2 §8.3 of the PRD)

Mini-games are **pluggable modules**; the session engine is agnostic. Each mini-game implements a common
contract (pure domain logic + a client render/scene). This mirrors utopia's intent-registry pattern
applied to games.

### Domain contract (server, pure)
```ts
interface MiniGame<State, Input, Result> {
  readonly id: MiniGameId
  readonly format: 'ffa' | 'duel' | 'team'
  init(ctx: { players: PlayerId[]; teams?: TeamMap; seed: number; config: MiniGameConfig }): State
  onInput(state: State, playerId: PlayerId, input: Input, now: number): State   // server-validated
  tick?(state: State, dt: number, now: number): State                           // only real-time games
  isFinished(state: State, now: number): boolean
  getResult(state: State): NormalizedResult   // ranking / placements → scoring engine
}
```
- **Determinism**: any randomness comes from the injected `Random` port seeded per round (`seed`), so
  "same board for everyone" games are reproducible and server-validated. The domain must never call
  `Math.random` / `Date.now` (enforced, §8).
- **NormalizedResult**: a player/team ordering (placements). The scoring engine (`scoring-system.md`)
  turns placements into points uniformly, regardless of format.
- **Registry**: each mini-game registers `{ id, factory, format, meta }`; the session engine picks N per
  session (random or host-set), instantiates, runs the round, and consumes `getResult()`.

### Client side
Each mini-game ships a Phaser scene (or render module) that reads `RoundState` snapshots and sends
`MINIGAME_INPUT`. Adding a mini-game = one domain module + one client scene + one catalog entry; no
engine changes.

---

## 7. Persistence

- **Phase 1: no database at all.** Rooms, sessions, players, and scores live **only in memory**
  (`LiveRooms`). When a room closes (session ends or inactivity timeout), everything is discarded —
  nothing is saved. Players are anonymous (color + pixel avatar + name; see `art-direction.md` §6), so
  there is no account or profile to persist. This is the main divergence from utopia (which persists a
  durable world), and it keeps the MVP simple: no schema, no migrations, no `bun:sqlite`.
- **Later phase only**: introduce `bun:sqlite` (raw SQL, forward-only `migrations/*.sql`, `migrate.ts`,
  idempotent seed) with one `Sqlite*Repository` per aggregate, for **session history / stats** (FR-6.6),
  the post-match analysis persistence (backlog Phase 4), and eventually optional accounts. Follow
  utopia's persistence conventions verbatim when added.

---

## 8. Tooling & conventions (inherited from utopia)

- **Biome** (`biome.json`): 2-space indent, line width 100, single quotes, semicolons as-needed,
  `recommended` lint. `bun run lint` / `lint:fix` / `format`.
- **TypeScript**: `strict`, `noImplicitReturns`, `noEmit`; `typecheck` runs `tsc --noEmit` per package.
- **Tests**: `bun test` for server/shared (colocated `*.test.ts` and/or `apps/server/test/`), a
  `scripts/test-server.sh` splitting WS-handshake suites from the rest (avoids WS resource exhaustion
  and Phaser-under-Bun `window is not defined`). Client specs `*.spec.ts` under Karma/Jasmine (Phaser
  stubbed in specs).
- **Determinism gate**: `scripts/check-determinism.sh` greps `apps/server/src/domain/` for
  `Math.random | Date.now | performance.now` and fails the build if found — the mini-game domain must be
  a pure function of `(seed via Random, time via Clock)`.
- **CI** (GitHub Actions): `bun install --frozen-lockfile` → determinism → lint → typecheck → test;
  separate browser job for client tests.
- **Naming**: PascalCase entities (no suffix), camelCase services/utilities, kebab feature dirs, ports
  drop the `I` prefix, use cases keep `UseCase` suffix, adapters prefix by tech (`Sqlite…`, `Bun…`,
  `System…`), UPPER_SNAKE constants, private mutable fields `_prefixed`, discriminated unions for wire
  variants, single object-parameter `execute({...})` methods.

---

## 9. Divergences from the reference (utopia-offline)

Intentional differences given Pixel Party's nature:
1. **Ephemeral rooms, not a persistent world** — persistence is optional; the live in-memory store is
   the source of truth during a session.
2. **Session/round engine instead of a single continuous world** — the tick loop runs per active
   real-time mini-game, not a global world simulation; many mini-games don't need a continuous tick.
3. **Mini-game plugin registry** — the pluggable-game contract (§6) is the core extension point,
   analogous to utopia's intent/system registries.
4. **Formats**: FFA / duel-bracket / team, with pairing/bracket and team-assignment services in the
   domain (utopia has no equivalent).
5. **Simpler netcode surface** — no AOI/zones (a room is small, ≤ 10 players); everyone in `room:<code>`
   receives the same snapshots.

---

## 10. Open technical questions

1. Confirm `@angular/build` (Angular 20) vs a lighter Phaser-only client if some mini-games ship before
   the full Angular shell (recommendation: keep Angular 20 for parity with the reference).
2. Room-code format/length and collision handling.
3. TICK_HZ and snapshot throttle defaults for real-time mini-games (start 15 Hz / snapshot every 3).
4. ~~Whether to introduce `bun:sqlite` in v1~~ — **decided: no DB in Phase 1, strictly in-memory.**
5. Scaling: single-instance for MVP; a Redis pub/sub backplane if multi-instance is needed later
   (utopia is single-instance).
