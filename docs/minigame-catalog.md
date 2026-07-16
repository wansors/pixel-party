# Mini-game catalog — Pixel Party

- **Version**: 0.2 (draft)
- **Date**: 2026-07-16

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

⭐ marks the recommended **MVP** candidates for their balance of fun, latency tolerance, and dev cost.

---

## A. Individual — Free-for-all

### A1. ⭐ Quick reaction ("Go!")
- **Concept**: the screen is red; at a random moment it turns green. First to tap wins. Tapping early is
  penalized.
- **Type**: FFA · **Input**: tap · **Duration**: 15–30 s (several rounds) · **Banter**: 💥💥
- **Rules**: 3 rounds. After a random delay (2–6 s) the screen turns green; reaction time is measured.
  Jumping the gun = disqualified that round.
- **Win condition**: lowest accumulated reaction time. · **Result**: ranking by total time (lower wins).
- **Latency**: low (timestamp vs. server clock). · **Complexity**: low.

### A2. ⭐ Frantic tap ("Button masher")
- **Concept**: tap as many times as you can in a fixed time.
- **Type**: FFA · **Input**: repeated tap · **Duration**: 10 s · **Banter**: 💥💥
- **Rules**: 10 s of free tapping; valid taps counted (server rate-limit anti-macro).
- **Win condition**: highest tap count. · **Result**: ranking by count (higher wins).
- **Latency**: low (aggregate count sent). · **Complexity**: low.

### A3. ⭐ Lightning quiz ("Trivia")
- **Concept**: multiple-choice questions; rewards correctness and speed.
- **Type**: FFA · **Input**: tap on option · **Duration**: 45–60 s (5–8 questions) · **Banter**: 💥💥
- **Rules**: per-question time limit (~8 s). Points for correct answer + speed bonus.
- **Win condition**: highest total score. · **Result**: ranking by points.
- **Latency**: low. · **Complexity**: medium (question bank + i18n).

### A4. ⭐ Sequence memory ("Simon")
- **Concept**: repeat a growing sequence of colors/sounds.
- **Type**: FFA · **Input**: tap · **Duration**: up to ~60 s · **Banter**: 💥
- **Rules**: everyone sees the same growing sequence; a mistake eliminates you; furthest survives.
- **Win condition**: longest sequence reached (tiebreak by time). · **Result**: ranking by level.
- **Latency**: low. · **Complexity**: low/medium.

### A5. Pixel Hoops ("Basketball")
- **Concept**: arcade free-throw shooting — swipe/tap to set power and angle and sink as many baskets as
  possible; the hoop moves as it heats up.
- **Type**: FFA · **Input**: drag (aim + power) · **Duration**: 30 s · **Banter**: 💥💥💥
- **Rules**: same hoop pattern for everyone. Score per basket; consecutive baskets build a combo.
- **Win condition**: most points. · **Result**: ranking by baskets/combo.
- **Latency**: low/medium (client sim, server validates final score). · **Complexity**: medium.

### A6. Bug smash ("Whack-a-mole")
- **Concept**: pixel bugs pop out of holes; smash them before they hide. Some bugs penalize.
- **Type**: FFA · **Input**: tap · **Duration**: 30 s · **Banter**: 💥💥
- **Rules**: identical spawn sequence (common seed). Good bugs +, bomb bugs −.
- **Win condition**: highest score. · **Result**: ranking by score.
- **Latency**: low. · **Complexity**: low/medium.

### A7. Pixel rain ("Dodge")
- **Concept**: move an avatar to dodge falling objects; survive as long as possible.
- **Type**: FFA (own board, same seed) · **Input**: drag/keyboard · **Duration**: up to ~45 s · **Banter**: 💥💥
- **Rules**: identical obstacle pattern (same seed); eliminated on collision.
- **Win condition**: longest survival. · **Result**: ranking by time.
- **Latency**: medium (client sim, server validates final time). · **Complexity**: medium.

### A8. Snake Arena
- **Concept**: classic snake — grow by eating pixels, don't crash into walls or your own tail.
- **Type**: FFA (own board, same food seed) · **Input**: swipe/keyboard · **Duration**: up to ~60 s · **Banter**: 💥💥
- **Rules**: same food layout for everyone; crashing eliminates you.
- **Win condition**: longest snake / longest survival. · **Result**: ranking by length.
- **Latency**: medium. · **Complexity**: medium.

### A9. Pixel Dash ("Platform race")
- **Concept**: short auto-runner/obstacle sprint; first to the flag wins.
- **Type**: FFA (own track, identical layout) · **Input**: tap to jump · **Duration**: up to ~40 s · **Banter**: 💥💥💥
- **Rules**: identical track; mistakes cost time, not lives.
- **Win condition**: fastest finish. · **Result**: ranking by finish time.
- **Latency**: medium (client sim + server validation). · **Complexity**: medium/high.

### A10. Stop the clock ("Timing")
- **Concept**: a fast-moving bar/needle; stop it as close to the target as possible.
- **Type**: FFA · **Input**: tap · **Duration**: 20–30 s (3 attempts) · **Banter**: 💥💥
- **Rules**: 3 attempts; summed distance to target. Lower = better.
- **Win condition**: lowest accumulated error. · **Result**: ranking by error.
- **Latency**: low. · **Complexity**: low.

### A11. Speed puzzle ("Match")
- **Concept**: memory/card game — uncover matching pairs fastest / with fewest attempts.
- **Type**: FFA (own board, same layout) · **Input**: tap · **Duration**: up to ~60 s · **Banter**: 💥
- **Rules**: identical board; win by matching everything first / fewest misses.
- **Win condition**: first to complete (tiebreak by attempts). · **Result**: ranking by time/attempts.
- **Latency**: low. · **Complexity**: medium.

---

## B. Duels — 1v1 / bracket

> Players are paired into 1v1 matches; winners advance in a bracket, or all pairs play simultaneously and
> results feed the round ranking. Great for building rivalries.

### B1. Pixel Pong
- **Concept**: classic pong, 1v1. First to N points.
- **Type**: Duel (bracket) · **Input**: drag paddle · **Duration**: ~30–45 s per match · **Banter**: 💥💥💥
- **Rules**: standard pong; ball speeds up over time.
- **Win condition**: first to N points. · **Result**: bracket standing → round ranking.
- **Latency**: high (real-time 1v1; needs interpolation/prediction). · **Complexity**: high.

### B2. Sink the Fleet ("Battleship")
- **Concept**: classic battleship — place your fleet, then take turns firing at the opponent's grid.
- **Type**: Duel (1v1, can pair many simultaneously) · **Input**: tap grid cell · **Duration**: ~60–90 s · **Banter**: 💥💥💥
- **Rules**: quick placement phase (auto-place option), then alternating shots with a turn timer.
- **Win condition**: sink the enemy fleet first. · **Result**: win/loss → round ranking.
- **Latency**: low (turn-based). · **Complexity**: medium.

### B3. Sumo Push
- **Concept**: two pixel sumos in a ring; shove the opponent out with timed pushes.
- **Type**: Duel (1v1) or FFA arena (up to 10 in one ring) · **Input**: tap/direction · **Duration**: ~30 s · **Banter**: 💥💥💥
- **Rules**: physics shove; last one in the ring wins. FFA variant = battle royale.
- **Win condition**: last standing / longest in-ring. · **Result**: ranking by survival.
- **Latency**: high (FFA arena) / medium (1v1). · **Complexity**: high.

---

## C. Team-based

> Players are split into teams (e.g., 2 teams of up to 5). Team result awards points to all members.
> Requires ≥ 4 players; team assignment can be random or host-set.

### C1. Tug of War
- **Concept**: two teams button-mash to drag the pixel rope to their side.
- **Type**: Team · **Input**: repeated tap · **Duration**: ~20–30 s · **Banter**: 💥💥💥
- **Rules**: aggregated team tap rate moves the rope; handicap can weight smaller teams.
- **Win condition**: pull the marker past your line. · **Result**: winning team ranks above.
- **Latency**: low (aggregate rates). · **Complexity**: low/medium.

### C2. Bomb Relay ("Hot potato")
- **Concept**: a lit pixel bomb is passed around the team; solve a quick micro-task to pass it on before
  it explodes. It blows up in whoever holds it.
- **Type**: Team (or FFA circle) · **Input**: tap/mini-task · **Duration**: ~30–45 s · **Banter**: 💥💥💥
- **Rules**: hold time ticks down; pass by completing the micro-task. Fewer explosions = better.
- **Win condition**: team with fewest explosions. · **Result**: team ranking.
- **Latency**: medium. · **Complexity**: medium.

### C3. Fleet Battle (team variant of Sink the Fleet)
- **Concept**: two teams share a grid; members coordinate shots against the enemy fleet.
- **Type**: Team · **Input**: tap grid · **Duration**: ~90 s · **Banter**: 💥💥
- **Rules**: shared shot budget per turn; teamwork to triangulate.
- **Win condition**: sink the enemy fleet first. · **Result**: team ranking.
- **Latency**: low (turn-based). · **Complexity**: medium.

---

## D. Chaos / party (banter-first)

### D1. Balloon Chicken ("Nerve")
- **Concept**: pump a pixel balloon for points — but it bursts at a random threshold. Cash out before it
  pops or lose it all. Pure nerve, maximum trash talk.
- **Type**: FFA · **Input**: tap to pump, tap to cash out · **Duration**: ~20 s · **Banter**: 💥💥💥
- **Rules**: each pump adds points; a hidden (server-side) threshold bursts it → 0 for that player.
- **Win condition**: highest banked points. · **Result**: ranking by banked points.
- **Latency**: low (server owns the threshold). · **Complexity**: low.

### D2. Fruit Catch
- **Concept**: catch falling fruit in a basket; avoid the bombs.
- **Type**: FFA (same seed) · **Input**: drag · **Duration**: 30 s · **Banter**: 💥💥
- **Rules**: identical drop pattern; fruit +, bombs reset combo.
- **Win condition**: highest score. · **Result**: ranking by score.
- **Latency**: low/medium. · **Complexity**: low/medium.

### D3. Pixel Roulette ("Luck")
- **Concept**: pure chance to shake up standings (Mario Party style).
- **Type**: FFA · **Input**: tap to spin · **Duration**: 15 s · **Banter**: 💥💥
- **Rules**: each player spins; random result (server-validated).
- **Win condition**: highest value. · **Result**: ranking by value.
- **Latency**: low. · **Complexity**: low. *(Use sparingly.)*

---

## H. Handicap / catch-up (per mini-game hooks)

To keep sessions competitive and full of comebacks, mini-games can expose optional **handicap hooks**
that the engine tunes based on the current session standings (see `scoring-system.md` §catch-up):

- **Leader nerf**: session leaders get a slight disadvantage (smaller paddle in Pong, faster obstacles
  in Pixel Dash, higher burst odds in Balloon Chicken).
- **Trailer boost**: players at the bottom get a small edge (larger catch basket, extra reaction margin,
  bonus multiplier).
- **Team weighting**: in team games, the smaller or trailing team gets a proportional boost.
- **Always optional and bounded**: handicap is configurable per session and capped so it never fully
  decides the outcome — it narrows gaps, it doesn't hand out wins.

---

## Variety coverage

| Axis | Covered by |
|------|------------|
| Reflexes / reaction | A1, A6, B1 |
| Speed / endurance | A2, A9, C1 |
| Knowledge | A3 |
| Memory | A4, A11 |
| Precision / aim / timing | A5, A10, B2 |
| Survival / dodging | A7, A8, B3 |
| Nerve / chance | D1, D3 |
| Teamwork | C1, C2, C3 |
| Head-to-head rivalry | B1, B2, B3 |

## Format mix

| Format | Mini-games |
|--------|-----------|
| Individual (FFA) | A1–A11, D1–D3 |
| Duel (1v1 / bracket) | B1, B2, B3 |
| Team | C1, C2, C3 |

## Suggested MVP selection

Start with latency-tolerant, low/medium-complexity games that still cover the three formats and set the
competitive tone:
- **Individual**: A1 Quick reaction, A2 Button masher, A3 Trivia, A4 Simon, D1 Balloon Chicken.
- **Team**: C1 Tug of War (simple, high banter, low latency).
- **Duel**: B2 Sink the Fleet (turn-based, low latency — validates the bracket flow without real-time
  netcode).

Defer real-time-netcode-heavy games (B1 Pong, B3 Sumo, A9 Pixel Dash) until the engine and sync layer
are proven.

## Cross-cutting design considerations

- **Simple, responsive-first inputs**: prioritize tap/drag; must work on mobile portrait.
- **Determinism with a common seed**: for "same board for everyone" games, the server emits a seed and
  validates the final result — never trust the client.
- **Rules explainable in 1 screen**: understandable from the intro, no long tutorial.
- **Accessibility**: don't rely on color alone (add shapes/symbols in Simon, Trivia, etc.).
- **Banter surface**: expose live standings, near-misses, and reaction moments (last-second overtakes,
  balloon bursts, sudden-death) — these are what make the group laugh.
