# Mini-game catalog — Pixel Party

- **Version**: 0.4 (draft)
- **Date**: 2026-07-20

Initial mini-game catalog. Each one is designed for the **each player on their own device** model (PRD
§4) and returns a **normalized result** to the engine (ranking or orderable score, §8.3).

## Design pillars

- **Party scale**: built for **4–10 players** in the same session.
- **Competitive and banter-driven**: the point is the rivalry and the trash talk (*pique*) — moments
  that make the group laugh.
- **Variety of formats**: a mix of **individual (free-for-all)**, **duels (1v1 / bracket)**, and
  **team-based** mini-games so the social dynamic keeps changing.
- **Pixel-art, arcade-classic inspired**: simple, recognizable ideas (basketball, battleship, pong,
  snake…) reskinned in a coherent pixel aesthetic.
- **Easy to grasp**: understandable in one intro screen, no long tutorials.
- **Kept close with handicap**: catch-up mechanics so no one is ever fully out of the race (see §H and
  `scoring-system.md`).

## Card legend

- **Type**: Free-for-all (FFA) / Duel (1v1 or bracket) / Team.
- **Input**: touch tap, drag, keyboard, etc.
- **Duration**: target play time.
- **Result**: how players are ordered at the end.
- **Latency**: sensitivity to network latency (low = tolerates well; high = needs tight sync).
- **Dev complexity**: relative estimate (low/medium/high).
- **Banter**: how much rivalry/laughter it tends to generate (💥 low → 💥💥💥 high).

⭐ marks the **MVP** mini-games (A1, A2, E1) — the 3 that ship in Phase 0 for their balance of fun,
latency tolerance, and dev cost. A3 Trivia and D1 Balloon Chicken are the immediate fast-follows.

✅ = **implemented**: the full P0 group — A1 (`reaction-duel`), A2 (`button-masher`), E1 (`color-trap`),
A3 (`trivia`) and D1 (`balloon-chicken`) — plus (as of 2026-07-21) the P1 wave: E4 Number Rush
(`number-rush`), E2 Quick Math (`quick-math`), E3 Odd One Out (`odd-one-out`), E5 Higher or Lower
(`higher-lower`), A6 Bug smash (`bug-smash`), A10 Stop the clock (`stop-clock`), E8 Memory Flash
(`memory-flash`), A4 Simon (`simon`) and A5 Pixel Hoops (`pixel-hoops`); plus the P1 fast-follows E12
Pixel Weight (`pixel-weight`) and E11 Pixel Split (`pixel-split`). Then the Phase 2 formats (C1
`tug-of-war`, C2 `bomb-relay`, B2 `sink-the-fleet`) and the Phase 5 real-time wave (2026-07-23): D2
Fruit Catch (`fruit-catch`), A7 Pixel Rain (`pixel-rain`), A9 Pixel Dash (`pixel-dash`), A8 Snake Arena
(`snake-arena`), B1 Pixel Pong (`pixel-pong`), B3 Sumo Push (`sumo-push`) — behind a client snapshot
interpolator (netcode hardening); plus Match (A11 `match-pairs`), Quick Draw (E7 `quick-draw`) and Pixel
Roulette (D3 `pixel-roulette`); then (2026-08-21) E14 Sudoku Race (`sudoku-race`); then (2026-08-22) the
rest of the `minigame-ideas.md` backlog: E6 Pixel Beat (`pixel-beat`), C3 Fleet Battle (`fleet-battle`),
E9 Maze Sprint (`maze-sprint`), E10 Line Clear Sprint (`line-clear-sprint`), E13 Quick Tetris
(`quick-tetris`) and E15 Bubble Pop (`bubble-pop`). **35 mini-games total — the full backlog is built.**
Then (2026-09-28) a new sports wave (section F): F1 100 m Dash (`dash-100m`), F2 110 m Hurdles
(`hurdles-110m`), F3 Long Jump (`long-jump`), F4 Javelin (`javelin-throw`) and F5 Micro Race
(`micro-race`). **40 mini-games total.**
Then (2026-10-02) the roadmap wave (D22), one game at a time: G1 Glass Bridge (`glass-bridge`), G2
Freeze Doll (`freeze-doll`), G3 Room Rush (`room-rush`), I1 Sumo ICE (`sumo-ice`), I2 Pang (`pang`),
I3 Star Blaster (`star-blaster`), I4 Asteroids Arena (`asteroids`), I5 Bomber Express
(`bomber-express`). **48 mini-games total.**

---

## A. Individual — Free-for-all

### A1. ⭐ ✅ Quick reaction ("Go!") — implemented (`reaction-duel`)
- **Concept**: the screen is red; at a random moment it turns green. First to tap wins. Tapping early is
  penalized.
- **Type**: FFA · **Input**: tap · **Duration**: 15–30 s (several rounds) · **Banter**: 💥💥
- **Rules**: 3 rounds. After a random delay (2–6 s) the screen turns green; reaction time is measured.
  Jumping the gun = disqualified that round.
- **Win condition**: lowest accumulated reaction time. · **Result**: ranking by total time (lower wins).
- **Latency**: low (timestamp vs. server clock). · **Complexity**: low.

### A2. ⭐ ✅ Frantic tap ("Button masher") — implemented (`button-masher`)
- **Concept**: tap as many times as you can in a fixed time.
- **Type**: FFA · **Input**: repeated tap · **Duration**: 10 s · **Banter**: 💥💥
- **Rules**: 10 s of free tapping; valid taps counted (server rate-limit anti-macro).
- **Win condition**: highest tap count. · **Result**: ranking by count (higher wins).
- **Latency**: low (aggregate count sent). · **Complexity**: low.

### A3. ✅ Lightning quiz ("Trivia") — implemented (`trivia`)
- **Concept**: multiple-choice questions; rewards correctness and speed.
- **Type**: FFA · **Input**: tap on option · **Duration**: 30 s (4 questions) · **Banter**: 💥💥
- **Rules**: per-question time limit (7.5 s). Points for correct answer + speed bonus.
- **Win condition**: highest total score. · **Result**: ranking by points.
- **Latency**: low. · **Complexity**: medium (question bank + i18n).

### A4. ✅ Sequence memory ("Simon") — implemented (`simon`)
- **Concept**: repeat a growing sequence of colors/sounds.
- **Type**: FFA · **Input**: tap · **Duration**: up to ~30 s · **Banter**: 💥
- **Rules**: everyone sees the same growing sequence; a mistake eliminates you; furthest survives.
- **Win condition**: longest sequence reached (tiebreak by time). · **Result**: ranking by level.
- **Latency**: low. · **Complexity**: low/medium.

### A5. ✅ Pixel Hoops ("Basketball") — implemented (`pixel-hoops`)
- **Concept**: arcade free-throw shooting — swipe/tap to set power and angle and sink as many baskets as
  possible; the hoop moves as it heats up.
- **Type**: FFA · **Input**: drag (aim + power) · **Duration**: 30 s · **Banter**: 💥💥💥
- **Rules**: same hoop pattern for everyone. Score per basket; consecutive baskets build a combo.
- **Win condition**: most points. · **Result**: ranking by baskets/combo.
- **Latency**: low/medium (client sim, server validates final score). · **Complexity**: medium.

### A6. ✅ Bug smash ("Whack-a-mole") — implemented (`bug-smash`)
- **Concept**: pixel bugs pop out of holes; smash them before they hide. Some bugs penalize.
- **Type**: FFA · **Input**: tap · **Duration**: 30 s · **Banter**: 💥💥
- **Rules**: identical spawn sequence (common seed). Good bugs +, bomb bugs −.
- **Win condition**: highest score. · **Result**: ranking by score.
- **Latency**: low. · **Complexity**: low/medium.

### A7. ✅ Pixel rain ("Dodge") — implemented (`pixel-rain`)
- **Concept**: move an avatar to dodge falling objects; survive as long as possible.
- **Type**: FFA (own board, same seed) · **Input**: drag/keyboard · **Duration**: up to ~30 s · **Banter**: 💥💥
- **Rules**: identical obstacle pattern (same seed); eliminated on collision. In a multiplayer round
  the round ends as soon as only one player is left standing (2026-09-26 — no more waiting out the
  clock alone); a solo round runs until the player is out or time is up.
- **Win condition**: longest survival. · **Result**: ranking by time.
- **Latency**: medium (client sim, server validates final time). · **Complexity**: medium.

### A8. ✅ Snake Arena — implemented (`snake-arena`)
- **Concept**: classic snake — grow by eating pixels, don't crash into walls or your own tail.
- **Type**: FFA (own board, same food seed) · **Input**: swipe/keyboard · **Duration**: up to ~30 s · **Banter**: 💥💥
- **Rules**: same food layout for everyone; crashing eliminates you.
- **Win condition**: longest snake / longest survival. · **Result**: ranking by length.
- **Latency**: medium. · **Complexity**: medium.

### A9. ✅ Pixel Dash ("Platform race") — implemented (`pixel-dash`)
- **Concept**: short auto-runner/obstacle sprint; first to the flag wins.
- **Type**: FFA (own track, identical layout) · **Input**: tap to jump · **Duration**: up to ~30 s · **Banter**: 💥💥💥
- **Rules**: identical track; mistakes cost time, not lives.
- **Win condition**: fastest finish. · **Result**: ranking by finish time.
- **Latency**: medium (client sim + server validation). · **Complexity**: medium/high.

### A10. ✅ Stop the clock ("Timing") — implemented (`stop-clock`)
- **Concept**: a fast-moving bar/needle; stop it as close to the target as possible.
- **Type**: FFA · **Input**: tap · **Duration**: 20–30 s (3 attempts) · **Banter**: 💥💥
- **Rules**: 3 attempts; summed distance to target. Lower = better.
- **Win condition**: lowest accumulated error. · **Result**: ranking by error.
- **Latency**: low. · **Complexity**: low.

### A11. ✅ Speed puzzle ("Match") — implemented (`match-pairs`)
- **Concept**: memory/card game — uncover matching pairs fastest / with fewest attempts.
- **Type**: FFA (own board, same layout) · **Input**: tap · **Duration**: up to ~30 s · **Banter**: 💥
- **Rules**: identical board; win by matching everything first / fewest misses.
- **Win condition**: first to complete (tiebreak by attempts). · **Result**: ranking by time/attempts.
- **Latency**: low. · **Complexity**: medium.

---

## B. Duels — 1v1 / bracket

> Players are paired into 1v1 matches; winners advance in a bracket, or all pairs play simultaneously and
> results feed the round ranking. Great for building rivalries.

### B1. ✅ Pixel Pong — implemented (`pixel-pong`)
- **Concept**: classic pong, 1v1. First to N points.
- **Type**: Duel (bracket) · **Input**: drag paddle · **Duration**: ~30 s per match · **Banter**: 💥💥💥
- **Rules**: standard pong; ball speeds up over time.
- **Win condition**: first to N points. · **Result**: bracket standing → round ranking.
- **Latency**: high (real-time 1v1; needs interpolation/prediction). · **Complexity**: high.

### B2. Sink the Fleet ("Battleship")
- **Concept**: classic battleship — place your fleet, then take turns firing at the opponent's grid.
- **Type**: Duel (1v1, can pair many simultaneously) · **Input**: tap grid cell · **Duration**: ~30 s · **Banter**: 💥💥💥
- **Rules**: quick placement phase (auto-place option), then alternating shots with a turn timer.
- **Win condition**: sink the enemy fleet first. · **Result**: win/loss → round ranking.
- **Latency**: low (turn-based). · **Complexity**: medium.

### B3. ✅ Sumo Push — implemented (`sumo-push`)
- **Concept**: two pixel sumos in a ring; shove the opponent out with timed pushes.
- **Type**: Duel (1v1) or FFA arena (up to 10 in one ring) · **Input**: tap/direction · **Duration**: ~30 s · **Banter**: 💥💥💥
- **Rules**: physics shove; last one in the ring wins. FFA variant = battle royale. Touch/mouse: hold
  where you want to push — the direction is aimed from your own wrestler (2026-09-26; it used to be
  measured from the ring centre); arrow keys also work.
- **Win condition**: last standing / longest in-ring. · **Result**: ranking by survival.
- **Latency**: high (FFA arena) / medium (1v1). · **Complexity**: high.

---

## C. Team-based

> Players are split into teams (e.g., 2 teams of up to 5). Team result awards points to all members.
> Requires ≥ 4 players; team assignment can be random or host-set.

### C1. Tug of War
- **Concept**: two teams button-mash to drag the pixel rope to their side.
- **Type**: Team · **Input**: repeated tap · **Duration**: ~20–30 s · **Banter**: 💥💥💥
- **Rules**: progress is the team's *average* pulls-per-member, which is already fair for uneven team
  sizes without needing a separate handicap hook (see §H).
- **Win condition**: pull the marker past your line. · **Result**: winning team ranks above.
- **Latency**: low (aggregate rates). · **Complexity**: low/medium.

### C2. Bomb Relay ("Hot potato")
- **Concept**: a lit pixel bomb is passed around the team; solve a quick micro-task to pass it on before
  it explodes. It blows up in whoever holds it.
- **Type**: Team (or FFA circle) · **Input**: tap/mini-task · **Duration**: ~30–45 s · **Banter**: 💥💥💥
- **Rules**: hold time ticks down; pass by completing the micro-task. Fewer explosions = better.
- **Win condition**: team with fewest explosions. · **Result**: team ranking.
- **Latency**: medium. · **Complexity**: medium.

### C3. ✅ Fleet Battle (team variant of Sink the Fleet) — implemented (`fleet-battle`)
- **Concept**: two teams (red/blue) each defend one SHARED fleet; members coordinate shots against the
  enemy team's fleet. *Implemented: turn alternates by team rather than a per-turn shot budget — during
  a team's turn, the first valid `fire` from any of its members consumes that turn slot (and passes it
  to the other team), so any teammate can jump in; a stalling team forfeits its turn on a timeout.*
- **Type**: Team · **Input**: tap grid · **Duration**: ~90 s · **Banter**: 💥💥
- **Rules**: same seeded auto-placed fleet + hit/miss mechanic as Sink the Fleet, scoped to team fleets.
- **Win condition**: sink the enemy fleet first (a draw at the timer is decided by damage dealt).
  · **Result**: team ranking.
- **Latency**: low (turn-based). · **Complexity**: medium.

---

## D. Chaos / party (banter-first)

### D1. ✅ Balloon Chicken ("Nerve") — implemented (`balloon-chicken`)
- **Concept**: pump a pixel balloon for points — but it bursts at a random threshold. Cash out before it
  pops or lose it all. Pure nerve, maximum trash talk.
- **Type**: FFA · **Input**: tap to pump, tap to cash out · **Duration**: ~20 s · **Banter**: 💥💥💥
- **Rules**: each pump adds points; a hidden (server-side) threshold bursts it → 0 for that player.
- **Win condition**: highest banked points. · **Result**: ranking by banked points.
- **Latency**: low (server owns the threshold). · **Complexity**: low.

### D2. ✅ Fruit Catch — implemented (`fruit-catch`)
- **Concept**: catch falling fruit in a basket; avoid the bombs.
- **Type**: FFA (same seed) · **Input**: drag · **Duration**: 30 s · **Banter**: 💥💥
- **Rules**: identical drop pattern; fruit +, bombs reset combo.
- **Win condition**: highest score. · **Result**: ranking by score.
- **Latency**: low/medium. · **Complexity**: low/medium.

### D3. ✅ Pixel Roulette ("Luck") — implemented (`pixel-roulette`)
- **Concept**: pure chance to shake up standings (Mario Party style).
- **Type**: FFA · **Input**: tap to spin · **Duration**: 15 s · **Banter**: 💥💥
- **Rules**: each player spins; random result (server-validated).
- **Win condition**: highest value. · **Result**: ranking by value.
- **Latency**: low. · **Complexity**: low. *(Use sparingly.)*

---

## E. More ideas (lightweight specs)

Additional candidates, kept as short specs until scheduled. Full cards written when picked up. See
`minigame-ideas.md` for the prioritized ranking.

- **E1. ⭐ ✅ Color Trap (Stroop)** — implemented (`color-trap`); *full card below*.
- **E2. ✅ Quick Math** — fast arithmetic; answer as many as possible before the timer. *Implemented
  (`quick-math`): seeded question pool (+ − ×), self-paced, ranked by correct count (tiebreak fewer
  wrong); a wrong answer starts a 1.2 s answer cooldown (buttons greyed behind a draining bar), so
  mashing one button is slower than doing the sums.* FFA · tap · 30 s · low effort · low latency · banter 💥💥.
- **E3. ✅ Odd One Out** — spot the single different pixel/tile in a grid; grid grows each round.
  *Implemented (`odd-one-out`): seeded board sequence, grid grows + brightness gap shrinks per level;
  the odd tile differs in brightness (not hue alone) for accessibility; ranked by level reached.*
  FFA · tap · up to 45 s · low effort · low latency · banter 💥💥.
- **E4. ✅ Number Rush (Schulte grid)** — tap numbers 1→N in order as fast as possible. *Implemented
  (`number-rush`): one shared seeded 5×5 layout, self-paced; ranked by numbers cleared, finishers by
  time.* FFA · tap · 20–30 s · low effort · low latency · banter 💥💥.
- **E5. ✅ Higher or Lower** — guess if the next pixel card is higher/lower; streak = points, one wrong
  ends it. *Implemented (`higher-lower`): one shared seeded deck; server owns upcoming cards (never
  revealed early); ranked by streak.* FFA · tap · 20 s · low effort · low latency · banter 💥💥💥 (nerve).
- **E6. ✅ Pixel Beat** — tap to the rhythm; hit the beats on time. *Implemented (`pixel-beat`): one
  seeded beat timeline (metronome + slight jitter) shared by everyone; a tap within a tight window of a
  not-yet-scored beat scores big, a looser window scores small, a miss breaks the streak.* FFA · tap ·
  ~40 s · medium effort · low/medium latency · banter 💥💥.
- **E7. ✅ Quick Draw Duel** — implemented (`quick-draw`); — western reaction shootout: draw first when "FIRE!" flashes, 1v1.
  Duel · tap · ~15 s/match · low effort · medium latency · banter 💥💥💥.
- **E8. ✅ Memory Flash** — a burst of pixels flashes; answer how many of a target appeared. *Implemented
  (`memory-flash`): seeded board sequence, self-paced; client flashes then asks; server owns the counts.*
  FFA · tap · 25 s · low effort · low latency · banter 💥💥.
- **E9. ✅ Maze Sprint** — navigate a small maze to the exit fastest (identical maze for all).
  *Implemented (`maze-sprint`): one seeded 9×9 perfect maze (iterative randomized-DFS carve, always
  fully connected) shared by everyone; each player moves their own position through it independently.
  Ranked by finish time, then by BFS distance-remaining-to-exit for non-finishers.* FFA · arrow
  keys/WASD + on-screen buttons · up to 45 s · medium effort · low latency · banter 💥💥.
- **E10. ✅ Line Clear Sprint** — Tetris-like: clear N lines fastest. *Implemented
  (`line-clear-sprint`): a simplified Tetris engine (rotation + wall kicks; shared with Quick Tetris, see E13) on a
  6×12 board; maximize lines cleared in a fixed 60 s window, ranked by lines cleared (a survivor
  outranks a topped-out player at an equal score).* FFA · move/drop (keyboard + on-screen buttons) ·
  60 s · high effort · low latency · banter 💥.
- **E11. ✅ Pixel Split ("cut in half")** — implemented (`pixel-split`): a seeded pixel-art object is
  shown; drag a vertical cut so both halves hold the **same number of filled pixels**. Scored against
  the best split the object allows (odd counts can't split perfectly), so the optimal cut always scores
  full points. Same seeded object set for everyone; server owns the per-column counts and scores the
  cut. Since 2026-09-26 each puzzle is also **placed with the seeded RNG** (mirrored on a coin flip and
  dropped at a random offset inside a wider frame), so the ideal cut is no longer always in the same
  spot; counts and the best possible split are recomputed from the placed grid. FFA · drag · ~30 s
  (several objects) · low/medium effort · low latency · banter 💥💥.
- **E12. ✅ Pixel Weight ("guess the weight")** — implemented (`pixel-weight`): a pixel-art object
  flashes briefly, then hides; guess **how many filled pixels** it had on a slider. Points scale with
  closeness (`max(0, 10 − |error|)`); several objects. Seeded objects; server owns the counts. *Pixel
  Balance variant not built.* FFA · slider · ~30 s · low effort · low latency · banter 💥💥.
- **E13. ✅ Quick Tetris** — a short, fast Tetris sprint (compact variant of **E10**): identical seeded
  piece sequence for all; clear as many lines as possible in a fixed short window (or reach N lines
  fastest). *Implemented (`quick-tetris`): the same shared Tetris engine as Line Clear Sprint (with
  rotation + wall kicks), tuned to a 45 s window with a race to `TARGET_LINES = 8` — finishers ranked by time, others by
  lines cleared.* FFA · move/drop (keyboard + on-screen buttons) · ~45 s · high effort · low latency ·
  banter 💥💥.
- **E14. ✅ Sudoku Race** — everyone solves the **same seeded** Sudoku. *Implemented (`sudoku-race`): a
  4×4 grid (2×2 boxes), 8 of 16 cells blank; select a cell, then enter a digit from the number pad
  (or keys 1–4). A correct cell locks; a **wrong digit starts a 2 s input cooldown** for that player
  (`cooldownMs` on the wire), so guessing digit after digit is slower than solving (2026-09-26 — the
  old tap-to-cycle input plus the lock made brute-forcing every cell the best strategy). Winner is whoever
  completes it first; if nobody finishes in time, rank by **most correct cells placed** (server
  validates each cell, so a wrong entry never counts). The solved grid comes from a canonical valid
  sudoku via seeded digit relabeling + row/col/band/stack permutations — always valid, no backtracking
  solver needed — and the solution never goes on the wire.* FFA · tap cell + number pad · ~30 s ·
  medium effort · low latency · banter 💥💥.
- **E15. ✅ Bubble Pop ("Bust-a-Move")** — bubble-shooter puzzle: aim and shoot coloured bubbles upward at a
  hanging cluster; **3+ same-colour bubbles that touch pop**, and any bubbles left unattached drop for a
  bonus. Same **seeded** starting layout + shot-colour queue for everyone, so it's a fair race on an
  identical board; server owns the grid and validates each shot (client can't fake a clear). Ranked by
  bubbles cleared (finishers by fastest board-clear). *Implemented (`bubble-pop`): a simplified
  rectangular grid (8×7) with "choose a column" aim stands in for a true hex-grid shooter — the pop
  (4-directional flood fill, 3+ same colour) and floating-bubble-drop rules are the real thing.* FFA ·
  tap a column to shoot · ~60 s · medium/high effort · low latency · banter 💥💥.

### E1 (full card). ⭐ ✅ Color Trap ("Stroop") — implemented (`color-trap`)
- **Concept**: a color word (e.g., "RED") is shown in a mismatched ink color (e.g., blue). Tap the
  button matching the **ink color**, not the word it spells. The brain-fight is the joke.
- **Type**: FFA · **Input**: tap · **Duration**: 20–30 s (several fast rounds) · **Banter**: 💥💥💥
- **Rules**: same word/ink sequence for everyone (common seed). Each round shows a prompt + a small set
  of color buttons; correct tap scores, wrong tap or timeout scores nothing. Short per-prompt window
  (~1.5–2 s) keeps the pressure high.
- **Win condition**: most correct answers (tiebreak by total response time). · **Result**: ranking by
  correct count, then speed.
- **Latency**: low (server owns the seed; validates taps against the shown prompt). · **Complexity**: low.
- **Accessibility**: never color-only — pair each color button with a distinct shape/symbol and label
  so the mismatch is still solvable without color discrimination (see cross-cutting notes).

## H. Handicap / catch-up

To keep sessions competitive and full of comebacks, the session engine applies a bounded **scoring**
catch-up: trailing players earn a capped bonus on their own round award, scaled by how far behind they
are in the standings (see `scoring-system.md` §3.1). It's opt-in per room (host toggle, off by default)
and transparent — an applied bonus shows on the round-result screen.

Per-mini-game **mechanical** hooks (leader nerf, trailer boost, team weighting baked into a specific
game's rules) were considered and **dropped, not built** — see `implementation-decisions.md` D14. The
scoring lever alone meets the catch-up goal without a bespoke rule change in any of the 35 games. Where a game
is naturally fair to uneven groups by construction (e.g. Tug of War's per-member average, see C1), that
stays as ordinary game design, not a handicap hook.

## F. Sports — track & field and racing (2026-09-28)

Arcade sports classics, reskinned for the party. The four athletics events share one server sprint
model (`athleticsCore`): **alternate LEFT/RIGHT taps to build speed** — the same foot twice adds
nothing, speed bleeds off continuously, and strides faster than 20/s are ignored — so the steady speed
tracks the alternating tap rate (~7 m/s at 6 strides/s, ~9.3 at 10, ~10.8 at 15). Clients dead-reckon
every runner from the snapshot's `x` + `v`, so what a player sees lines up with the server's present
(this matters for jumping a hurdle or taking off at the board). See `implementation-decisions.md` D20.

### F1. ✅ 100 m Dash — implemented (`dash-100m`)
- **Concept**: Konami *Track & Field* sprint. Everyone side by side in their own lane; "SET…", then the
  gun — alternate the two buttons as fast as you can.
- **Type**: FFA · **Input**: two alternating buttons (◀ L / R ▶, or ← → / A D) · **Duration**: ~10–20 s
  (30 s cap) · **Banter**: 💥💥💥
- **Rules**: the gun fires at a seeded, unannounced moment 1.6–3.0 s after SET. A stride before it is a
  **false start**: that runner is held in the blocks for 1 s after the gun. Once the first runner
  finishes, the rest get 10 s.
- **Win condition / Result**: fastest race time; unfinished runners by distance (`10.42s` / `87m`).
- **Latency**: medium (tap rate matters, not exact timing). · **Complexity**: medium (shared with F2).

### F2. ✅ 110 m Hurdles — implemented (`hurdles-110m`)
- **Concept**: the dash plus a JUMP button and the regulation layout (first hurdle at 13.72 m, then every
  9.14 m, ten in all).
- **Type**: FFA · **Input**: L/R + JUMP (SPACE / ↑) · **Duration**: ~15–25 s (35 s cap) · **Banter**: 💥💥💥
- **Rules**: a jump is airborne for 480 ms (≈4.5 m at a good sprint) and strides don't count in the air.
  A hurdle is cleared only if the runner is airborne at the moment of crossing (server back-dates the
  crossing within the tick); otherwise it is knocked flat and the runner keeps just 40% of their speed.
- **Win condition / Result**: as F1. · **Latency**: medium/high (jump timing; mitigated by dead
  reckoning + an immediately predicted local hop).

### F3. ✅ Long Jump — implemented (`long-jump`)
- **Concept**: sprint down a 30 m runway, **hold JUMP at the board** — the take-off angle climbs while
  held (110°/s, arc gauge with the 45° sweet spot) — and release to fly into the sand.
- **Type**: FFA, everyone takes their own attempts in parallel · **Input**: L/R + hold/release JUMP ·
  **Duration**: 3 attempts, ~25–35 s (45 s cap) · **Banter**: 💥💥
- **Rules**: READY → RUN → AIM → FLIGHT → MARK per attempt. Taking off past the board, running through
  it, or never taking off within 9 s is a **foul**. Range is projectile motion (`v² sin 2θ / g`, scaled to
  ~8 m for a sharp run-up at 45°), **measured from the board** — an early take-off wastes distance.
  Holding past 85° auto-releases.
- **Win condition / Result**: best mark (`7.85m`, `NM` = no valid mark). Every player's best is planted
  as a flag in their color in the pit.

### F4. ✅ Javelin — implemented (`javelin-throw`)
- **Concept**: same run-up engine as F3 with a 28 m runway to the throwing arc; hold THROW to aim,
  release, and the camera follows the javelin down the field (~80 m for a sharp run-up at 45°).
- **Type / Input / Duration / Result**: as F3 (`72.49m`). Marks shown on a grass sector with 10 m lines.

### F5. ✅ Micro Race — implemented (`micro-race`)
- **Concept**: *Micro Machines*-style top-down racer on tabletop circuits — three seeded layouts (kitchen
  table, desk mat, pool table) with props, three laps, bumping encouraged.
- **Type**: FFA · **Input**: hold where you want to drive (touch/mouse) or arrows/WASD · **Duration**:
  ~40–60 s (90 s cap) · **Banter**: 💥💥💥
- **Rules**: start lights (2.4 s), staggered grid in seeded order. Arcade car physics: slight drift, much
  slower off the road, steering loosens at top speed (brake for hairpins), punchy car-to-car bumps.
  Lap progress only advances near the road you were on; straying for 1.5 s puts you back where you left
  it (no shortcuts). Once the first car takes the flag the rest get 12 s.
- **Win condition / Result**: finishers by time (`1:02.3`), the rest by laps + progress (`LAP 2`).
- **Latency**: high (continuous steering) — snapshot interpolation for every car.

## G. Elimination rounds — Squid Game-style (2026-10-02)

Short, tense FFA rounds where watching friends get zapped is the show. Ranked by elimination order
(survivors share 1st); eliminated players stay on screen, dimmed, and keep a way to take part; each
exit is a big moment (`fx.eliminate`: ELIMINATED! stamp, pixel burst, sting). Players are drawn as their
lobby avatar. Original names and art. See `implementation-decisions.md` D22.

### G1. ✅ Glass Bridge — implemented (`glass-bridge`)
- **Concept**: a bridge of rows over an abyss, each with a LEFT and a RIGHT glass panel — one tempered,
  one that shatters. Players cross **one at a time in a seeded vest order** (#1 first); everyone behind
  learns from every fall.
- **Type**: FFA · **Input**: LEFT / RIGHT (← → / A D, the two big buttons, or a tap on the panel) ·
  **Duration**: ~30–60 s (75 s cap) · **Banter**: 💥💥💥 · **Mobile-friendly**: yes
- **Rules**: rows = players + 2 (4–12). Already-solved rows are auto-walked; each unknown row is a 4 s
  jump timer (hesitate and you're pushed onto a seeded side). A lightning flash every 3–5.6 s shows a
  tiny glint on the tempered panel of the row being decided (easy to miss). Everyone not jumping —
  queued, fallen or safe — can point LEFT/RIGHT at that row: colored **heckle arrows**, honest or not.
- **Win condition / Result**: rows reached (`4/10`); everyone who crosses shares 1st.
- **Latency**: low (turn-based taps; the glint is held ≥ 2 snapshots). · **Complexity**: medium.

### G2. ✅ Freeze Doll ("Red Light, Green Light") — implemented (`freeze-doll`)
- **Concept**: race down your own lane toward a giant pixel doll. Move while she sings with her back
  turned; freeze before she faces the field — her laser catches anything that moves.
- **Type**: FFA · **Input**: hold WALK (↑ / W / SPACE) or RUN (SHIFT), or the two big hold buttons ·
  **Duration**: ~25–45 s (50 s cap) · **Banter**: 💥💥💥 · **Mobile-friendly**: yes
- **Rules**: the doll's whole timeline is seeded. Each GREEN is a chant of 8 notes whose tempo varies
  (shorter as the round goes on; the first one is long and calm) — she turns when it ends, after a
  500 ms head twitch. Some twitches are fake-outs (she looks away again and the chant resumes); from
  the third cycle a sudden spin can cut the chant short. On RED her laser sweeps across the lanes (from
  100 ms to 500 ms after she faces the field, direction alternating each turn) and every lane it has
  reached is watched until she looks away. Momentum: releasing WALK slides ~150 ms, RUN (1.6× faster)
  ~400 ms — running pays only if you stop early. Two hearts: the first hit stuns for 1 s and knocks you
  back 15 % of the field (one hit per RED at most), the second eliminates you.
- **Win condition / Result**: finishers by time (`31.2s`), then distance (`64%`), then the eliminated
  (last out first). The round ends once at most one runner is still in the race.
- **Latency**: medium — the 500 ms twitch plus the sweep delay is the reaction window (a balance
  simulation: walkers who react to the twitch are never hit; running until the twitch gets you hit).

### G3. ✅ Room Rush ("Mingle") — implemented (`room-rush`)
- **Concept**: a top-down arena — a spinning carousel in the middle and ten little rooms around the
  edge, each with a door facing the centre. A number is called; get into a room with exactly that many.
- **Type**: FFA · **Input**: arrows / WASD or hold the pointer where you want to go; SPACE / DASH to
  shove · **Duration**: 3–6 calls, ~30–70 s (75 s cap) · **Banter**: 💥💥💥 · **Mobile-friendly**: no
- **Rules**: each call: MUSIC (4–5.6 s, everyone held on the turning carousel, doors shut) → CALL
  (6.5 s, a number N in 1–4, N ≤ survivors − 1, and ⌊(survivors − 1) ÷ N⌋ rooms open — capacity always
  below the survivors) → buzzer. A room that holds exactly N for 0.5 s locks: the door slams and those
  inside are safe (that half second is the window to barge in and spoil it); at the buzzer anyone not
  in a locked room — or one holding exactly N — is ELIMINATED. The final two get one room for one.
  Sumo-style bouncy bodies, real walls (the door is the only way in), a dash (0.85 burst, 1 s cooldown).
- **Win condition / Result**: survivors share 1st; then by the call each player fell in (the same
  call's victims tie). Stat: seconds survived. The round ends when one player is left.
- **Latency**: high (continuous steering + shoving) — snapshot interpolation for every body.

## I. Arcade classics, party-sized (2026-10-02)

Real-time FFA reworks of arcade classics, keyboard-first (PC). Players are drawn as their lobby
avatar. See `implementation-decisions.md` D22.

### I1. ✅ Sumo ICE — implemented (`sumo-ice`)
- **Concept**: Sumo Push on an ice floe that melts — a battle royale where the ring shrinks under you.
- **Type**: FFA · **Input**: arrows / WASD or hold the pointer where you want to go · **Duration**:
  ~20–45 s (45 s cap) · **Banter**: 💥💥💥 · **Mobile-friendly**: no (continuous steering, like B3)
- **Rules**: a 13×13 floe of ice tiles inside a circle. Nothing melts for 6 s; then a seeded order eats
  it edge-first but irregularly (a jitter of ~28 % of the radius punches holes), each tile cracking for
  1.5 s before it sinks; only a 3×3 core is left for the last 8 s. Ice physics: weak grip (accel 1.1),
  little friction (0.55/s, vs 2.0 on the dohyo) and bouncier shoves. A body over open water falls in —
  the first time a **lifebuoy** fishes it back onto the core (1.2 s as a ghost, no collisions), the
  second time it's out.
- **Win condition / Result**: last one standing; the rest by survival time (`21s`).
- **Latency**: high (continuous steering) — snapshot interpolation for every body.

### I2. ✅ Pang — implemented (`pang`)
- **Concept**: *Buster Bros* — walk along the floor and fire a harpoon straight up; a hit splits a
  balloon into two smaller ones until the tiniest just pops.
- **Type**: FFA, everyone in their own arena with the **same seeded waves** (a fair race) · **Input**:
  ← → / A D to walk, SPACE / ↑ to fire, or ◀ FIRE ▶ buttons · **Duration**: 50 s · **Banter**: 💥💥 ·
  **Mobile-friendly**: no
- **Rules**: four balloon sizes, each bouncing back to its own fixed height (bigger = higher); one
  harpoon at a time, fired from where you stand (the wire pops the first balloon it touches). Clear a
  wave and the next, bigger one drops in 1.2 s later. A balloon touching you costs one of 3 lives
  (1.5 s of blinking invulnerability follows); out of lives, you're out.
- **Win condition / Result**: most pops (`23`), then lives left, then whoever got there first.
- **Latency**: medium — the client runs the same balloon physics between snapshots (`PANG` constants
  are shared), and on wide screens shows everyone else's arena as a live thumbnail.

### I3. ✅ Star Blaster (vertical shmup) — implemented (`star-blaster`)
- **Concept**: a vertically scrolling shooter in your own viewport — everyone faces the **same seeded
  attack script**: drone formations, gunners that hover and spray rings/fans, a boss for the last
  ~16 s. The ship (your color, your avatar in the cockpit) fires on its own; you steer to aim and dodge.
- **Type**: FFA · **Input**: arrows / WASD or hold the pointer where you want the ship · **Duration**:
  50 s · **Banter**: 💥💥 · **Mobile-friendly**: no
- **Rules**: drones (1 HP, 10 pts) swoop down and veer off before the ship's zone; gunners (5 HP,
  50 pts); the boss (60 HP, 400 pts). A bullet or a ram costs one of 3 lives and 25 points, then 2 s of
  blinking; a rammed drone is destroyed (no points). Out of lives, you're out. Bullet-hell hitbox (the
  ship's sprite is bigger than its 0.018 hit radius).
- **Win condition / Result**: highest score (`640`), then lives left.
- **Latency**: medium — enemies and bullet patterns are a pure function of (seed, time) evaluated on
  both sides; tuned with simulated pilots (an idle ship loses ~1 life per round, a dodging one ~0.1 and
  scores ~2.3× more).

### I4. ✅ Asteroids Arena (competitive Asteroids) — implemented (`asteroids`)
- **Concept**: classic *Asteroids*, but everyone shares one wrapping sky — rocks to break and rivals
  to shoot.
- **Type**: FFA · **Input**: ← → / A D turn, ↑ / W thrust, SPACE fire, or ◀ ▶ THRUST FIRE hold buttons
  · **Duration**: 60 s · **Banter**: 💥💥💥 · **Mobile-friendly**: no
- **Rules**: inertia ships (thrust 0.95, light drag, 0.75 top speed), a gun with a 220 ms cadence and
  4 bullets in flight. Rocks split big → medium → small → gone and pay 20 / 50 / 100; a rival ship pays
  250. A rock or a rival's bullet blows you up — back in 2 s at the safest of a few seeded spots, with
  2 s of shield. The field is topped up with big rocks (away from ships) whenever it thins out.
- **Win condition / Result**: highest score (`1830`), then kills.
- **Latency**: high — ships, rocks and bullets are extrapolated from the snapshot's velocities; your own
  heading is predicted from your held keys. Ships are their pilot's lobby avatar, turned to the heading.

### I5. ✅ Bomber Express (Bomberman) — implemented (`bomber-express`)
- **Concept**: classic *Bomberman*, but everyone starts **fully powered** — fire range 5, five bombs,
  fast boots — so it's chaos from the first second.
- **Type**: FFA · **Input**: arrows / WASD (or the d-pad) to walk, SPACE / BOMB to drop one ·
  **Duration**: ~15–60 s (60 s cap) · **Banter**: 💥💥💥 · **Mobile-friendly**: no
- **Rules**: a 17×13 grid — border walls, a pillar on every even/even cell, a seeded 60 % scatter of
  crates (each spawn cell and its neighbours kept clear; up to 10 spawns). Tile-to-tile movement
  (150 ms per tile at the start). Bombs blow after 2.2 s in a cross that stops at walls and at the first
  crate (which it breaks), setting off any bomb in its path (chain reactions); flames burn 0.55 s. A
  third of the crates hide a power-up: +fire (to 9), +bomb (to 8), faster boots. Bombs block the way.
- **Win condition / Result**: last one standing; then knock-outs scored (a self-KO scores nothing),
  then who lasted longer (`2 KO`).
- **Latency**: medium — steps are interpolated client-side from the snapshot's step progress.

---

## Variety coverage

| Axis | Covered by |
|------|------------|
| Reflexes / reaction | A1, A6, B1, E7, F5, G2, I3 |
| Attention / focus (inhibition) | E1, E3, E4, G1 |
| Speed / endurance | A2, A9, C1, F1, F2, G3 |
| Knowledge | A3 |
| Mental math | E2 |
| Memory | A4, A11, E8 |
| Precision / aim / timing | A5, A10, B2, E6, F2, F3, F4, I2 |
| Survival / dodging | A7, A8, B3, I1, I3, I5 |
| Nerve / chance | D1, D3, E5, G1, G2, G3 |
| Teamwork | C1, C2, C3 |
| Head-to-head rivalry | B1, B2, B3, E7, I4 |

## Format mix

| Format | Mini-games |
|--------|-----------|
| Individual (FFA) | A1–A11, D1–D3, E1–E6, E8–E10, F1–F5, G1–G3, I1–I5 |
| Duel (1v1 / bracket) | B1, B2, B3, E7 |
| Team | C1, C2, C3 |

## MVP selection & shipping order

The catalog ships **incrementally** (see `backlog.md`). We do **not** build all of it up front.

- **MVP (Phase 0)** — 3 individual, latency-tolerant games to validate the engine and scoring:
  **A1 Quick reaction, A2 Button masher, E1 Color Trap**. **A3 Trivia** and **D1 Balloon Chicken** are
  the immediate fast-follows (still P0-tier; see `minigame-ideas.md`).
- **Phase 1** — grow individual variety (P1 tier): A4 Simon, A6 Bug smash, A10 Timing, and the rest of
  the P1 group in `minigame-ideas.md`.
- **Phase 2** — introduce formats: C1 Tug of War (team), B2 Sink the Fleet (duel, turn-based, low
  latency — validates the bracket flow without real-time netcode).
- **Phase 5** — real-time-netcode-heavy games (B1 Pong, B3 Sumo, A9 Pixel Dash, A8 Snake, A7 Pixel rain)
  once the sync layer is proven.

## Cross-cutting design considerations

- **Simple, responsive-first inputs**: prioritize tap/drag; must work on mobile portrait.
- **Determinism with a common seed**: for "same board for everyone" games, the server emits a seed and
  validates the final result — never trust the client.
- **Rules explainable in 1 screen**: understandable from the intro, no long tutorial.
- **Accessibility**: don't rely on color alone (add shapes/symbols in Simon, Trivia, etc.).
- **Banter surface**: expose live standings, near-misses, and reaction moments (last-second overtakes,
  balloon bursts, sudden-death) — these are what make the group laugh.
