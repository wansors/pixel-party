# Playtest bugs

Bugs found during LAN playtesting sessions, with their current status.

## 2026-08-22

| Bug | Status |
|-----|--------|
| **Quick Tetris / Line Clear Sprint**: pressing the Up key does not rotate the piece. | Fixed (2026-08-22: `keydown-UP` → `rotate` input, server wall-kicks in `tetrisCore.tryRotate`); rotation now covered by `tetrisCore.test.ts` (2026-09-26). |
| **Bubble Pop**: can assign/give a color that has no bubbles left on the board (already empty). | Fixed (2026-08-22: `nextValidShot` skips colors no longer on the board). |
| **Live ranking/scoreboard**: only reflects the current mini-game's score, not the cumulative session total. | Fixed (2026-09-26): the live board is ordered by the **session total**, with this round's live tally as an extra column + tiebreak and the round leader starred (`RoomStore.liveRows`). |
| **Pixel Split**: objects/pieces should not all align the same way (lack of variety in layout). | Fixed (2026-09-26): each puzzle is varied with the seeded RNG so the ideal cut moves (see D19). |
| **Simon**: when the sequence repeats the same color twice in a row, the playback is too quick to follow. | Fixed (2026-08-22: longer gap before a repeated pad, `PLAY_REPEAT_GAP_MS`). |
| **Balloon Chicken** (referred to as "balloon pop"): displayed player names are not the real ones. | Fixed (2026-08-22: scenes read real names from `RoundState.names`; colors too since 2026-09-26). |
| **Pixel Hoops** (referred to as "pixel hope"): the green target/scoring area should shrink each time (increasing difficulty), currently stays the same size. | Fixed (2026-08-22: `toleranceForShot` shrinks the band per shot). |
| **Round result screen**: the round winner and the round summary are shown on separate screens; should be combined into one. | Fixed: one screen since 2026-08-22; since 2026-09-26 the server also publishes `SCOREBOARD` together with `ROUND_RESULT`, so the combined screen no longer shows the previous round's totals for its first 4 s. |
| **Fruit Catch**: bombs are not visually clear (hard to distinguish from fruits); caught fruits should disappear after being caught but don't. | Fixed: items leave the snapshot at the catch line (2026-08-22); the bomb styling had regressed in the pixel-style pass and was redone on 2026-09-26 (red-rimmed bomb with a flickering fuse, distinct fruit sprites, basket drawn exactly as wide as the catch zone). |
| **Sudoku Race**: once a cell is filled with the correct number, it should be locked/blocked from further edits. | Fixed (2026-08-22). The lock opened a brute-force exploit (tap-cycle each cell until it locks), closed on 2026-09-26: digits are entered from a number pad and a wrong digit costs a short server-side input cooldown (see D19). |
| **Layout**: the screen should be fixed-size; a scroll bar should not be needed. | Fixed (2026-09-26): the page never scrolls; the lobby is a two-column layout with an always-visible action bar (READY / START never scroll away), and the Phaser canvas is pinned to its container so it can't overflow under the live board or below the viewport. |

## 2026-09-26 (polish pass — found while reviewing every screen in headless Chrome)

| Bug | Status |
|-----|--------|
| From round 2 on, the canvas could freeze or go black: the previous round's scene kept running and read the next game's snapshot shape, threw inside Phaser's step, and stopped the render loop. | Fixed: `GameClient` stops the scene when a round ends, and `MiniGameScene.snap` only returns a snapshot that belongs to that scene's game; per-frame work is crash-guarded. |
| The self-hosted pixel font never rendered: `press-start-2p.woff2` was the Cyrillic-only subset, so all UI and canvas text silently fell back to Courier. | Fixed: full Press Start 2P (OFL, license shipped next to it) + a px type scale so glyphs stay crisp. |
| Scenes laid themselves out against a stale canvas size when a round started (Phaser only re-measures its parent every 500 ms). | Fixed: `GameClient.refresh()` re-measures before the scene starts; scenes relayout on real viewport changes. |
| 10 mini-games had no catalog translations (Spanish showed English names/blurbs); several scenes hardcoded English banners. | Fixed. |
| Skill-radar axis labels were clipped at the chart edges. | Fixed (wider viewBox). |
| Page reload race: the new socket REJOINed before the old socket's close was processed, and that late close then dropped the seat (lobby) or marked it offline and moved the host role (mid-session). | Fixed: the server tracks which socket holds each seat and closes the superseded one (WS test `apps/server/test/rejoin.test.ts`). |
| A round ended the instant it was decided (last answer, instant Tug of War win, last ship sunk), so the winning moment was never drawn — the last snapshot was often not even sent. | Fixed: the final snapshot is always published (flagged `final`, FINISH stamp in the HUD) and the result follows after a 1.5 s grace period. |
| Pixel Rain kept the last survivor playing alone for up to 40 s. | Fixed: a multiplayer round ends when one player is left. |
| Fractional tie-averaged points rendered as `5.333333333333333`. | Fixed: points show at most one decimal. |
| Reaction Duel turned green up to one snapshot (~150 ms) late, adding to everyone's time. | Fixed: green is scheduled locally from `greenInMs` (never early). |
| Pixel Beat judged taps before the verdict could arrive and ran ~150 ms late. | Fixed: verdicts come from score/streak changes; the beat clock is anchored to the round start. |
| Several scenes drew things somewhere other than where the server computes them (Pixel Rain avatar narrower than its hitbox, Pixel Dash obstacles arriving ~190 ms early, Sumo ring mapped non-square, Pong paddle faces off the contact lines, Fruit Catch basket narrower than its catch zone). | Fixed: each scene now mirrors the server's geometry. |
| Sumo touch steering was measured from the ring centre, not from your own wrestler. | Fixed. |
| Stroop words (Color Trap) and Memory Flash color names were always English. | Fixed (translated). |

## Feature requests / ideas (not bugs)

- Friends asked for new luck-based games, e.g. Pachinko-style / gambling-style mini-games.
