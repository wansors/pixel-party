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
| Shared contracts | `packages/shared` (`@pp/shared`): protocol + catalog data + the deterministic game rules the client predicts with, consumed by both apps |
| Serving | **Party mode** (`bun run start`): one Bun process serves the production client build, `/api` and `/ws` on one port; `bun run dev` (Angular dev server + game server) for development only |
| Persistence | **None, permanently** — everything in-memory/ephemeral by design (no `bun:sqlite`, ever) |
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
  ports/                    # Clock, IdGenerator, LiveRoomRegistry
infrastructure/
  driving/ws/               # Bun.serve WS adapter + intent registry + shape validator
  driving/http/             # /api routes + staticSite (party mode: serves the client build)
  driven/time/              # SystemClock
  driven/random/            # SeededRandom (mulberry32)
  driven/id/                # room code + id generation
  live/                     # LiveRooms — in-memory authoritative room/session state
composition-root.ts         # the single wiring point
config.ts                   # env-driven config
index.ts                    # bootstrap().catch(...)
```

### apps/client/src
```
app/
  core/{net, i18n, audio}                 # GameSocketService, Transloco language/catalog, AudioService
  features/join/                          # entry screen (name, avatar, color, create/join)
  features/room/                          # the whole room lifecycle
    room.store.ts                         # per-room RoomStore: signals, ServerMsg handling, intents,
                                          #   GameClient (Phaser) bridge
    room.component.*                      # shell: header, persistent canvas + live board, view switch
    lobby/ intro/ result/ final/ live-board/   # one thin view component per phase
  shared/                                 # reusable UI (pixel avatar, skill radar, audio, language)
  app.config.ts, app.routes.ts            # the room route is lazy: Phaser + every scene load on entering
game/                                     # Phaser, framework-agnostic
  GameClient.ts                           # boots Phaser, registers SCENES, ServerMsgRouter dispatch
  serverMsgRouter.ts                      # typed ServerMsg dispatch
  RoundState.ts                           # server snapshots + roster names/colors/avatars → scene reads
  hud.ts, fx.ts, pixelStyle.ts            # standard HUD strip, juice kit, pixel-art texture helpers
  avatarSprites.ts, avatars.ts            # lobby avatar grids (pure data, also used by the shell) +
                                          #   per-player Phaser textures
  netcode/SnapshotInterpolator.ts         # client interpolation for real-time scenes (see §5)
  netcode/ServerClock.ts                  # the server's round clock, estimated from snapshots
  scenes/MiniGameScene.ts                 # common scene base (snapshot guard, HUD, crash guard, relayout)
  scenes/index.ts                         # SCENES: the one id → scene map
  scenes/<Name>Scene.ts                   # one Phaser scene per mini-game
environments/
```

### packages/shared/src
```
index.ts        # re-exports protocol + catalog
protocol.ts     # PROTOCOL_VERSION, ClientMsg, ServerMsg, all DTOs (discriminated unions)
catalog/        # mini-game metadata (id, name, format, timing, rules blurbs), scoring config
games/          # per-game wire types + the pure rules both sides run (Tetris engine, snakeStep,
                #   sumoStep, the race car integrator, bomberStepDir, asteroidsFly…; see §5)
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
- **infrastructure/** — adapters implementing ports: WS + HTTP driving adapters (incl. the party-mode
  static site), `SystemClock`, `SeededRandom`, id/room-code generator, `LiveRooms` (in-memory
  authoritative store; no repositories — there is no database, D15).

### Ports (define only at real boundaries — KISS hexagonal)
| Port | Adapter | Notes |
|------|---------|-------|
| `Clock` | `SystemClock` | `now(): number` — timers/countdowns reference the server clock |
| `Random` (domain) | `SeededRandom` | `next(): number` 0..1, mulberry32 — deterministic mini-game seeds |
| `IdGenerator` | crypto-based | player ids, room codes |
| `LiveRoomRegistry` | `LiveRooms` | in-memory authoritative rooms/sessions (structural port) |

### Wiring
Single **composition root** (`composition-root.ts`), no DI framework: reads config, `new`s the
clock/random/id/live-rooms and every use case with its ports, then calls `startGameServer({...})`.
`index.ts` is just `bootstrap().catch(...)`.

---

## 4. Real-time transport

### Bun-native WebSockets
`Bun.serve({ port, fetch, websocket: { open, message, close, idleTimeout } })`. Uses Bun's built-in
pub/sub: `ws.subscribe(topic)` / `server.publish(topic, data)`.

- **Upgrade flow**: `fetch` handles `/api/*` (HTTP: create/join room, health) and upgrades WS
  connections. On upgrade, attach server-resolved identity (`playerId`, `roomCode`, `isHost`) to
  `ws.data` — **never client-asserted**. Origin allowlist check (fail-closed); in party mode an upgrade
  from the page this server served (Origin host = Host) is accepted too. Any other GET/HEAD falls
  through to the static site in party mode; everything else is a 404.
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
- **One Phaser scene per mini-game**, all extending `MiniGameScene<Snapshot>` and registered in
  `scenes/index.ts` (`SCENES`). The base owns the cross-cutting plumbing: `snap` returns the snapshot
  only when it belongs to that scene's game (so a stale scene can never read another game's shape),
  `frame()` runs crash-guarded, the standard HUD (`hud.ts`) is fed from `remainingMs`, and a real
  viewport change restarts the scene (layouts are computed in `create()` and every scene rebuilds its
  state from the authoritative snapshot). Visual feedback comes from `fx.ts`; textures are generated
  procedurally from ASCII pixel grids (`pixelStyle.ts`) — no image assets.
- **Room shell**: a per-room `RoomStore` (provided by `RoomComponent`) owns the socket subscription,
  turns `ServerMsg`s into signals and sends intents; the phase views (`lobby/`, `intro/`, `result/`,
  `final/`, `live-board/`) are thin OnPush templates over it.
- `core/net/game-socket.service.ts` `GameSocketService` (root singleton) owns the raw `WebSocket`:
  `state$: Subject<ServerMsg>`, `connected$`, `reconnecting$`, `send(msg): boolean`. `connect()` is
  cookie/identity-resolved server-side.
- **Zone boundary**: boot Phaser + `connect()` inside `NgZone.runOutsideAngular()` so Phaser's 60 Hz
  rAF never drives Angular change detection; server messages re-enter via `zone.run` (CD per message,
  not per frame).
- **Reconnect**: bounded exponential backoff `min(1000 * 2^attempts, 30_000)`, suppressed on
  intentional close or protocol mismatch. Rejoin restores the player's session scoreboard (FR-2.3).
- **Build**: Angular 20 via `@angular/build` (`ng serve`/`ng build`). The WS URL is derived from
  `location` at runtime, so a build talks to whichever server served it (see *Serving* below).
- **Keys**: `MiniGameScene` captures Space/Enter/arrows while a scene runs (blurring a focused page
  control first), and `onKey` ignores the OS auto-repeat unless a binding asks for it; held keys and
  pointers are released on window blur.

### Serving: development and party mode
- **Development** (`bun run dev`): the Angular dev server (:4200) serves the client and proxies `/api` +
  `/ws` to the game server (:3000). Angular runs in development mode — for working on the game, not
  for playing it.
- **Party mode** (`bun run start`, D30) — how the game is played: build the optimized client once, then
  one Bun process serves it on its own port next to `/api` and `/ws`
  (`infrastructure/driving/http/staticSite.ts`). The build is loaded at boot: text assets gzipped up
  front, Angular's hashed bundles cached for good, `index.html` never cached, client routes
  (`/room/ABCD`) falling back to `index.html`. Page and socket share an origin, so there is no
  allowlist to configure; the server prints the LAN URL every device opens. `bun run start:server`
  serves an existing build again; `SERVE_CLIENT` (on outside development) and `CLIENT_DIR` configure
  it. Still one process and no database (D15–D17).

### Client netcode (real-time games)
Snapshots arrive every 150 ms (`TICK_HZ` 20, a snapshot every 3 ticks). Drawing them as they come
stutters, and waiting for them made your own avatar, car, board or ship answer 150–300 ms late.
Real-time scenes draw on three tools (D30):
- **`netcode/SnapshotInterpolator`** — keeps the two latest snapshots and renders `renderDelayMs` in
  the past, lerping between them. The default delay is **150 ms, the snapshot interval**: any shorter
  and render time catches up with the newest snapshot, so motion plays as freeze-then-jump. Now used
  only by Room Rush and Sumo ICE (every body; your push shows at once as an arrow at your feet).
- **`netcode/ServerClock`** — estimates the server's round clock from snapshots' `remainingMs` (it keeps
  the least-delayed snapshot seen, so a late packet never pulls the picture back). Anything that moves
  as a pure function of time is extrapolated to the server's *present*, not drawn a snapshot behind:
  falling fruit and blocks, Pixel Dash obstacles, Star Blaster's scripted enemies and bullets, the race
  clock — and the base the predictions below step forward from.
- **Prediction of your own entity** — the rules the client needs live in `@pp/shared` as pure,
  deterministic functions that the server's domain calls too, so both sides run the same code. The
  scene steps its own entity locally on input and reconciles with every snapshot. The server stays
  authoritative: its snapshot always wins.
  - *Boards* — Line Clear Sprint / Quick Tetris (the whole engine, `tetrisSprint`: 7-bag pieces,
    rotation + kicks, gravity, locks) and Bubble Pop (`bubbleShoot`, `bubbleNextShot`): each input
    applies to the local board at once and goes out with a `seq`. Each snapshot is the new base, and
    the inputs it hasn't acknowledged (`ack`, `shots`) are replayed on it. Snake (`snakeStep`) works the
    same way, stepping on the server's clock; a turn names the step it is for (`at`), so both sides turn
    on the same cell.
  - *Bodies* — Sumo (`sumoStep`, `sumoDash`), the racers (`integrateRaceCar` plus per-game physics,
    moved out of `raceCore`; `scenes/raceNet.ts` `OwnCar`), Bomber (`bomberStepDir`), Asteroids
    (`asteroidsFly`), Brawl (`BRAWL.moves` timings, so a refused press never swings), Pang (`PANG`),
    Freeze Doll (`freezeDollMove`), Star Blaster's ship and the athletics strides
    (`athleticsStrideGain`). On each snapshot the difference from the prediction is folded in and
    faded out on screen (time constants of ~90–220 ms per game). It never snaps, except on a teleport:
    a respawn, a rescue, a throw, or an error too big to be lag.
  - *Everyone else* is dead-reckoned to the server's present from snapshot velocities (rival cars:
    `RivalCars`, ships, rocks, balloons, fighters, runners; Sumo steps every wrestler with the shared
    physics), walked a beat behind (Bomber, 120 ms), or interpolated (above). Pong's ball runs
    forward from the snapshot's position + velocity with the server's wall/paddle rules, your paddle
    as you hold it now.

  Scenes send input on change only, never an idle heartbeat (D28); bodies carry `vx`/`vy` (or a walk
  `dir`) on the wire for dead reckoning.

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
Each mini-game ships a Phaser scene extending `MiniGameScene` that reads its snapshot (`this.snap`)
and sends `MINIGAME_INPUT` (`this.sendInput`). Adding a mini-game = one domain module + registry entry,
wire types in `@pp/shared`, one scene + its `SCENES` entry, one `MINIGAMES` catalog entry and its
`catalog.minigame.<id>` translations (EN + ES); no engine changes.

---

## 7. Persistence

- **No database, permanently.** Rooms, sessions, players, and scores live **only in memory**
  (`LiveRooms`). When a room closes (session ends or inactivity timeout), everything is discarded —
  nothing is saved. Players are anonymous (color + pixel avatar + name; see `art-direction.md` §6), so
  there is no account or profile to persist. This is the main divergence from utopia (which persists a
  durable world), and it's a deliberate, durable product choice, not an MVP simplification: no schema, no
  migrations, no `bun:sqlite`, ever. There is no "Phase 6" that introduces one — see
  `implementation-decisions.md` D15.
- Post-match analysis (backlog Phase 4) renders entirely from the in-memory session state accumulated
  during the round; it does not need persistence.

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
- **Performance** (D30 budget: server tick p99 well under 1 ms at 12 players, snapshots ≤ ~4 KB, no
  per-frame object churn, no leaks across a session):
  - `scripts/bench-games.ts` runs every mini-game at N players (default 12) for its full duration at
    20 Hz, driven by the playtest bots (generic inputs where a game has none), after a warm-up. It
    reports the tick cost (avg / p99 / max), the snapshot size and the bandwidth per client
    (`--players`, `--only`, `--json`).
  - The playtest skill's `shoot.ts --perf` probe logs a JSON line per screenshot (also to
    `perf.jsonl`): fps, frame gaps, Phaser step cost, long tasks, JS heap, and the live scene's display
    objects / tweens / textures (steady growth = a leak). Headless Chrome runs WebGL through
    SwiftShader for it. It reads the `__ppGame` hook, which `GameClient` exposes only when
    `localStorage.pp_perf` is set.
- **Naming**: PascalCase entities (no suffix), camelCase services/utilities, kebab feature dirs, ports
  drop the `I` prefix, use cases keep `UseCase` suffix, adapters prefix by tech (`Bun…`,
  `System…`), UPPER_SNAKE constants, private mutable fields `_prefixed`, discriminated unions for wire
  variants, single object-parameter `execute({...})` methods.

---

## 9. Divergences from the reference (utopia-offline)

Intentional differences given Pixel Party's nature:
1. **Ephemeral rooms, not a persistent world** — there is no persistence, permanently; the live
   in-memory store is the only source of truth, for the life of the room.
2. **Session/round engine instead of a single continuous world** — the tick loop runs per active
   real-time mini-game, not a global world simulation; many mini-games don't need a continuous tick.
3. **Mini-game plugin registry** — the pluggable-game contract (§6) is the core extension point,
   analogous to utopia's intent/system registries.
4. **Formats**: FFA / duel-bracket / team, with pairing/bracket and team-assignment services in the
   domain (utopia has no equivalent).
5. **Simpler netcode surface** — no AOI/zones (a room is small, ≤ 12 players); everyone in `room:<code>`
   receives the same snapshots.

---

## 10. Open technical questions

1. ~~Confirm `@angular/build` (Angular 20) vs a lighter Phaser-only client~~ — **decided/implemented:
   Angular 20 shell + Phaser 3, decoupled (`GameClient`), for parity with the reference.**
2. ~~Room-code format/length and collision handling~~ — **implemented: 4-char code from an unambiguous
   alphabet (no 0/O/1/I), regenerated on collision in `LiveRooms` (`ROOM_CODE_LEN` env, default 4).**
3. ~~TICK_HZ and snapshot throttle defaults~~ — **implemented: `TICK_HZ` 20, snapshot every 3 ticks
   (`SNAPSHOT_EVERY_N_TICKS`), intro 3 s / result 5 s in the session config (composition-root).**
4. ~~Whether to introduce `bun:sqlite` in v1~~ — **decided permanently: no DB, ever; strictly in-memory
   (D15).**
5. ~~Scaling: single-instance for MVP; a Redis pub/sub backplane if multi-instance is needed later~~ —
   **decided permanently: single-instance only.** The target deployment is a LAN party (players
   physically together on one local network), which never needs more than one process; a multi-instance
   backplane has no use case here (D17).
