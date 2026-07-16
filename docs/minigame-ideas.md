# Mini-game ideas — prioritized list

- **Version**: 0.1 (draft)
- **Date**: 2026-07-16

A prioritized master list of ~30 mini-game candidates for Pixel Party. It exists to decide **what to
build first**. Full specs live in `minigame-catalog.md` (ids referenced here); shipping order feeds
`backlog.md`.

## Prioritization method

Each game is scored on four axes (1–5), then ranked. Higher priority = ship earlier.

- **Fun / banter** — how much laughter and *pique* it generates (the whole point of the game).
- **Healthy competition** — everyone can compete and comebacks are possible; no runaway leaders, no
  long dead time for the eliminated. Pure-luck or harsh-elimination games score lower here.
- **Effort (inverted)** — lower dev cost scores higher. Simple, latency-tolerant games first.
- **Latency tolerance** — turn-based / instantaneous-scoring games score higher than real-time netcode.

**Priority score** favors *fun × healthy competition × low effort*. Real-time-netcode games are
deferred regardless of fun until the sync layer is proven (see `backlog.md` Phase 5).

Tiers: **P0** MVP core · **P1** early expansion (high fun, low effort) · **P2** formats & medium effort ·
**P3** real-time / high effort / use-sparingly.

---

## Ranked list

| # | Game (id) | Format | Fun/Banter | Healthy comp. | Effort | Latency | Tier | Why this rank |
|---|-----------|--------|:---------:|:------------:|:------:|:-------:|:----:|---------------|
| 1 | Quick reaction — A1 | FFA | 4 | 5 | Low | Low | **P0** | Dead-simple, universal, instant pique; perfect first game. |
| 2 | Button masher — A2 | FFA | 4 | 5 | Low | Low | **P0** | Everyone can play, pure effort, great warm-up. |
| 3 | Color Trap (Stroop) — E1 | FFA | 5 | 5 | Low | Low | **P0** | Hilarious brain-trip, cheap to build, huge banter. |
| 4 | Balloon Chicken — D1 | FFA | 5 | 4 | Low | Low | **P0** | Nerve + trash talk; server owns the burst → cheat-proof. |
| 5 | Lightning quiz (Trivia) — A3 | FFA | 4 | 4 | Med | Low | **P0** | Broad appeal; needs a question bank (i18n) so slightly more effort. |
| 6 | Sequence memory (Simon) — A4 | FFA | 3 | 4 | Low | Low | **P1** | Classic, easy; a bit less loud than the top group. |
| 7 | Higher or Lower — E5 | FFA | 4 | 4 | Low | Low | **P1** | Nerve game, cheap; keep luck bounded for fairness. |
| 8 | Quick Math — E2 | FFA | 3 | 5 | Low | Low | **P1** | Fair and cheap; skill-based, good filler. |
| 9 | Odd One Out — E3 | FFA | 4 | 5 | Low | Low | **P1** | Satisfying "I saw it first!" moments, very cheap. |
| 10 | Number Rush (Schulte) — E4 | FFA | 3 | 5 | Low | Low | **P1** | Pure attention/speed, fair, cheap. |
| 11 | Bug smash (Whack-a-mole) — A6 | FFA | 4 | 4 | Low/Med | Low | **P1** | Tactile and fun; common-seed spawns for fairness. |
| 12 | Stop the clock (Timing) — A10 | FFA | 3 | 5 | Low | Low | **P1** | Fair precision game, trivial netcode. |
| 13 | Memory Flash — E8 | FFA | 3 | 4 | Low | Low | **P1** | Cheap memory game, good variety. |
| 14 | Pixel Hoops (Basketball) — A5 | FFA | 5 | 4 | Med | Low/Med | **P1** | High banter, recognizable; some physics/aim work. |
| 15 | Tug of War — C1 | Team | 5 | 4 | Low/Med | Low | **P2** | Best first **team** game: loud, simple, aggregate taps. |
| 16 | Sink the Fleet (Battleship) — B2 | Duel | 4 | 4 | Med | Low | **P2** | First **duel/bracket**, turn-based → no real-time netcode. |
| 17 | Speed puzzle (Match) — A11 | FFA | 3 | 4 | Med | Low | **P2** | Solid memory/puzzle; same-layout fairness. |
| 18 | Bomb Relay (Hot potato) — C2 | Team | 5 | 4 | Med | Med | **P2** | Chaotic team fun; needs a pass/turn sync. |
| 19 | Quick Draw Duel — E7 | Duel | 5 | 4 | Low | Med | **P2** | Western reaction duel; huge banter, light netcode. |
| 20 | Pixel Beat (Rhythm) — E6 | FFA | 4 | 4 | Med | Low/Med | **P2** | Fun, needs beat/asset authoring. |
| 21 | Fruit Catch — D2 | FFA | 3 | 4 | Low/Med | Low/Med | **P2** | Simple arcade; common-seed drops. |
| 22 | Fleet Battle (team Battleship) — C3 | Team | 3 | 4 | Med | Low | **P2** | Team variant once B2 exists. |
| 23 | Pixel Pong — B1 | Duel | 5 | 4 | High | High | **P3** | Iconic 1v1 but needs real-time netcode → deferred. |
| 24 | Sumo Push — B3 | Duel/FFA | 5 | 3 | High | High | **P3** | Hilarious shoving, but physics + real-time sync. |
| 25 | Pixel Dash (Platform race) — A9 | FFA | 4 | 4 | Med/High | Med | **P3** | Great race feel; client sim + validation. |
| 26 | Snake Arena — A8 | FFA | 4 | 4 | Med | Med | **P3** | Classic; common-seed food + validation. |
| 27 | Maze Sprint — E9 | FFA | 3 | 4 | Med | Med | **P3** | Navigation race; medium effort. |
| 28 | Pixel rain (Dodge) — A7 | FFA | 3 | 4 | Med | Med | **P3** | Survival dodger; elimination can idle players. |
| 29 | Line Clear Sprint — E10 | FFA | 3 | 4 | High | Low | **P3** | Tetris-like; highest build effort. |
| 30 | Pixel Roulette (Luck) — D3 | FFA | 3 | 2 | Low | Low | **P3** | Cheap but pure luck → use sparingly, low priority. |

---

## Reading the ranking

- **Ship first (P0, #1–5)**: the loudest, cheapest, fairest games — enough for a fun MVP session and to
  validate the engine + scoring.
- **P1 (#6–14)**: fast, cheap variety that keeps sessions fresh; mostly individual, latency-tolerant.
- **P2 (#15–22)**: introduces **team** and **duel** formats (Tug of War, Battleship first) plus
  medium-effort games — the point where the social dynamic gets richer.
- **P3 (#23–30)**: real-time-netcode and high-effort games, deferred until the sync layer is proven;
  pure-luck games kept intentionally low.

> "Healthy competition" deliberately down-ranks elimination-heavy and pure-luck designs: we prefer games
> where a trailing player can still fight and no one sits idle watching. Handicap (`scoring-system.md`
> §3.1) reinforces this across the whole session.
