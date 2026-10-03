# Player-fit & balance audit — Pixel Party

- **Date**: 2026-10-03. **Decision**: D27 (`implementation-decisions.md`).
- **Scope**: all 55 mini-games, one by one. For each, the server module, its client scene and the
  shared wire types were read. Each game was also simulated headless with the seeded `Random` at 1,
  2, 8 and 12 players (2,000+ seeded runs in total), with bots and with one idle seat standing in for
  a disconnected player.
- **Outcome**: every game declares the headcounts it supports in `MINIGAMES[].players`. The lobby only
  offers the ones that fit the room, and the engine skips the rest. Nothing crashed at any headcount.
- **Status — all findings fixed (same day)**. The cross-cutting ones were fixed once, in the engine and
  shared services (D28); the per-game ones are listed in D29. `minigame-catalog.md` describes the
  current rules.

  The tables below are the audit **as found**, kept as the record of why each fix was made. The
  ranges are the current ones: Glass Bridge, Bomber Express and Sumo Push now take 2–12 players, and
  Micro Race and Sumo ICE are recommended up to 10.

## How to read the ranges

- **min / max** are hard limits. Outside them a game is greyed out in the lobby ("Needs 4-12
  players"), can't be picked, and sits the session out if the headcount changes after it was picked.
  - `min` is 1 only when a game is meaningful solo (score attacks, time trials).
  - Last-standing, head-to-head, duel and relay games need 2 or more.
  - `max` is 12 (the room ceiling) unless spawns or turn time really break.
- **best** is the recommended range. The card shows it, in green when the room is inside it, and the
  lobby's **"Best for N"** filter narrows the grid to it.
- **Balance**:
  - **OK**: fair and skill-driven.
  - **minor**: a nit or an edge case.
  - **real**: a dominant strategy, luck or a rule decides results; fix it before relying on the game.

## Per-game table

### Quiz, reflex & tap games

| Game | min–max | best | Balance | Key findings |
|---|---|---|---|---|
| `reaction-duel` | 2–12 | 3–8 | minor | The measured time includes network round-trip (≈ the winning margin on wifi). The results board caps at 8 rows. |
| `button-masher` | 1–12 | 2–8 | minor | Lanes cap at 6 (the top 6). No server-side rate cap; 3-finger touch beats one key. |
| `color-trap` | 1–12 | 3–12 | minor | **Bug**: a late tap shows +1 on the client but the server drops it. Wrong taps are free (blind guess = 25 %). |
| `trivia` | 1–12 | 3–12 | OK | Contestant lights cap at 6 (players 7+ never shown). No early close per question; the right answer is never revealed. |
| `weird-trivia` | 1–12 | 3–12 | OK | Same 6-light cap. A disconnected seat blocks the early reveal. |
| `balloon-chicken` | 2–12 | 3–8 | **real** | Burst thresholds differ per player (5–24 pumps), so luck decides. Auto-banking at the buzzer makes cashing out pointless. Rivals' counts are visible. |
| `number-rush` | 1–12 | 2–8 | OK | The strip shows the top 6 only, which can hide you. |
| `quick-math` | 1–12 | 2–10 | minor | The right answer is the 2nd or 3rd smallest choice 86 % of the time, so "pick a middle one" scores 43 % blind. |
| `odd-one-out` | 1–12 | 2–10 | OK | Wrong taps are free, so spamming is viable on later levels. Strip shows the top 6. |
| `higher-lower` | 1–12 | 2–8 | **real** | A miss keeps your streak, so speed decides, not nerve. The shared deck leaks your next card (a rival's current one) on the wire. An idle seat keeps the round alive. |
| `bug-smash` | 1–12 | 2–10 | OK | Bombs cost nothing at score 0. No domain test. |
| `stop-clock` | 1–12 | 2–8 | OK | **Bug**: the result stat shows the raw error without the miss penalty (an idle player shows "0.00 off"). |
| `memory-flash` | 1–12 | 2–8 | minor | The tiebreak time also moves on wrong answers. Idle-wins-tiebreak bug (see cross-cutting). |
| `simon` | 1–12 | 2–8 | **real** | 30 s in the catalog vs 60 s in the module: about 7 levels max, so timing decides. **Bug**: at the same level, dying sooner ranks higher. The sequence leaks on the wire. |
| `pixel-hoops` | 1–12 | 2–8 | OK | Player strip cramped at 12. No domain test. |
| `pixel-weight` | 1–12 | 2–8 | **real** | Only 9 objects with fixed counts, and the answer is shown, so they are memorisable (80/80). |
| `pixel-split` | 1–12 | 2–8 | minor | Near all-or-nothing scoring (one column off ≈ 0), so speed decides among accurate players. |
| `match-pairs` | 1–12 | 2–10 | minor | Identical layouts, so peeking at a neighbour pays. Other players' reveals expose your cards on the wire. |
| `pixel-roulette` | 2–12 | 4–12 | minor | Pure luck at full stakes, and it feeds the "nerve" radar axis. |
| `sudoku-race` | 1–12 | 2–10 | **real** | **Bug**: 31 % of puzzles have more than one solution, so a valid digit is marked wrong and costs a 2 s cooldown. Boards leak on the wire. |
| `pixel-beat` | 1–12 | 2–12 | OK | Spamming doesn't pay. Round-trip offset vs the ±90 ms PERFECT window. |
| `honeycomb-cut` | 1–12 | 2–10 | **real** | **Bug**: a crack ranks below any unbroken player, so a 93 % carve loses to a 1-segment carve and doing nothing is optimal. |

### Team & duel games

| Game | min–max | best | Balance | Key findings |
|---|---|---|---|---|
| `tug-of-war` | 2–12 | 4–10 | minor | The pull is averaged per member, so uneven teams stay fair. **Bug**: a disconnected teammate still counts in the average. The plates show raw totals. |
| `bomb-relay` | 4–12 | 4–8 | minor | Needs 2+ per team to relay. **Bug**: the bomb parks on a disconnected holder until it blows. |
| `fleet-battle` | 4–12 | 4–8 | minor | Red always fires first (53–60 % win) and gets the extra member. The first click spends the team's turn, so big teams are passengers. |
| `sink-the-fleet` | 2–12 | 2–8 | **real** | 30 s in the catalog vs 60 s in the module: 73–99 % of duels end on the timer, about 21 % draws, and draws score like wins. |
| `pixel-pong` | 2–12 | 2–8 | minor | Only 24–35 % of duels reach 5 points in 30 s, and draws score like wins. |
| `quick-draw` | 2–12 | 2–8 | minor | **Bug**: two idle duellists "draw" and score like winners. One tap decides the round. |
| `marbles-duel` | 2–12 | 2–8 | minor | Bluff and luck by design. The bye waits 50 s idle. |

### Real-time arcade

| Game | min–max | best | Balance | Key findings |
|---|---|---|---|---|
| `fruit-catch` | 1–12 | 2–10 | OK | An idle basket still scores 7–8 points. No tiebreak. |
| `pixel-rain` | 1–12 | 3–10 | **real** | Blocks never spawn at the edges, so camping a wall survives about 3× longer. Pointer drag teleports. No difficulty ramp. |
| `pixel-dash` | 1–12 | 2–8 | **real** | Mashing jump clears everything (stumbles only break ties). |
| `snake-arena` | 1–12 | 2–10 | minor | **Bug**: two quick turns in one step drop one. Boards are independent (the blurb says "arena"). |
| `sumo-push` | 2–12 | 4–8 | **real** | Equal masses, so a centre-holder can't be pushed out and 2-player rounds always draw. Solo ends instantly. |
| `maze-sprint` | 1–12 | 2–8 | minor | Rival tokens reveal the path. Speed follows the OS key-repeat rate. Rivals stack in 4 corner slots. |
| `line-clear-sprint` | 1–12 | 2–10 | OK | **Bug**: the round never ends when every board has topped out. Rival list caps at 9. |
| `quick-tetris` | 1–12 | 2–8 | OK | **Bug**: a topped-out player never "finishes", so the round always runs the full 45 s. Rival list caps at 9. |
| `bubble-pop` | 1–12 | 2–10 | minor | **Bugs**: a jammed board softlocks (35 of 200 boards), and shots pass through bubbles. Full clears are rare. |
| `glass-bridge` | 2–12 | 4–8 | **real** | Vest order decides the ranking, and waiting for the glint is dominant. **Bug**: players still queued at timeout rank with the fallen. At 11–12, someone may never get a turn (it was capped at 10 until fixed). |
| `freeze-doll` | 1–12 | 3–12 | minor | A runner who never moves ranks above eliminated ones. |
| `room-rush` | 3–12 | 5–12 | minor | With 2 left, the follower ties the leader (the room never locks). At 12, several survivors share 1st. |
| `sumo-ice` | 2–12 | 3–10 | minor | **Bug**: every rescue lands on the same point (`b.id.length` is always 36). Crowded endgame at 10+. |
| `pang` | 1–12 | 2–12 | OK | Rival thumbnail labels overlap at 9+. |
| `star-blaster` | 1–12 | 2–10 | minor | Ships auto-fire, so an AFK seat scores 200–600 points. Thumbnail labels overlap at 10+. |
| `asteroids` | 1–12 | 3–8 | minor | Rock supply doesn't scale with N. AFK ships are free kills. |
| `bomber-express` | 2–12 | 3–8 | **real** at 11–12 | **Bug**: 10 spawn cells, so the 11th and 12th players stack on seats 0 and 1 (it was capped at 10 until fixed). Spawns follow join order. |
| `brawl` | 2–12 | 3–8 | minor | The last hitter takes the KO. AFK seats are free KOs. Spawns follow join order. |
| `jump-rope` | 1–12 | 2–12 | OK | Phone avatars overlap at 9+ (fixed 32 px). |

### Racing & athletics

| Game | min–max | best | Balance | Key findings |
|---|---|---|---|---|
| `micro-race` | 1–12 | 3–10 | minor | Grid slot decides among equals (pole ≈ 2.7th vs back row ≈ 10.9th at 12). No slipstream. |
| `rally-stage` | 1–12 | 2–12 | OK | Starting ghosts stack (`slot % 5`). The playtest bot needs `PP_REPO`. |
| `speed-circuit` | 1–12 | 4–10 | OK | Slipstream and boost pads flatten the grid. |
| `dash-100m` | 1–12 | 2–8 | OK | **Bug**: the track overflows the HUD on landscape phones from 6–10 runners (it is mobile-friendly). |
| `hurdles-110m` | 1–12 | 2–8 | **real** | Never jumping is fastest: drag in the air outweighs a knock. Same layout bug as the dash. |
| `long-jump` | 1–12 | 2–10 | OK | Flag labels overlap. |
| `javelin-throw` | 1–12 | 2–10 | OK | Flag labels overlap. |

**What fits each headcount** (current ranges):

| Players | 1 | 2 | 3 | 4–8 | 9–10 | 11–12 |
|---|---|---|---|---|---|---|
| Playable | 39 | 52 | 53 | 55 | 55 | 55 |
| Recommended ("best") | 0 | 35 | 47 | 54–55 | 28 | 10 |

Bomb Relay and Fleet Battle need 4 players. The recommended set thins out above 8 on purpose: most
games are at their best in the usual 4–8 party.

## Cross-cutting findings

1. **Disconnected seats.** The engine passes every seat to `init`, including disconnected ones, so a
   dropped player:
   - holds rounds to their full timer (every "everyone is done" early finish);
   - is a free win for their duel opponent, or a "draw that scores like a win" when two dropped
     players are paired together;
   - drags their team down (Tug of War average, Bomb Relay holder);
   - is a free KO or kill in brawlers and shooters.

   One engine-level fix covers most of this: hand `init` the connected players only and rank the
   others last.
2. **Idle-wins-tiebreak.** In memory-flash, simon, pixel-weight, pixel-split and match-pairs, a player
   who never acted has a tiebreak time or attempt count of 0, which beats a player who played and
   scored the same. Close cousins of the same pattern: freeze-doll, honeycomb-cut and fruit-catch.
   Rule: never-acted ranks last among equals.
3. **Duel scoring has 2 tiers.** Winners, draws and byes all share rank 0, so a bye is a full win at
   every odd headcount and draws score like wins. Use 3 tiers (win, then draw or bye, then loss), and
   rank inside each tier by a per-game margin so the whole points table is used. Byes aren't rotated
   between rounds, and the bye player sits idle for 20–50 s.
4. **Teams.**
   - Red always gets the extra member on odd counts, and fleet-battle also lets red shoot first.
   - The host can build an empty or lopsided team (e.g. 4v0) and nothing blocks the start.
5. **Durations.** The catalog's `durationSec` overrides each module's own default. Simon, Sink the
   Fleet and Pixel Pong run at half the length they were tuned for.
6. **Display caps at 9–12 players.** Several scenes show only the top 6, 8 or 9 players, sometimes
   without "you" (MAX_CHIPS/MAX_LANES/MAX_ROWS/MAX_RIVALS). The one-row player strip gets cramped,
   and rival thumbnail labels overlap. Rule: show everyone, or the top N plus yourself.
7. **Private state on the wire.** Snapshots go to the whole room, so a few games broadcast data a
   modified client could read: higher-lower's next card, simon's sequence, match-pairs' reveals and
   sudoku boards. This is devtools-only on a LAN party: low priority, but contrary to their wire
   comments.
8. **Latency-judged timing.** reaction-duel, pixel-dash and pixel-beat judge taps when they arrive at
   the server, so round-trip time is part of the score. That's negligible on wired PCs and noticeable
   on wifi phones.
