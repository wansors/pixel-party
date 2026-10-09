# Mini-game catalog — Pixel Party

- **Version**: 0.4 (draft)
- **Date**: 2026-07-20

Initial mini-game catalog. Each one is designed for the **each player on their own device** model (PRD
§4) and returns a **normalized result** to the engine (ranking or orderable score, §8.3).

## Design pillars

- **Party scale**: built for **4–12 players** in the same session (usually up to 8); each game declares
  its own range — hard min/max plus a recommended band — in `MINIGAMES[].players` (D27).
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
- **Input**: touch tap, drag, keyboard, etc. The game is PC-first (D21): since the PC launch pass
  (2026-10-04, D30) every action has a key (movement takes arrows *and* WASD), and the round intro card
  names them (`catalog.minigame.<id>.controls`); the Input lines below list those keys.
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
(`bomber-express`), I6 Street Brawl (`brawl`), and the racing cluster's F6 Rally Stage (`rally-stage`)
and F7 Speed Circuit (`speed-circuit`); then the cluster's suggested extras, G4 Honeycomb Cut
(`honeycomb-cut`), G5 Jump Rope (`jump-rope`) and G6 Marbles Duel (`marbles-duel`). **54 mini-games
total — every game idea on the roadmap is built.**
Then (2026-10-03) J1 Weird Trivia (`weird-trivia`), the first brand-new idea after the roadmap.
**55 mini-games total.**

---

## A. Individual — Free-for-all

### A1. ⭐ ✅ Quick reaction ("Go!") — implemented (`reaction-duel`)
- **Concept**: the screen is red; at a random moment it turns green. First to tap wins. Tapping early is
  penalized.
- **Type**: FFA · **Input**: click / tap, or SPACE / ENTER · **Duration**: one shot, ~2–10 s · **Banter**: 💥💥
- **Rules**: after a seeded delay (1.5–4.5 s) the screen turns green; everyone has 5 s to tap. A tap that
  reaches the server before green is a false start. The time credited is the client's own (its screen
  turning green → the tap, so the round trip doesn't count), bounded by the server's measurement: never
  under 100 ms, never more than 150 ms better than the server saw, never worse.
- **Win condition**: fastest valid reaction. · **Result**: ranking by time (lower wins); false starts
  and no-taps share last.
- **Latency**: low (client-timed, server-bounded). · **Complexity**: low.

### A2. ⭐ ✅ Frantic tap ("Button masher") — implemented (`button-masher`)
- **Concept**: tap as many times as you can in a fixed time.
- **Type**: FFA · **Input**: repeated click / tap or SPACE (only Space and the mouse, so a keyboard
  roll can't reach the cap) · **Duration**: 10 s · **Banter**: 💥💥
- **Rules**: 10 s of free tapping; the server counts at most 15 presses per rolling second (about the
  best a finger manages), so an autoclicker only ties the fastest masher. The scene shows the cap: a
  speed gauge beside the button tops out at MAX, and presses over it aren't sent.
- **Win condition**: highest tap count. · **Result**: ranking by count (higher wins).
- **Latency**: low (your count goes up on the press; the snapshot confirms it). · **Complexity**: low.

### A3. ✅ Lightning quiz ("Trivia") — implemented (`trivia`)
- **Concept**: multiple-choice questions; rewards correctness and speed.
- **Type**: FFA · **Input**: click / tap an option, or A–D / 1–4 · **Duration**: up to 36 s (4
  questions) · **Banter**: 💥💥
- **Rules**: each question has a 7 s answer window (it closes early once everyone still in the round
  has answered), then a 2 s reveal: the right tile lights up and every player's avatar pops onto the
  tile they picked. A right answer scores 1000 + a speed bonus of up to 1000, banked the moment it lands
  (the "lightning" verdict); wrong or no answer = 0. The phases live in `quizCore`, shared with J1.
- **Win condition**: highest total score. · **Result**: ranking by points.
- **Latency**: low. · **Complexity**: medium (question bank + i18n).
- **The bank** (2026-10-03, D24): 53 general-knowledge questions, server-side (`triviaBank.ts`),
  written natively in EN and ES; each round deals 4 of them with the options shuffled. Questions whose
  answer depends on a convention (how many continents, which colors are primary) are left out.

### A4. ✅ Sequence memory ("Simon") — implemented (`simon`)
- **Concept**: repeat a growing sequence of colors/sounds.
- **Type**: FFA · **Input**: click / tap the pads, or Q W / A S or 1–4 (top row or numpad) ·
  **Duration**: up to 60 s · **Banter**: 💥
- **Rules**: one seeded growing sequence, replayed at your own pace; a mistake eliminates you. Each
  player sees it through their own seeded relabelling of the four pads (same rhythm and repeats, so
  equally hard), so a rival further ahead on the room-wide snapshot never shows you your next pads.
- **Win condition**: most levels completed; ties go to how far into the current replay the run got,
  then to whoever cleared their last level sooner. · **Result**: ranking by level.
- **Latency**: low. · **Complexity**: low/medium.

### A5. ✅ Pixel Hoops ("Basketball") — implemented (`pixel-hoops`)
- **Concept**: arcade free-throw shooting — swipe/tap to set power and angle and sink as many baskets as
  possible; the hoop moves as it heats up.
- **Type**: FFA · **Input**: hold to charge, release to shoot (mouse / touch, or SPACE / ENTER; a
  charge is dropped if the window loses focus mid-hold) · **Duration**: 30 s · **Banter**: 💥💥💥
- **Rules**: same hoop pattern for everyone. Score per basket; consecutive baskets build a combo.
- **Win condition**: most points. · **Result**: ranking by baskets/combo.
- **Latency**: low/medium (client sim, server validates final score). · **Complexity**: medium.

### A6. ✅ Bug smash ("Whack-a-mole") — implemented (`bug-smash`)
- **Concept**: pixel bugs pop out of holes; smash them before they hide. Some bugs penalize.
- **Type**: FFA · **Input**: click / tap a hole, or its key — Q W E / A S D / Z X C, or the numpad
  (7 8 9 on top) · **Duration**: 30 s · **Banter**: 💥💥
- **Rules**: identical spawn sequence (common seed). A bug +1, a bomb −1 — even at 0 (a score can go
  negative), so a bomb always hurts. A whiff at an empty hole sticks the mallet for 400 ms (client
  side), so rolling a hand over all nine keys is worse than aiming.
- **Win condition**: highest score. · **Result**: ranking by score.
- **Latency**: low. · **Complexity**: low/medium.

### A7. ✅ Pixel rain ("Dodge") — implemented (`pixel-rain`)
- **Concept**: move an avatar to dodge falling objects; survive as long as possible.
- **Type**: FFA (own board, same seed) · **Input**: mouse (the avatar follows the pointer; drag on
  touch) or ← → / A D · **Duration**: up to ~30 s · **Banter**: 💥💥
- **Rules**: identical obstacle pattern (same seed); eliminated on collision. Blocks spawn across the
  whole width (0.03–0.97) while the avatar is held inside it (0.12–0.88), so hugging a wall buys
  nothing; the avatar slides toward the steered spot at most 1.6 widths/s (no teleporting out from
  under a block) — a held key heads for that kerb at the same speed and letting go stops on the spot,
  so keys and mouse play the same game. The client slides your avatar the same way, toward the same
  target, so it stands where the server judges it. The rain thickens over the round: by the end the
  gaps are ×0.45 and the fall times ×0.6. In a multiplayer round the round ends as soon as only one
  player is left standing (a player who leaves is out); a solo round runs until the player is out or
  time is up.
- **Win condition**: longest survival. · **Result**: ranking by time.
- **Latency**: medium (client sim, server validates final time). · **Complexity**: medium.

### A8. ✅ Snake Arena — implemented (`snake-arena`)
- **Concept**: classic snake — grow by eating pixels, don't crash into walls or your own tail.
- **Type**: FFA (own board, same food seed) · **Input**: arrows / WASD or swipe · **Duration**: up to
  ~30 s · **Banter**: 💥💥
- **Rules**: same food layout for everyone; crashing eliminates you. A snake waits for its player's
  first direction ("pick a direction"; at most 2 s, then it sets off the way it faces) — that first
  press may even reverse it — so nobody hits a wall before touching a key. Up to two turns are buffered
  ahead of the next step, so two quick taps inside one step (a U-turn) both apply.
- **Win condition**: longest snake; equal lengths go to whoever reached it first, then to a snake still
  alive. · **Result**: ranking by length.
- **Latency**: medium — your snake is predicted with the shared step rule (`snakeStep`) on the server's
  clock; a turn shows on the next step and names the step it was meant for, so the server turns on the
  same cell. · **Complexity**: medium.

### A9. ✅ Pixel Dash ("Platform race") — implemented (`pixel-dash`)
- **Concept**: short auto-runner/obstacle sprint; first to the flag wins.
- **Type**: FFA (own track, identical layout) · **Input**: click / tap, SPACE / ↑ / W / ENTER to jump ·
  **Duration**: up to ~30 s · **Banter**: 💥💥💥
- **Rules**: identical track; each obstacle reaches the runner at a fixed time, 700–1300 ms apart at the
  start, tightening to 700–1000 ms by the end (never shorter than a jump plus a landing). A jump keeps you
  airborne 380 ms and clears an obstacle arriving in that span (60 ms of grace for the tap's trip); an
  obstacle that gets through is a stumble. Back on the ground you need 150 ms before jumping again —
  400 ms more after a jump that cleared nothing — so mashing loses to timing.
- **Win condition**: most obstacles cleared; ties go to the more accurate jumper (smallest summed gap
  between each clearing jump and the ideal one, apex over the obstacle). · **Result**: ranking by
  clears.
- **Latency**: medium (client sim + server validation). · **Complexity**: medium/high.

### A10. ✅ Stop the clock ("Timing") — implemented (`stop-clock`)
- **Concept**: a fast-moving bar/needle; stop it as close to the target as possible.
- **Type**: FFA · **Input**: click / tap STOP, or SPACE / ENTER · **Duration**: 20–30 s (3 attempts) ·
  **Banter**: 💥💥
- **Rules**: 3 attempts; summed distance to target. Lower = better. An attempt never made (time ran out,
  or the player left) is charged the worst error (1.00), and the result shows that penalised total.
- **Win condition**: lowest accumulated error. · **Result**: ranking by error.
- **Latency**: low. · **Complexity**: low.

### A11. ✅ Speed puzzle ("Match") — implemented (`match-pairs`)
- **Concept**: memory/card game — uncover matching pairs fastest / with fewest attempts.
- **Type**: FFA (own board, same pairs) · **Input**: click / tap a card, or arrows / WASD to move a
  cursor + SPACE / ENTER to flip · **Duration**: up to ~30 s · **Banter**: 💥
- **Rules**: everyone gets the same 8 pairs, each dealt in their own seeded 4×4 layout (equally hard,
  but a neighbour's screen — or a rival's reveals on the room-wide snapshot — says nothing about yours).
- **Win condition**: first to complete; non-finishers by pairs matched, then fewer misses.
  · **Result**: ranking by time/pairs/attempts.
- **Latency**: low. · **Complexity**: medium.

---

## B. Duels — 1v1 / bracket

> Players are seeded into 1v1 pairs and every pair plays at once. An odd player out gets a bye — it goes
> to whoever has had the fewest so far, so byes rotate — and watches a live duel; so does a duellist
> whose own duel is over, after 4 s on its verdict (`duelWatch.follow`). Duels rank across the
> room in three tiers (D28): wins, then draws and byes, then losses, each tier ordered by the game's
> margin. A player who leaves forfeits: their opponent wins on the spot. Great for building rivalries.

### B1. ✅ Pixel Pong — implemented (`pixel-pong`)
- **Concept**: classic pong, 1v1. First to 5 points.
- **Type**: Duel (simultaneous pairs) · **Input**: mouse (just move it), W S / ↑ ↓, or drag on touch ·
  **Duration**: 45 s (+ up to 10 s of golden point) · **Banter**: 💥💥💥
- **Rules**: standard pong; ball speeds up over time. At the bell the leader wins; a tied duel plays a
  **golden point** (next point wins) for up to 10 s more, then it's a draw.
- **Win condition**: first to 5 points, or ahead at the bell. · **Result**: the duel tiers, by point
  difference.
- **Latency**: high (real-time 1v1) — your paddle is local; the ball runs forward from the latest
  snapshot's position + velocity with the server's wall/paddle rules (a correction fades in over
  ~60 ms), and the opponent's paddle eases toward its latest position. · **Complexity**: high.

### B2. ✅ Sink the Fleet ("Battleship") — implemented (`sink-the-fleet`)
- **Concept**: classic battleship — place your fleet, then take turns firing at the opponent's grid.
- **Type**: Duel (simultaneous pairs) · **Input**: click a cell, or aim with arrows / WASD and fire
  with SPACE / ENTER · **Duration**: 60 s · **Banter**: 💥💥💥
- **Rules**: a 5×5 grid, a seeded auto-placed fleet (3 + 2 + 2 cells, never on the wire), then turns of
  5 s (a timeout passes the turn). **A hit shoots again**; a miss hands the turn over.
- **Win condition**: sink the enemy fleet first; at the bell, more hits, then fewer shots fired (equal
  on both = draw). · **Result**: the duel tiers, by hits landed minus hits taken.
- **Latency**: low (turn-based). · **Complexity**: medium.

### B3. ✅ Sumo Push — implemented (`sumo-push`)
- **Concept**: pixel sumos in a ring; shove and charge the others out.
- **Type**: FFA arena (2–12 in one ring; two players make a 1v1 bout) · **Input**: direction + DASH ·
  **Duration**: ~30 s · **Banter**: 💥💥💥
- **Rules**: physics shove; last one in the ring wins (battle royale). Touch/mouse: hold where you want
  to push — the direction is aimed from your own wrestler; arrows / WASD also work. **DASH** (SPACE /
  ENTER / the DASH button) bursts you toward where you push, once per 1.5 s; collisions are elastic,
  so a dash's momentum goes into whoever it hits (miss, and you may fly out yourself). The ring holds
  its size for the first 40 % of the round, then shrinks to narrower than a wrestler by the bell, so
  holding the centre isn't a lock.
- **Win condition**: last standing / longest in-ring. · **Result**: ranking by survival.
- **Latency**: high (FFA arena) / medium (1v1) — every wrestler is stepped forward from the last
  snapshot with the shared physics (`sumoStep`): yours with the keys you hold now (a dash the moment
  you press), the others with their last push; corrections blend in. · **Complexity**: high.

---

## C. Team-based

> Players are split into two teams (red/blue; a balanced seeded assignment the host can move or
> shuffle). Team result awards points to all members. Each game declares its own minimum (Tug of War 2,
> Bomb Relay and Fleet Battle 4), and a team game needs someone connected on each side (D28).

### C1. ✅ Tug of War — implemented (`tug-of-war`)
- **Concept**: two teams button-mash to drag the pixel rope to their side.
- **Type**: Team · **Input**: repeated click / tap, SPACE / ENTER · **Duration**: 15 s · **Banter**: 💥💥💥
- **Rules**: progress is the team's *average* pulls-per-member, which is already fair for uneven team
  sizes without needing a separate handicap hook (see §H); the HUD shows each team's pulls per head. A
  member who leaves stops counting (their pulls and their seat), so a dropped teammate doesn't drag the
  average down. A member's pulls count at most 15 per rolling second (the Button Masher cap), so an
  autoclicker or a two-key drum roll pulls no harder than the fastest finger.
- **Win condition**: open a lead of 25 pulls per member (instant), or lead at the bell. · **Result**:
  winning team ranks above (equal averages draw).
- **Latency**: low (aggregate rates). · **Complexity**: low/medium.

### C2. ✅ Bomb Relay ("Hot potato") — implemented (`bomb-relay`)
- **Concept**: a lit pixel bomb is passed around the team; mash to pass it on before it explodes. It
  blows up in whoever holds it.
- **Type**: Team · **Input**: repeated click / tap, SPACE / ENTER · **Duration**: 25 s · **Banter**: 💥💥💥
- **Rules**: one bomb per team, one holder at a time. The holder mashes 12 times (at most 15 counted
  per rolling second, the Button Masher cap; your own mashes light the leg bar at once) to pass it on (+1
  relay) before a hidden seeded fuse (2.5–5 s) runs out; if it blows, the team takes an explosion and
  the bomb moves on. A holder who doesn't mash for 1.8 s is skipped ("TOO SLOW!"): the bomb moves on
  with a fresh fuse and no relay credit. A member who leaves drops out of the chain. A team's pace is
  its members' mashing speed, whatever its size.
- **Win condition**: most relays (fewer explosions breaks ties). · **Result**: team ranking.
- **Latency**: medium. · **Complexity**: medium.

### C3. ✅ Fleet Battle (team variant of Sink the Fleet) — implemented (`fleet-battle`)
- **Concept**: two teams (red/blue) each defend one SHARED fleet; members coordinate shots against the
  enemy team's fleet. *Implemented: turn alternates by team (the seed picks who opens) rather than a
  per-turn shot budget. Each 6 s team turn has a **captain** — the team's members take it in turns, in
  a seeded order (a leaver drops out) — who fires alone for the first 3 s; then any teammate may. The
  first valid `fire` consumes the turn and passes it to the other team; a stalling team forfeits its
  turn on a timeout.*
- **Type**: Team · **Input**: click a cell, or arrows / WASD + SPACE / ENTER · **Duration**: ~90 s ·
  **Banter**: 💥💥
- **Rules**: same seeded auto-placed fleet + hit/miss mechanic as Sink the Fleet, scoped to team fleets
  (here every shot passes the turn).
- **Win condition**: sink the enemy fleet first; at the timer, more damage dealt, then fewer shots for
  it (which also offsets the opening team's extra shot), else a draw. · **Result**: team ranking.
- **Latency**: low (turn-based). · **Complexity**: medium.

---

## D. Chaos / party (banter-first)

### D1. ✅ Balloon Chicken ("Nerve") — implemented (`balloon-chicken`)
- **Concept**: pump pixel balloons for points — but each bursts at a hidden threshold. Cash out before
  it pops or lose that balloon. Pure nerve, maximum trash talk.
- **Type**: FFA · **Input**: PUMP (click / tap or SPACE), CASH OUT (click / tap or ENTER) · **Duration**:
  ~20 s · **Banter**: 💥💥💥
- **Rules**: three balloons each, one after the other, the **same seeded sequence for everyone**
  (balloon k bursts on the same pump for all, somewhere in 4–18; never on the wire). Each pump +10;
  CASH OUT banks the balloon in hand and brings the next; a burst loses it. A balloon still in hand at
  the buzzer bursts, so walking away has to be a choice. A pump shows at once (the server confirms it a
  snapshot later); a burst or a cash-out is the server's word. Scenes show rivals' balloon status, not
  their pump count.
- **Win condition**: highest banked points. · **Result**: ranking by banked points (ties share).
- **Latency**: low (server owns the threshold). · **Complexity**: low.

### D2. ✅ Fruit Catch — implemented (`fruit-catch`)
- **Concept**: catch falling fruit in a basket; avoid the bombs.
- **Type**: FFA (same seed) · **Input**: mouse (the basket follows the pointer; drag on touch) or ← → /
  A D · **Duration**: 30 s · **Banter**: 💥💥
- **Rules**: identical drop pattern; a fruit +1, a bomb −1 (never below 0) and breaks the combo. The
  basket slides toward where you steer at most 1.8 widths/s (the mouse can't teleport it, so mouse and
  keys play the same game; a held key heads for that side, letting go stops on the spot). Items fall
  linearly, so the client draws them on the server's clock (`ServerClock`) and slides your basket the
  server's way: what you see reaching the basket is what gets judged.
- **Win condition**: highest score; ties go to fewer bombs caught, then the longer best combo.
  · **Result**: ranking by score.
- **Latency**: low/medium. · **Complexity**: low/medium.

### D3. ✅ Pixel Roulette ("Luck") — implemented (`pixel-roulette`)
- **Concept**: pure chance to shake up standings (Mario Party style).
- **Type**: FFA · **Input**: click / tap SPIN, or SPACE / ENTER · **Duration**: 15 s · **Banter**: 💥💥
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
  mashing one button is slower than doing the sums. The three near-miss decoys sit within 5 of the
  answer, and how many fall below it is drawn uniformly, so the answer's rank among the sorted choices
  gives nothing away ("pick a middle one" is a plain 1-in-4 guess). On a PC just type the result: the
  answer goes as soon as it's unambiguous (ENTER for a number that also starts another, like 1 vs 12;
  Backspace fixes), and a number no button shows only flashes red (no penalty). No slot keys 1–4: next
  to number answers they'd read as the answer "1".* FFA · type / click · 30 s · low effort · low
  latency · banter 💥💥.
- **E3. ✅ Odd One Out** — spot the single different pixel/tile in a grid; grid grows each round.
  *Implemented (`odd-one-out`): seeded board sequence, grid grows + brightness gap shrinks per level;
  the odd tile differs in brightness (not hue alone) for accessibility; a wrong tile costs a 1 s tap
  cooldown, so tapping everything is slower than looking; ranked by level reached.*
  FFA · click / tap (mouse-only on PC: the hunt is spatial) · 30 s · low effort · low latency · banter 💥💥.
- **E4. ✅ Number Rush (Schulte grid)** — tap numbers 1→N in order as fast as possible. *Implemented
  (`number-rush`): one shared seeded 5×5 layout, self-paced; ranked by numbers cleared, finishers by
  time. A wrong number costs a 0.5 s tap cooldown (the board dims behind a draining bar), so sweeping
  every cell in reading order is slower than looking; a number already cleared (a double click) costs
  nothing. A right number counts on the click; the server confirms it.* FFA · click / tap (mouse-only on
  PC) · 20–30 s · low effort · low latency · banter 💥💥.
- **E5. ✅ Higher or Lower** — guess if the next pixel card is higher/lower to build a streak, and know
  when to stop. *Implemented (`higher-lower`): each player gets their own seeded deck (a shared one
  leaked your next card through a rival's face-up one); the server owns upcoming cards (never revealed
  early). A right guess extends the streak; **BANK** stops and keeps it; a miss ends the run and
  **halves** it; still playing at the buzzer keeps it. Odds swing with the face-up card, so when to bank
  is the game. Ranked by score alone (equal scores tie); the round ends once nobody is still playing.*
  FFA · click / tap, or HIGHER ↑ / W, LOWER ↓ / S, BANK ENTER / B (never Space, so a stray press can't
  bank a run at 0) · 22 s · low effort · low latency · banter 💥💥💥 (nerve).
- **E6. ✅ Pixel Beat** — tap to the rhythm; hit the beats on time. *Implemented (`pixel-beat`): one
  seeded beat timeline shared by everyone, in bars of four: plain quarter notes at first, then seeded
  rhythms with rests and off-beats (from 12 s, busier from 24 s), while the tempo tightens from 650 to
  470 ms a beat between 8 s and 36 s. A tap within a tight window of a not-yet-scored beat scores big, a
  looser window scores small; a tap near no beat, or a beat let pass (untapped once its window has
  closed, checked on the server tick), breaks the streak. A tap is judged
  at the client's own round time (`at`), trusted only between 250 ms behind and 50 ms ahead of the
  server's measurement, so network lag doesn't eat the PERFECT window; the first tap in reach of a
  beat consumes it, so spamming lands early for a GOOD at best.* FFA · click / tap, SPACE or any
  letter, digit, arrow or ENTER (two hands can drum the off-beats) · ~40 s · medium effort ·
  low/medium latency · banter 💥💥.
- **E7. ✅ Quick Draw Duel** — implemented (`quick-draw`); — western reaction shootout: draw first when "FIRE!" flashes, 1v1.
  *Simultaneous seeded pairs (see §B); a tap before FIRE loses (the sign says TOO EARLY!), and if
  neither draws within 4 s of FIRE! both lose (no draws) — a frozen standoff doesn't hold the room until
  the bell. The reaction time credited is the client's own (its FIRE! on screen → the draw), bounded by
  the server's measurement: never under 100 ms, never more than 200 ms better than the server saw, never
  worse; who wins a standoff is still the first draw to arrive. Ranked in the duel tiers: winners by
  reaction time, the bye, then losers — beaten by a quicker draw first, then the no-shows, then the
  false starts.* Duel · click / tap, SPACE / ENTER · up to 20 s · low effort · medium latency · banter 💥💥💥.
- **E8. ✅ Memory Flash** — a burst of pixels flashes; answer how many of a target appeared. *Implemented
  (`memory-flash`): seeded board sequence, self-paced; client flashes then asks; server owns the counts.
  Ranked by right answers; ties go to whoever got their last right answer in sooner (a wrong answer
  never moves it).* FFA · type the count (a unique match answers at once), or arrows / WASD + ENTER /
  SPACE, or click · 30 s · low effort · low latency · banter 💥💥.
- **E9. ✅ Maze Sprint** — navigate a small maze to the exit fastest (identical maze for all).
  *Implemented (`maze-sprint`): one seeded 9×9 perfect maze (iterative randomized-DFS carve, always
  fully connected) shared by everyone; each player moves their own position through it independently,
  at most one step per 90 ms on average (a held key walks at the same pace on every machine); two steps
  may arrive up to 45 ms closer than that (the network bunching evenly sent steps) without one being
  lost, while a key-repeat burst still is. Your token steps (or bumps a wall) on the frame you press,
  predicted from the same wall data; the snapshot only corrects it if the server disagrees. While you race,
  rivals show only as progress bars — their distance to the exit, since their spot would give the path
  away — and their positions appear once you finish. Ranked by finish time, then by BFS
  distance-remaining-to-exit for non-finishers.* FFA · arrow keys/WASD + on-screen buttons · up to
  45 s · medium effort · low latency · banter 💥💥.
- **E10. ✅ Line Clear Sprint** — Tetris-like: clear N lines fastest. *Implemented
  (`line-clear-sprint`): a Tetris engine (shared with Quick Tetris, see E13) on a 6×12 board: the seven
  tetrominoes, dealt to everyone from the same seeded 7-bags (no droughts, no floods), turning about
  their centre (SRS-style) with wall/floor kicks; a ghost shows where the piece lands and NEXT the coming
  one. Maximize lines cleared in a fixed 60 s window. Topping out isn't the end: it costs 2
  lines (never below 0) and a 1.5 s freeze, then the board restarts empty — nobody sits out the rest of
  the round. Ranked by lines cleared, fewer top-outs breaking ties. The engine lives in `@pp/shared`
  (`tetrisSprint`), so your board is predicted: every move, turn, drop and lock shows on the frame you
  press.* FFA · ← → / A D move (held: 150 ms, then a step every 45 ms — the same on every machine), ↑ /
  W / X rotate, Z rotate back, ↓ / S soft drop, SPACE / ENTER hard drop, or the on-screen buttons · 60 s
  · high effort · low latency · banter 💥.
- **E11. ✅ Pixel Split ("cut in half")** — implemented (`pixel-split`): a seeded pixel-art object is
  shown; drag a vertical cut so both halves hold the **same number of filled pixels**. Scored against
  the best split the object allows (odd counts can't split perfectly), so the optimal cut always scores
  full points; a worse cut earns partial credit, `⌊10 × (1 − excess ÷ (total ÷ 2))⌋` for `excess` pixels
  of imbalance beyond the best cut — one column off still scores about half, a 3:1 split nothing. Same
  seeded object set for everyone; server owns the per-column counts and scores the
  cut. Since 2026-09-26 each puzzle is also **placed with the seeded RNG** (mirrored on a coin flip and
  dropped at a random offset inside a wider frame), so the ideal cut is no longer always in the same
  spot; counts and the best possible split are recomputed from the placed grid. Since 2026-10-09 the
  round is **20 s for up to 10 objects** (it was 30 s for 8: too much time to deliberate) and only
  **lopsided objects** are dealt: most of the shared art is left-right symmetric, so a cut straight down
  the middle of the object scored full marks. Pixel Split now draws from 13 lopsided objects (frying pan,
  boot, axe, mug, lollipop, rubber duck, hammer, ice cream, watering can, dog, rocket, guitar, whale),
  each shown as drawn and/or turned a quarter — whichever way a middle cut (either side of the middle on
  an odd width) scores **at most 5 of 10**; the symmetric favourites stay Pixel Weight's. No object
  repeats within a round. FFA · drag, or ← → / A D + CUT (ENTER / SPACE) · 20 s (up to 10 objects) ·
  low/medium effort · low latency · banter 💥💥.
- **E12. ✅ Pixel Weight ("guess the weight")** — implemented (`pixel-weight`): a pixel-art object
  flashes briefly, then hides; guess **how many filled pixels** it had — type the number, drag the
  slider, − / +, ← → ±1 or ↑ ↓ ±10 — and press GUESS (ENTER / SPACE). Points scale with
  closeness (`max(0, 10 − |error|)`); several objects. Seeded objects; server owns the counts. Every
  puzzle is a **seeded variant** of its object (`pixelVariant`: up to two inner rows/columns repeated, a
  few edge pixels nibbled off or grown on, mirrored on a coin flip), so a count learnt in one round is
  no use in the next. It weighs the whole shared set (26 objects since the lopsided ones were added for
  Pixel Split on 2026-10-09). *Pixel Balance variant not built.* FFA · type / slider · ~30 s · low effort · low
  latency · banter 💥💥.
- **E13. ✅ Quick Tetris** — a short, fast Tetris sprint (compact variant of **E10**): identical seeded
  piece sequence for all; clear as many lines as possible in a fixed short window (or reach N lines
  fastest). *Implemented (`quick-tetris`): the same shared Tetris engine as Line Clear Sprint (7-bag,
  kicks, ghost + NEXT, a predicted board), tuned to a 45 s window with a race to `TARGET_LINES = 8` —
  finishers ranked by time, others by lines cleared. Here a top-out is final, and the round ends early
  once every board has finished or topped out.* FFA · keys as E10, or the on-screen buttons · ~45 s ·
  high effort · low latency · banter 💥💥.
- **E14. ✅ Sudoku Race** — everyone solves the **same seeded** Sudoku. *Implemented (`sudoku-race`): a
  4×4 grid (2×2 boxes), 8 of 16 cells blank; select a cell (click, or arrows / WASD — the first open
  cell starts selected, and the selection hops on when it locks), then enter a digit from the number
  pad or keys 1–4 (Backspace / Delete / 0 clears). A correct cell locks; a **wrong digit starts a 2 s
  input cooldown** for that player (`cooldownMs` on the wire), so guessing digit after digit is slower
  than solving (2026-09-26 — the old tap-to-cycle input plus the lock made brute-forcing every cell the
  best strategy). Winner is whoever completes it first; if nobody finishes in time, rank by **most
  correct cells placed** (server validates each cell, so a wrong entry never counts). The solved grid comes from a canonical valid
  sudoku via seeded digit relabeling + row/col/band/stack permutations, and the blanks are picked so the
  puzzle has a **unique solution** (a small solution counter rejects any blank that would allow a
  second one) — so the only digit that fits a blank is the solution's and a valid digit is never marked
  wrong. Each player races their own copy under a seeded symmetry (relabelled digits, shuffled
  rows/columns, optional transpose): the same puzzle logically, but a neighbour's screen or a rival's
  board on the room-wide snapshot is no help. The solution never goes on the wire.* FFA · tap cell +
  number pad · ~30 s · medium effort · low latency · banter 💥💥.
- **E15. ✅ Bubble Pop ("Bust-a-Move")** — bubble-shooter puzzle: aim and shoot coloured bubbles upward at a
  hanging cluster; **3+ same-colour bubbles that touch pop**, and any bubbles left unattached drop for a
  bonus. Same **seeded** starting layout + shot-colour queue for everyone, so it's a fair race on an
  identical board; server owns the grid and validates each shot (client can't fake a clear). Ranked:
  full clears first (fastest first), then most bubbles popped. *Implemented (`bubble-pop`): a
  simplified rectangular grid (8×7) with "choose a column" aim stands in for a true hex-grid shooter —
  the pop (4-directional flood fill, 3+ same colour) and floating-bubble-drop rules are the real thing.
  A shot sticks under the lowest bubble in its column (at the ceiling in an empty one); a column filled
  to the bottom row takes no more shots, and once every column is, the board is **JAMMED** — out of
  shots for the round, ranked below a live board on equal points. The round ends early once every
  board is cleared or jammed. The shot rules live in `@pp/shared` (`bubblePop`), so your board is
  predicted: a shot flies, sticks, pops and loads the next colour without waiting for the server.* FFA ·
  aim with the mouse or ← → / A D, fire with a click or SPACE / ENTER / ↑ (drag + release on touch) ·
  ~60 s · medium/high effort · low latency · banter 💥💥.

### E1 (full card). ⭐ ✅ Color Trap ("Stroop") — implemented (`color-trap`)
- **Concept**: a color word (e.g., "RED") is shown in a mismatched ink color (e.g., blue). Tap the
  button matching the **ink color**, not the word it spells. The brain-fight is the joke.
- **Type**: FFA · **Input**: click / tap a color button, or keys 1–4 (the number on its keycap) ·
  **Duration**: ~22 s (12 prompts) · **Banter**: 💥💥💥
- **Rules**: same word/ink sequence for everyone (common seed). Each prompt shows a word + a small set
  of color buttons and takes one answer: the ink color +1, a wrong color **−1** (so blind guessing
  loses on average), a timeout 0. A short per-prompt window (1.8 s) keeps the pressure high; an answer
  still in flight counts for 300 ms after its prompt closes (the client stops taking taps at its own
  zero).
- **Win condition**: most points; ties go to fewer wrong taps, then the faster total response time.
  · **Result**: ranking by points, then care, then speed.
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
scoring lever alone meets the catch-up goal without a bespoke rule change in any of the games. Where a game
is naturally fair to uneven groups by construction (e.g. Tug of War's per-member average, see C1), that
stays as ordinary game design, not a handicap hook.

## F. Sports — track & field and racing (2026-09-28)

Arcade sports classics, reskinned for the party. The four athletics events share one server sprint
model (`athleticsCore`): **alternate LEFT/RIGHT taps to build speed** — the same foot twice adds
nothing, speed bleeds off continuously, and strides faster than 20/s are ignored — so the steady speed
tracks the alternating tap rate (~7 m/s at 6 strides/s, ~9.3 at 10, ~10.8 at 15). Clients dead-reckon
every runner from the snapshot's `x` + `v`, so what a player sees lines up with the server's present
(this matters for jumping a hurdle or taking off at the board), and a stride of your own that the
server's rule will count (`ATHLETICS_STRIDE`, shared) speeds your runner up on the tap. See
`implementation-decisions.md` D20.

### F1. ✅ 100 m Dash — implemented (`dash-100m`)
- **Concept**: Konami *Track & Field* sprint. Everyone side by side in their own lane; "SET…", then the
  gun — alternate the two buttons as fast as you can.
- **Type**: FFA · **Input**: two alternating buttons (◀ L / R ▶, or ← → / A D / Z X) · **Duration**: ~10–20 s
  (30 s cap) · **Banter**: 💥💥💥
- **Rules**: the gun fires at a seeded, unannounced moment 1.6–3.0 s after SET. A stride before it is a
  **false start**: that runner is held in the blocks for 1 s after the gun. Once the first runner
  finishes, the rest get 10 s.
- **Win condition / Result**: fastest race time; unfinished runners by distance (`10.42s` / `87m`).
- **Latency**: medium (tap rate matters, not exact timing). · **Complexity**: medium (shared with F2).

### F2. ✅ 110 m Hurdles — implemented (`hurdles-110m`)
- **Concept**: the dash plus a JUMP button and the regulation layout (first hurdle at 13.72 m, then every
  9.14 m, ten in all).
- **Type**: FFA · **Input**: L/R + JUMP (SPACE / ↑ / W / ENTER) · **Duration**: ~15–25 s (35 s cap) ·
  **Banter**: 💥💥💥
- **Rules**: a jump is airborne for 480 ms (≈4.5 m at a good sprint); strides don't count in the air, but
  there's no drag either — the runner carries their speed through it, so a clean jump costs little.
  A hurdle is cleared only if the runner is airborne at the moment of crossing (server back-dates the
  crossing within the tick); otherwise it is knocked flat and the runner keeps just 15% of their speed.
- **Win condition / Result**: as F1. · **Latency**: medium/high (jump timing; mitigated by dead
  reckoning + an immediately predicted local hop).

### F3. ✅ Long Jump — implemented (`long-jump`)
- **Concept**: sprint down a 30 m runway, **hold JUMP at the board** — the take-off angle climbs while
  held (110°/s, arc gauge with the 45° sweet spot) — and release to fly into the sand.
- **Type**: FFA, everyone takes their own attempts in parallel · **Input**: L/R + hold/release JUMP
  (SPACE / ↑ / W / ENTER; a hold is released if the window loses focus) · **Duration**: 3 attempts,
  ~25–35 s (45 s cap) · **Banter**: 💥💥
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
- **Type**: FFA · **Input**: arrows / WASD (↓ / S or SPACE brakes, then reverses), or hold where you
  want to drive (touch/mouse) · **Duration**: ~40–60 s (90 s cap) · **Banter**: 💥💥💥
- **Rules**: start lights (2.4 s), staggered grid in seeded order. Arcade car physics: slight drift, much
  slower off the road, steering loosens at top speed (brake for hairpins), punchy car-to-car bumps.
  Lap progress only advances near the road you were on; straying for 1.5 s puts you back where you left
  it (no shortcuts). **Slipstream**: tucked in behind a car (≤ 110 units, in its wake, same heading)
  gives +10 % top speed / +15 % acceleration (wind lines) — the way back up from the back of the grid.
  A driver who leaves becomes a ghost (no contact, no slipstream) that no longer holds the race open
  (likewise in F6/F7). Once the first car takes the flag the rest get 12 s.
- **Win condition / Result**: finishers by time (`1:02.3`), the rest by laps + progress (`LAP 2`).
- **Latency**: high (continuous steering) — your own car is predicted with the server's integrator
  (shared in `@pp/shared`), so it turns the frame you press a key; rivals are dead-reckoned to the
  server's present (`raceNet.ts`), so bumps and slipstreams line up with your car.

F6 and F7 run on the same car engine as F5 (`raceCore`: arcade physics, bumps, the slipstream, the
windowed road follower and the stray-car rescue), on courses bigger than a screen — the scene follows your car (a
chase camera) with a minimap of the whole course. Cars carry their driver's lobby avatar.

### F6. ✅ Rally Stage — implemented (`rally-stage`)
- **Concept**: a point-to-point time trial on a twisty stage — two seeded layouts (forest, desert) of
  gravel (loose: grip 4.2, 93 % top speed) and tarmac stretches.
- **Type**: FFA, everyone at once as **ghosts** (no contact) · **Input**: as F5 · **Duration**: ~25–45 s
  (70 s cap; 15 s finish window after the first car) · **Banter**: 💥💥 · **Mobile-friendly**: no
- **Rules**: start lights (everyone side by side, spread across the start line), then race to the stage
  end; three checkpoints pop split times. Off the road the car slows hard; straying from your stretch
  for 1.5 s puts you back on the road.
- **Win condition / Result**: finish time (`0:26.8`), unfinished by distance (`64%`).

### F7. ✅ Speed Circuit — implemented (`speed-circuit`)
- **Concept**: two laps wheel-to-wheel on a proper circuit (grand-prix and night layouts, wide track,
  kerbs and gravel run-off), faster than F5.
- **Type**: FFA · **Input**: as F5 · **Duration**: ~50–65 s (100 s cap; 12 s finish window) ·
  **Banter**: 💥💥💥 · **Mobile-friendly**: no
- **Rules**: staggered grid. **Slipstream**: tucked in behind a car (≤ 140 units, in its wake, same
  heading) gives +10 % top speed / +15 % acceleration (wind lines). **Boost pads** on two straights:
  +25 % top speed and +60 % acceleration for 1.2 s (a flame). Contact is on.
- **Win condition / Result**: finishing order (`0:53.3`), the rest by laps + distance (`LAP 2`).

## G. Elimination rounds — Squid Game-style (2026-10-02)

Short, tense FFA rounds where watching friends get zapped is the show. Mostly ranked by elimination
order (survivors share 1st; Glass Bridge scores ★ instead — see each card); eliminated players stay on screen, dimmed, and keep a way to take part; each
exit is a big moment (`fx.eliminate`: ELIMINATED! stamp, pixel burst, sting). Players are drawn as their
lobby avatar. Original names and art. See `implementation-decisions.md` D22.

### G1. ✅ Glass Bridge — implemented (`glass-bridge`)
- **Concept**: a bridge of rows over an abyss, each with a LEFT and a RIGHT glass panel — one tempered,
  one that shatters. Players cross **one at a time in a seeded vest order** (#1 first); everyone behind
  learns from every fall.
- **Type**: FFA · **Input**: LEFT / RIGHT (← → / A D, the two big buttons, or a tap on the panel) ·
  **Duration**: ~30–60 s (75 s cap) · **Banter**: 💥💥💥 · **Mobile-friendly**: yes
- **Rules**: rows = players + 2 (4–12). Already-solved rows are auto-walked; each unknown row is a 4 s
  jump timer (3.8 s at 10 players, 3.6 at 11, 3.5 at 12, so every vest gets a turn before the buzzer;
  hesitate and you're pushed onto a seeded side). A lightning flash every 3–5.6 s shows a tiny glint on
  the tempered panel of the row being decided (easy to miss). Everyone not jumping — queued, fallen or
  safe — can point LEFT/RIGHT at that row: colored **heckle arrows**, honest or not. Once the whole
  bridge is solved, everyone still queued crosses together; a player who leaves has their turn skipped.
- **Win condition / Result**: **★** — +1 per **blind step** (a row nobody had revealed, jumped without
  having seen its glint ≥ 250 ms earlier) and +1 for crossing; walking solved rows or jumping on a
  glint is safe but earns nothing, so the vest order doesn't decide the ranking. A turn the buzzer cut
  short (still on the bridge or queued) is credited +1, a turn's average worth. Equal ★ share a rank
  (`★3 · 4/10`).
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
  100 ms to 500 ms after she faces the field, from a seeded lane in a seeded direction, wrapping round
  at the edge — so no lane is always judged first or last) and every lane it has reached is watched
  until she looks away. Momentum: releasing WALK slides ~150 ms, RUN (1.6× faster)
  ~400 ms — running pays only if you stop early. Two hearts: the first hit stuns for 1 s and knocks you
  back 15 % of the field (one hit per RED at most), the second eliminates you.
- **Win condition / Result**: finishers by time (`31.2s`), then distance (`64%`), then the eliminated
  (last out first). The round ends once at most one runner is still in the race.
- **Latency**: medium — the 500 ms twitch plus the sweep delay is the reaction window (a balance
  simulation: walkers who react to the twitch are never hit; running until the twitch gets you hit).
  Your runner is predicted with the server's physics (`FREEZE_DOLL`, shared): it sets off and glides to
  a stop the moment you press or let go, easing onto the server's position.

### G3. ✅ Room Rush ("Mingle") — implemented (`room-rush`)
- **Concept**: a top-down arena — a spinning carousel in the middle and ten little rooms around the
  edge, each with a door facing the centre. A number is called; get into a room with exactly that many.
- **Type**: FFA · **Input**: arrows / WASD or hold the pointer where you want to go; SPACE / SHIFT /
  ENTER or DASH to shove · **Duration**: 3–6 calls, ~30–70 s (75 s cap) · **Banter**: 💥💥💥 ·
  **Mobile-friendly**: no
- **Rules**: each call: MUSIC (4–5.6 s, everyone held on the turning carousel, doors shut) → CALL
  (6.5 s, a number N in 1–4 — 2–4 while 10+ survive — N ≤ survivors − 1, and ⌊(survivors − 1) ÷ N⌋
  rooms open — capacity always below the survivors) → buzzer. The moment a room holds N its door slams
  and those inside are safe; anyone arriving in the same instant beyond N is bounced back out the door.
  At the buzzer anyone not in a locked room is ELIMINATED — unless nobody made it in: then nobody is out
  and the call is replayed (no wipeout tie). The final two get one room for one. Sumo-style bouncy bodies, real
  walls (the door is the only way in), a dash (0.85 burst, 1 s cooldown); survivors respawn on a ring
  wide enough that nobody starts overlapping.
- **Win condition / Result**: survivors share 1st; then by the call each player fell in (the same
  call's victims tie). Stat: seconds survived. The round ends when one player is left.
- **Latency**: high (continuous steering + shoving) — snapshot interpolation for every body (one
  snapshot interval, 150 ms, behind); your push arrow and dash ring show the moment you press.

### G4. ✅ Honeycomb Cut (the dalgona candy) — implemented (`honeycomb-cut`)
- **Concept**: everyone gets the same seeded shape (circle, triangle, star or umbrella) pressed into a
  honeycomb candy and carves it out with a needle.
- **Type**: FFA · **Input**: hold the mouse button / a finger and trace the outline (no keyboard path
  by design: tracing is the game) · **Duration**: 45 s cap · **Banter**: 💥💥 · **Mobile-friendly**:
  yes (finger tracing is natural)
- **Rules**: the outline is 160 segments; while the needle is on the line (≤ 0.028 of the candy) the
  segment under it is cut, and so is the stretch since the last sample if they're close along the
  outline (lifting the needle or jumping across cuts nothing in between). Pressing outside the candy
  (on the tin, off the edge) is harmless — the needle isn't in it, as if lifted — and releasing the
  button anywhere, or the window losing focus, lifts it too. Further than 0.055 off the
  line cracks the candy; so does rushing (needle speed over 0.5 candy-widths/s builds stress). A crack
  grants 0.6 s of grace; the third breaks the candy — ELIMINATED. Cut every segment to pop the shape out.
- **Win condition / Result**: finishing time (`12.4s`); then everyone else by the share of the outline
  cut, a broken candy counting half of it (fewer cracks breaks a tie) — a crack costs work, but a
  nearly finished candy that snaps still beats a barely scratched one (`63%`).
- **Latency**: low — the server judges needle samples (sent every 30 ms); the client draws your trail
  at once and a pressure gauge from the same speed rule.

### G5. ✅ Jump Rope — implemented (`jump-rope`)
- **Concept**: everyone in a row while two turners swing a giant rope, faster and faster.
- **Type**: FFA · **Input**: SPACE / ↑ / W / ENTER, a click / tap anywhere (or the JUMP button) ·
  **Duration**: 50 s cap ·
  **Banter**: 💥💥💥 · **Mobile-friendly**: yes
- **Rules**: the rope's whole schedule is fixed at the start: the first pass 2.2 s in, then turns of
  1.5 s, each 3.5 % shorter, down to 0.62 s. A jump lasts 480 ms and clears the rope between 30 and
  450 ms after take-off; no jumping again mid-air. Missing a pass trips you (one of 2 hearts); the
  second miss sweeps you off — ELIMINATED.
- **Win condition / Result**: last one standing (survivors at the bell share 1st); the rest by passes
  cleared (`23`).
- **Latency**: low/medium — passes are judged at their scheduled instant against the server's jump
  time; your own jump animates the moment you press.

### G6. ✅ Marbles Duel (odd or even) — implemented (`marbles-duel`)
- **Concept**: the marbles game as a quick 1v1 bluffing duel.
- **Type**: Duel (seeded simultaneous pairs; an odd player out gets a bye, see §B) · **Input**: − / + to
  pick a number (or type it: 1–9, 0 = 10, two quick digits for more; ← → ↑ ↓ / A D W S nudge it), then
  HIDE (SPACE / ENTER) — or ODD (O / N) / EVEN (E / P), both languages' initials · **Duration**: 50 s
  cap · **Banter**: 💥💥 · **Mobile-friendly**: yes
- **Rules**: 10 marbles each. Every turn one player hides 1…all of theirs in a fist while the other
  bets 1…all of theirs and calls odd or even — both at once (6 s; a timeout plays a seeded pick, bet 1).
  Right call: the guesser takes the bet from the hider; wrong: the guesser pays it (capped by what the
  loser holds). Roles swap every turn. The number hidden is never on the wire before the reveal.
- **Win condition / Result**: take all their marbles; at the bell, more marbles wins (equal = draw).
  Ranked in the duel tiers — wins, then draws and the bye, then losses — each by marbles held (the bye
  counts as 10) (`18`).

## I. Arcade classics, party-sized (2026-10-02)

Real-time FFA reworks of arcade classics, keyboard-first (PC). Players are drawn as their lobby
avatar. See `implementation-decisions.md` D22.

### I1. ✅ Sumo ICE — implemented (`sumo-ice`)
- **Concept**: Sumo Push on an ice floe that melts — a battle royale where the ring shrinks under you.
- **Type**: FFA · **Input**: arrows / WASD or hold the pointer where you want to go · **Duration**:
  ~20–45 s (45 s cap) · **Banter**: 💥💥💥 · **Mobile-friendly**: no (continuous steering, like B3)
- **Rules**: a 13×13 floe of ice tiles inside a circle. Nothing melts for 6 s; then a seeded order eats
  it edge-first but irregularly (a jitter of ~28 % of the radius punches holes), each tile cracking for
  1.5 s before it sinks; only the never-melting core is left for the last 8 s — 3×3 tiles, or 13 (one
  more on each side) with 10+ players. Ice physics: weak grip (accel 1.1), little friction (0.55/s, vs
  2.0 on the dohyo) and bouncier shoves. A body over open water falls in — the first time a
  **lifebuoy** fishes it back onto the core, on the clearest of 8 spots around the centre (never on top
  of someone; 1.2 s as a ghost, no collisions), the second time it's out.
- **Win condition / Result**: last one standing; the rest by survival time (`21s`); among equal times
  (still in at the buzzer) an unused lifebuoy ranks first.
- **Latency**: high (continuous steering) — snapshot interpolation for every body (one snapshot
  interval, 150 ms, behind); a small arrow at your feet shows your push the moment you press.

### I2. ✅ Pang — implemented (`pang`)
- **Concept**: *Buster Bros* — walk along the floor and fire a harpoon straight up; a hit splits a
  balloon into two smaller ones until the tiniest just pops.
- **Type**: FFA, everyone in their own arena with the **same seeded waves** (a fair race) · **Input**:
  ← → / A D to walk, SPACE / ↑ (also W / Z / J / ENTER) to fire, or ◀ FIRE ▶ buttons · **Duration**:
  50 s · **Banter**: 💥💥 · **Mobile-friendly**: no
- **Rules**: four balloon sizes, each bouncing back to its own fixed height (bigger = higher); one
  harpoon at a time, fired from where you stand (the wire pops the first balloon it touches); a fire
  pressed up to 150 ms before the flying one is done fires the moment it is. Clear a
  wave and the next, bigger one drops in 1.2 s later. A balloon touching you costs one of 3 lives
  (1.5 s of blinking invulnerability follows); out of lives, you're out.
- **Win condition / Result**: most pops (`23`), then lives left, then whoever got there first.
- **Latency**: medium — the client runs the same balloon physics between snapshots (`PANG` constants
  are shared), predicts you (you walk and your harpoon leaves the moment you press, easing onto the
  server's position), and on wide screens shows everyone else's arena as a live thumbnail.

### I3. ✅ Star Blaster (vertical shmup) — implemented (`star-blaster`)
- **Concept**: a vertically scrolling shooter in your own viewport — everyone faces the **same seeded
  attack script**: drone formations, gunners that hover and spray rings/fans, a boss for the last
  ~16 s. The ship (your color, your avatar in the cockpit) fires on its own from your first steer on
  ("MOVE TO OPEN FIRE!" — an idle seat never fires or scores); you steer to aim and dodge.
- **Type**: FFA · **Input**: arrows / WASD (8-way, full speed) or hold the pointer where you want the
  ship (it eases onto the spot) · **Duration**: 50 s · **Banter**: 💥💥 · **Mobile-friendly**: no
- **Rules**: drones (1 HP, 10 pts) swoop down and veer off before the ship's zone; gunners (5 HP,
  50 pts); the boss (60 HP, 400 pts). A bullet or a ram costs one of 3 lives and 25 points, then 2 s of
  blinking; a rammed drone is destroyed (no points). Out of lives, you're out. Bullet-hell hitbox (the
  ship's sprite is bigger than its 0.018 hit radius).
- **Win condition / Result**: highest score (`640`), then lives left.
- **Latency**: medium — enemies and bullet patterns are a pure function of (seed, time) evaluated on
  both sides (the client at the server's present, `ServerClock`); your ship is predicted (it moves the
  frame you press, snapshots only nudge it back in line); tuned with simulated pilots (an idle ship
  loses ~1 life per round, a dodging one ~0.1 and scores ~2.3× more).

### I4. ✅ Asteroids Arena (competitive Asteroids) — implemented (`asteroids`)
- **Concept**: classic *Asteroids*, but everyone shares one wrapping sky — rocks to break and rivals
  to shoot.
- **Type**: FFA · **Input**: ← → / A D turn, ↑ / W thrust, SPACE / Z / J / ENTER fire (hold for
  auto-fire), or ◀ ▶ THRUST FIRE hold buttons · **Duration**: 60 s · **Banter**: 💥💥💥 ·
  **Mobile-friendly**: no
- **Rules**: inertia ships (thrust 0.95, light drag, 0.75 top speed), a gun with a 220 ms cadence and
  4 bullets in flight. Rocks split big → medium → small → gone and pay 20 / 50 / 100; a rival ship pays
  250. A rock or a rival's bullet blows you up — back in 2 s at the safest of a few seeded spots, with
  2 s of shield. The field is topped up with big rocks (away from ships) whenever it thins out; the
  supply is tuned for 4 pilots and scales with a bigger field (start rocks and the mass floor ×√(N/4),
  refills N/4 times as often), so rocks per pilot hold. A ship whose pilot hasn't touched the controls
  yet is a parked ghost — bullets and rocks pass through it (no free kill) — and gets a fresh shield
  when they do. A pilot who leaves takes the ship out of the sky; its score stands.
- **Win condition / Result**: highest score (`1830`), then kills.
- **Latency**: high — ships, rocks and bullets are extrapolated from the snapshot's velocities; your own
  ship (turn, thrust, drift) is predicted with the server's flight step (`asteroidsFly`, shared), easing
  onto the server's view (a respawn snaps), and the gun flashes the moment it fires. Ships are their
  pilot's lobby avatar, turned to the heading.

### I5. ✅ Bomber Express (Bomberman) — implemented (`bomber-express`)
- **Concept**: classic *Bomberman*, but everyone starts **fully powered** — fire range 5, five bombs,
  fast boots — so it's chaos from the first second.
- **Type**: FFA · **Input**: arrows / WASD (or the d-pad) to walk, SPACE / ENTER / Z / J or BOMB to
  drop one · **Duration**: ~15–60 s (60 s cap) · **Banter**: 💥💥💥 · **Mobile-friendly**: no
- **Rules**: a 17×13 grid — border walls, a pillar on every even/even cell, a seeded 60 % scatter of
  crates (each spawn cell and its neighbours kept clear; up to 12 spawn cells, dealt to the players
  with the round's seed, not by join order). Tile-to-tile movement
  (150 ms per tile at the start); a step starts the moment the key goes down, and turns are forgiving:
  press the new way a little early (still holding the old one) and you keep going until the next
  opening, then turn, instead of stopping dead (`bomberStepDir`: the held direction, else the one held
  before it). Bombs blow after 2.2 s in a cross that stops at walls and at the first
  crate (which it breaks), setting off any bomb in its path (chain reactions); flames burn 0.55 s. A
  third of the crates hide a power-up: +fire (to 9), +bomb (to 8), faster boots. Bombs block the way.
- **Win condition / Result**: last one standing; then knock-outs scored (a self-KO scores nothing),
  then who lasted longer, then crates broken (which also splits survivors at the buzzer) (`2 KO`). A
  player who leaves is out on the spot, with no KO credited to anyone.
- **Latency**: medium — your own steps are predicted with the server's walk rule (`bomberStepDir`,
  shared) and eased back if the server disagrees; everyone else walks the tiles the snapshots reported,
  120 ms in the past (no stutter); your bomb shows the instant you drop it.

### I6. ✅ Street Brawl (Streets of Rage) — implemented (`brawl`)
- **Concept**: a competitive side-view beat 'em up — everyone in one street, fighting everyone.
- **Type**: FFA · **Input**: arrows / WASD to move along and across the street; SPACE / J / Z / ENTER
  punch, K / X kick, L / C grab (or the d-pad and three buttons) · **Duration**: ~30–75 s (75 s cap) ·
  **Banter**: 💥💥💥 · **Mobile-friendly**: no
- **Rules**: 100 HP. Attacks land in front, on about the same lane (±0.05 of depth); turning is instant
  (← then PUNCH swings left, even before a tick has moved you). Punch 8 (quick;
  the third in a row within 0.65 s is a 14-damage knock-down), kick 12 (longer, shoves), grab: throw
  whoever is right next to you (16, knock-down, tossed 0.25 away). Knocked down = untouchable for
  0.9 s, then 0.6 s of guard. Items drop on a seeded schedule (max 4 on the street; odds pipe 22 %,
  bat 14 %, bottle 18 %, fuel can 14 %, chicken 32 %). Walk over a weapon to pick it up; **PUNCH uses
  it** (kick and grab stay bare-handed, and the PUNCH button turns into the weapon: `BAT ×4`, `THROW!`):
  a pipe (14 damage, longer reach, 6 swings), a baseball bat (18 damage, longest reach, every swing a
  knock-down that sends them flying, 4 swings), a bottle (one 22-damage knock-down, then it smashes), a
  fuel can (thrown down the street: it blows up on the first standing fighter in its path on about its
  lane, or where it lands 0.75 away; everyone in the blast but the thrower takes 26, is floored and
  blown clear, and any fuel can lying in the blast goes up too). Roast chicken: +30 HP. A swing that
  misses costs nothing. Knocked down while armed, you drop it. 0 HP = K.O. for good. Spawn spots are evenly spaced and dealt
  in a seeded order (nobody owns the safer end seats by joining first); a fighter who leaves is out,
  crediting nobody.
- **Win condition / Result**: last one standing; then K.O. credit — the finisher takes half of each
  K.O., the other half is split by the damage everyone (finisher included) dealt that fighter, so
  softening someone up counts; then HP left / time lasted (`1.5 KO`).
- **Latency**: medium — attacks resolve on the server as they arrive. Your own fighter is predicted: it
  walks, turns and swings the moment you press (with the shared `BRAWL.moves` timings, so a press the
  server will refuse never swings), easing onto the server's position; the others are eased and
  dead-reckoned. A held weapon is drawn in the hand and swung through the punch (the fist only shows
  bare-handed); weapon hits pop their own word (`CLANG!`, `HOME RUN!`, `SMASH!`), thrown cans fly on
  between snapshots at the shared speed, and each explosion (on the wire for 0.6 s) shows once.

---

## J. Party trivia (2026-10-03)

### J1. ✅ Weird Trivia — implemented (`weird-trivia`)
- **Concept**: a fast quiz of strange-but-true facts instead of general knowledge (wombats poop cubes,
  the chainsaw was invented for childbirth, the Pringles inventor was buried in a can). The laugh is
  the "no way that's true!" moment at the reveal.
- **Type**: FFA · **Input**: click / tap one of four answers (A–D or 1–4) · **Duration**: 50 s (5 questions) ·
  **Banter**: 💥💥💥 · **Mobile-friendly**: yes
- **Rules**: the Lightning Quiz phases and scoring (`quizCore`: a right answer = 1000 + a speed bonus of
  up to 1000; wrong or no answer = 0). Each question has a 6 s answer window, which closes early once
  everybody still in the round has locked in. Then a 4 s reveal: the right tile lights up, every player's avatar pops onto the tile they picked
  (grinning or wincing), the board shows a one-line fun fact and the room gets a quip ("NOBODY KNEW!",
  "3 FELL FOR IT!"). Points are banked at the reveal, so locking in gives nothing away.
- **The bank**: 63 facts, server-side (`weirdTriviaBank.ts`), each written natively in EN and ES (own
  phrasing and jokes; a wordplay question may ask a different thing per language). Every right answer
  is real and verifiable; the decoys are absurd-but-plausible. A question ships its text in both
  languages and the client shows the player's; the right slot and the fact stay off the wire until the
  reveal. Tests enforce the budgets (a choice ≤ 24 chars, a fact ≤ 120).
- **Win condition / Result**: most points (`3/5 · 4210 pts`).
- **Latency**: low. · **Complexity**: low (the Lightning Quiz board, `QuizSceneBase`, is shared).

---

## Variety coverage

| Axis | Covered by |
|------|------------|
| Reflexes / reaction | A1, A6, B1, E7, F5, F7, G2, G5, I3 |
| Attention / focus (inhibition) | E1, E3, E4, G1 |
| Speed / endurance | A2, A9, C1, F1, F2, G3 |
| Knowledge | A3, J1 |
| Mental math | E2 |
| Memory | A4, A11, E8 |
| Precision / aim / timing | A5, A10, B2, E6, F2, F3, F4, F6, G4, I2 |
| Survival / dodging | A7, A8, B3, I1, I3, I5 |
| Nerve / chance | D1, D3, E5, G1, G2, G3, G6 |
| Teamwork | C1, C2, C3 |
| Head-to-head rivalry | B1, B2, B3, E7, I4, I6 |

## Format mix

| Format | Mini-games |
|--------|-----------|
| Individual (FFA) | A1–A11, D1–D3, E1–E6, E8–E10, F1–F7, G1–G5, I1–I6, J1 |
| Duel (1v1 / bracket) | B1, B2, B3, E7, G6 |
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

- **Simple inputs, PC-first** (D21, D30): every action has a key (movement takes arrows *and* WASD) and
  works with the mouse; touch controls must still work at phone sizes (mobile portrait).
- **Determinism with a common seed**: for "same board for everyone" games, the server emits a seed and
  validates the final result — never trust the client.
- **Rules explainable in 1 screen**: understandable from the intro, no long tutorial.
- **Accessibility**: don't rely on color alone (add shapes/symbols in Simon, Trivia, etc.).
- **Banter surface**: expose live standings, near-misses, and reaction moments (last-second overtakes,
  balloon bursts, sudden-death) — these are what make the group laugh.
