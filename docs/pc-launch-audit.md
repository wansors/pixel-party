# PC launch audit — performance & gameplay — Pixel Party

- **Date**: 2026-10-04. **Decision**: D30 (`implementation-decisions.md`).
- **Scope**: every one of the 55 games, played the way the launch will be played: PC first, keyboard and
  mouse, 1920×1080 and 1280×800 (1366×768 laptops too), rooms of up to 12. Two audits per game:
  - **performance**: client frame cost, leaks, server tick and snapshot size;
  - **gameplay on PC**: controls, responsiveness, clarity, pacing, feedback.

  Everything below launch quality was fixed. The previous audit (`player-fit-audit.md`, D27–D29)
  already covered player counts and balance; this one built on it.

## How it was measured

- **Server**: `bun scripts/bench-games.ts`. Every game runs at 12 players, driven by the playtest
  bots (or generic inputs), for its full duration at the engine's 20 Hz tick. It reports per-tick cost
  (simulation + building and serialising the snapshot), snapshot size and the bandwidth each client
  receives.
- **Client**: the playtest driver's `--perf` probe (`playtest-screenshots` skill), run over full
  sessions of all 55 games.
  - Setup: 1920×1080, 12 players, the production build in party mode, WebGL (software SwiftShader in
    headless Chrome).
  - At every screenshot it logs the Phaser step cost (per-frame JS + render command cost: avg / p95 /
    max), long tasks, JS heap, and the live scene's display objects, tweens and textures.
  - Frame rate itself is not meaningful headless (software rasterisation of 1080p), so the step cost
    and the leak counters are what count.
- **Gameplay**: six reviewers, one per group of games. Each read every scene and module against a
  PC checklist and looked at the 1080p sweep screenshots of their games:
  - controls on keyboard and mouse;
  - response to input;
  - readability at 1080p with 12 players;
  - pacing and feedback;
  - copy in EN and ES.

## Shared findings and fixes

| Finding | Severity | Fix |
|---|---|---|
| The only way to play was `bun run dev`: Angular in **development mode** (unoptimised bundles, extra runtime checks) on every player's device, two processes, origin allowlist to configure | blocker | **Party mode**: `bun run start` builds the client once and the game server serves it (gzip, immutable hashed bundles) with `/api` and `/ws` on one port. It prints the LAN URL to open (`http/staticSite.ts`). |
| **Your own avatar, car, board or ship reacted only when a snapshot came back** (150–300 ms at ~6.7 snapshots/s) in Tetris, Snake, Sumo Push, the racers, Star Blaster, Bomber, Brawl, Asteroids, Pang, Freeze Doll, Pong, Bubble Pop and Maze | blocker | **Client-side prediction.** The game rules moved into `@pp/shared` (Tetris engine, `snakeStep`, `sumoStep`, car integrator, `bomberStepDir`, `asteroidsFly`, …). The client steps its own entity at once and eases into each snapshot; Pong's ball is extrapolated. |
| `SnapshotInterpolator` rendered 100 ms behind a 150 ms snapshot interval, so every snapshot played as a freeze then a jump | major | Default render delay is now 150 ms. |
| `PlayerStrip` destroyed and re-created every chip (24 Text/Image objects) whenever any score changed, and re-measured every label at each font-size step. This was the main per-frame cost of every game with a player strip (Pixel Hoops measured 12.8 ms avg) | major (perf) | Chips are reused (text, colour and face updated in place). The fit is computed arithmetically (monospace font), then rendered once. |
| Many scenes did per-frame work: Graphics redraws, `setText`, object creation, one geometry mask per object, lazy texture generation mid-round | major (perf) | Redraw only on change; pooled sprites; one masked layer or container; textures baked once (Sumo ICE floe, Honeycomb candy, Room Rush carousel, Bomber tiles); avatar textures pre-generated a few per frame (`MiniGameScene.warmAvatars`). |
| Shadows were Ellipse shapes interleaved with sprites, breaking batching once per player | minor (perf) | `addShadow` returns an image of a cached ellipse texture. |
| A page control left focused (sound toggle, volume slider) also took Space/Enter/arrows mid-round | major | The scene base blurs the focused control and captures the game keys while a round runs. |
| Held keys could stick on alt-tab (Pixel Hoops charge, field-event aim, Honeycomb needle, steering) | major | They release on window blur. |
| The round intro said what to do but not which keys | major | Every game has a `catalog.minigame.<id>.controls` line on the intro card. The card grows on 1080p, and "GET READY!" is readable. |
| Content sized for ~800 px, small on a 1920 screen (Glass Bridge 140 px wide, Bubble Pop 450 px, quiz boards, naval boards…) | major | Scenes scale their main content with the available space at 1080p (side placement of pads/buttons on wide screens). |
| Snapshot sizes: Pixel Weight 12.6 KB and Pixel Split 9.3 KB on every snapshot (~84 KB/s per client), Sink the Fleet 6.8 KB | major (net) | Static data sent once or packed (hex bitmaps, encoded shots). Largest snapshot now 3.8 KB. |
| Inputs sent with no human action (heartbeats, first-frame moves) in Sumo, Bomber, Asteroids, Brawl, Room Rush, Sumo ICE, the racers, Star Blaster, Pong, Pixel Rain, Fruit Catch | major | Sent only on a real action, so the idle demotion (D28) works. |

## Per-game findings (blocker / major → fixed)

The minors are in the commit and in `minigame-catalog.md`. Every game also got: keys named in its hint
line and its intro `controls` line, Enter as an alternative to Space for the primary action where it
fits, and readable sizes at 1080p.

### Quiz, reflex & tap
- **Color Trap**:
  - blocker: no keyboard. Keys 1–4 now answer, with each key printed on its tile.
- **Lightning Quiz / Weird Trivia**:
  - major: tiles are badged A–D but only 1–4 worked. Both now answer.
  - perf: avatar textures for the reveal are pre-drawn; the contestant lights are throttled.
- **Button Masher**:
  - major: the 15/s cap was invisible. There is now a speed gauge with a MAX state, a local limiter
    and an optimistic count.
- **Balloon Chicken**:
  - major: no key to cash out. Space pumps and Enter cashes out.
  - major: a pump lagged the snapshot. Pumps are now optimistic.
- **Number Rush**:
  - major (exploit): sweeping every cell in reading order cost nothing. A wrong number now costs a
    0.5 s cooldown.
- **Quick Math**:
  - major: keys 1–4 read as answers. You now type the answer itself.
- **Higher or Lower**:
  - major: Space banked by accident. BANK is now Enter / B.
- **Odd One Out**:
  - major: a dropped tap locked the level forever. It now unlocks itself.
- **Reaction Duel**: Enter added and the prompt clarified.

### Puzzle & tap
- **Simon**:
  - blocker: no keyboard. Now Q W / A S and 1–4.
  - perf: a 71 ms spike from lazy pad textures, now built up front.
- **Bug Smash**:
  - major: no keyboard. Now Q W E / A S D / Z X C and the numpad, with a miss penalty so rolling
    over all the keys doesn't pay.
- **Memory Flash**:
  - major: keys picked tiles by position. You now type the count.
- **Pixel Weight**:
  - major: only ±1 steps. You can now type the number, with ±1 / ±10 arrows.
- **Pixel Hoops**:
  - major: alt-tab left the charge stuck at full power.
- **Pixel Split**:
  - perf: about 100 images re-created per level, now reused.
- **Match, Sudoku, Stop the Clock, Roulette**: keyboard paths and redraws only on change.

### Teams & duels
- **Pixel Pong**:
  - blocker: the ball stuttered (rendered 100–150 ms late). It is now extrapolated.
  - major: no W/S keys and a click-to-drag mouse. Now W/S, and the paddle follows the mouse on hover.
- **Sink the Fleet / Fleet Battle**:
  - major: no keyboard. There is now a reticle on arrows/WASD and Space/Enter fires.
  - major: tiny boards at 1080p.
  - major (leak): spectator boards were never destroyed.
- **Quick Draw**:
  - major: a false start wasn't named.
  - major: snapshot delay counted in the reaction time.
  - major: a frozen pair held the room for 20 s. Unanswered standoffs now end 4 s after the signal.
- **Marbles Duel**:
  - major: you could only nudge the count. You can now type it, call O/N and E/P, and see your choice
    committed at once.
- **Pixel Beat**:
  - major: 40 s of the same metronome. The tempo now ramps, with rests and off-beats.
  - major: letting a beat pass kept your streak. It now breaks it.
  - perf: the equalizer redrew about 1,200 rectangles a frame; it now uses 24 images.
- **Honeycomb Cut**:
  - major: the needle stuck on an outside release or alt-tab, and pressing on the tin cracked the
    candy.
  - perf: about 270 shapes redrawn every frame, now baked into one texture.
- **Tug of War / Bomb Relay**:
  - major: no rate cap, so an autoclicker won. Both are now capped at 15/s.
- **Duels**:
  - major: finished duellists stared at a static card. They now watch a live duel after 4 s.

### Real-time arcade
- **Line Clear Sprint / Quick Tetris**:
  - blocker: every action waited for the snapshot. Your board is now predicted.
  - major: Tetris controls (now auto-shift, soft and hard drop, both rotations).
  - major: only 4 pieces, and rotation walked sideways. Now all 7 in bags, with centre rotation and
    kicks.
  - major: no ghost or NEXT. Both added.
- **Snake Arena**:
  - blocker: you were out before touching a key. The snake now starts on your first direction (2 s
    grace).
  - major: turns arrived late and movement stuttered. The snake is now predicted, and turns are booked
    for a step.
- **Sumo Push**:
  - blocker: your wrestler reacted 150–250 ms late. It is now predicted.
  - WASD added.
- **Bubble Pop**:
  - major: a small board at 1080p, and the next shot stayed stale.
- **Maze Sprint**:
  - major: your token moved only on the snapshot.
  - major: jittered steps were dropped.
- **Pixel Rain / Fruit Catch**:
  - major: keyboard speed didn't match the server.
  - major: a teleporting mouse basket. The server now caps the basket speed.
  - perf: falling objects pooled.
- **Pixel Dash**:
  - Enter added, a bigger runner, and the obstacle gaps tighten over the round.

### Racing, athletics & Star Blaster
- **Micro Race / Rally Stage / Speed Circuit**:
  - blocker: own-car lag. The car is now predicted on the shared integrator.
  - major: rivals were drawn 30 units in the past. They are now dead-reckoned.
  - major: no race clock, waiting state, wrong-way warning or name tags.
  - perf: Rally measured 14.7 ms avg. The world mask is gone, standings are pooled, and the course
    paints 2–4× faster.
- **Star Blaster**:
  - blocker: your ship jumped up to ~190 px on every direction change. It is now predicted.
  - major: holding the mouse made the ship oscillate.
  - perf: 11 thumbnails were redrawn every frame (now at 10 Hz), and one mask per bullet became a
    single masked layer.
- **Long Jump / Javelin**:
  - major: alt-tab left the aim climbing into a bad attempt. The hold now releases on blur.
- **100 m / Hurdles**: strides are predicted locally; bigger type on 1080p.

### Roadmap wave
- **Bomber Express**:
  - major: walking stuttered. Your avatar is predicted and others are path-smoothed.
  - major: turns were unforgiving. They are now buffered.
  - perf: an 81 ms spike; tiles now live in one render texture.
- **Brawl**:
  - major: turning waited for a tick, own swings felt dead, and own movement lagged.
- **Asteroids**:
  - major: thrust felt late.
  - perf: 11.7 ms avg from one mask per rock, now one masked container.
- **Pang**:
  - major: walking jumped and snapped back.
  - major: harpoon presses were swallowed. There is now a 150 ms fire buffer.
- **Freeze Doll**: major: your runner moved only after the snapshot.
- **Room Rush**:
  - major: interpolation stutter.
  - perf: 12.8 ms avg with 98 ms spikes. The carousel is baked; rooms redraw on change.
- **Sumo ICE**:
  - major: interpolation stutter, and no prompt.
  - perf: the heaviest scene. Water is now one tile sprite and the ice one render texture.
- **Glass Bridge**: major: tiny at 1080p. Bigger, with corner buttons.
- **Jump Rope**: perf: a 53 ms spike from lazy textures, now pre-generated.

## Results

**Server** (`bench-games.ts`, 12 players, every game):

| | Before | After |
|---|---|---|
| Worst tick p99 | 0.9 ms | 0.3 ms |
| Largest snapshot | 12.6 KB (Pixel Weight) | 3.8 KB |
| Worst bandwidth per client | 84 KB/s | 19 KB/s |

The budget is a 50 ms tick, so the server was never the problem; the snapshots were.

**Client** (`--perf`, 1920×1080, 12 players, all 55 games, production build). Phaser step cost per
frame, in ms; worst sample of the round:
- The outliers before the fixes all came down, measured in the same conditions:

  | Game | Avg before → after | p95 before → after |
  |---|---|---|
  | Pixel Hoops | 12.8 → 2.6 | 27.9 → 9.3 |
  | Room Rush | 12.8 → 4.8 | 33 → 21.8 |
  | Pixel Rain | 9.3 → 1.3 | 82.9 → 5 |
  | Pang | 10.3 → 3.8 | 25.9 → 9.9 |
  | Star Blaster | 9.1 → 4.4 | — |
  | Rally Stage | 14.7 → 8.2 | — |
  | Weird Trivia | 7.2 → 1.8 | 36 → 9.7 |
  | Sumo Push | 6.1 → 2.2 | 22 → 4.4 |
  | Simon | 6.3 → 3.0 | — |
  | Match | 6.2 → 3.0 | — |

  Asteroids went from 11.7 to 3.1 avg, measured in an isolated session. Micro Race went from 6.3 to
  2.6, also isolated.
- A few games looked worse in the three-sessions-in-parallel verification sweep. Re-measured in an
  isolated session, all of them are within budget (avg 0.8–2.6 ms, p95 ≤ 11.4 ms): Jump Rope 1.3,
  Reaction 0.9, Button Masher 1.7, Hurdles 1.7, Maze 2.0, Sink 1.3, Sudoku 1.2, Fleet 2.2. Marbles
  stays at 4.2 avg / 9.6 p95 (a mostly static table; within budget).
- No leaks: the JS heap stays around 25–45 MB across 20-round sessions. Live objects are flat within
  a round, apart from bounded per-round extras (best-mark flags, faller names). Textures are keyed
  caches that plateau.
- **Zero console errors or frame failures** across the 55 games on the final build.

  The baseline sweep caught one error, `quick-tetris` "v.grid is not iterable". It was a wire
  mismatch between a source-run server and an older client bundle during the audit, not a game bug.

These figures are headless (software-rasterised WebGL), so absolute times are pessimistic. On a real PC
GPU the same scenes cost less; the relative outliers are what the sweep was for.
