# Scoring and ranking system — Pixel Party

- **Version**: 0.2 (draft)
- **Date**: 2026-07-17

Defines how each mini-game's result turns into points, how points accumulate over the session, and how
the final ranking is resolved. Inspired by *Mario Party*: what matters is not winning a single mini-game
but the **accumulation across the session**.

---

## 1. Design principles

1. **Everyone scores**: each mini-game awards points to every position, not just the winner, to keep
   everyone in the match until the end.
2. **Comebacks possible**: the gap between positions should not be so large that the match is decided
   early (avoids an unreachable leader by mid-session).
3. **Fairness**: the award depends on the mini-game's **normalized result** (ranking or score), not on
   each game's internal metrics.
4. **Transparency**: after each round, show what points each player earned and the cumulative
   scoreboard.

---

## 2. Points per mini-game (position-based award)

Each mini-game produces a **player ranking** (1st, 2nd, 3rd…). The engine translates position into
points using an award table. Default table for a room of up to **10 players** (the max, PRD FR-1.3):

| Position | Points |
|----------|--------|
| 1st | 10 |
| 2nd | 7 |
| 3rd | 5 |
| 4th | 4 |
| 5th | 3 |
| 6th | 2 |
| 7th | 2 |
| 8th | 1 |
| 9th | 1 |
| 10th | 0 |

Notes:
- The table is **configurable**; the engine only needs "position → points".
- Scales to any number of players: with N players, the first N rows are used (covers the 4–10 range).
- Deliberate design: strong reward for 1st, but a **compressed, flat tail** (deliberate ties in the
  lower half) so trailing players stay within comeback range and only last place scores 0.

### 2.1 Ties within a mini-game
If two players tie for a position, they **receive the average** of the points for the positions they
occupy. Example: a tie for 1st between two players → both get (10 + 7) / 2 = 8.5 (or configurable
rounding), and the next player takes 3rd position.

---

## 2.2 Team and duel results

Not every mini-game produces a flat FFA ranking. The engine normalizes each format into per-player
position points:

- **Team games**: the team is ranked (winning team above), and **every member receives the points of
  that team's position**. Optionally, an intra-team contribution bonus can nudge the top contributors
  (off by default, configurable).
- **Duel / bracket games**: the bracket produces an ordering (winner, finalist, semifinalists…). That
  ordering maps to position points via the same table. For simultaneous 1v1 pairings, wins/losses are
  aggregated into a round ranking.

In all cases the engine ends up with a **position → points** mapping per player, so §2's table applies
uniformly regardless of format.

---

## 3. Optional bonuses (configurable)

For *Mario Party*-style variety (enabled via room configuration):

- **Speed bonus**: in mini-games scored by time/hits, a small extra for a wide margin (kept
  non-decisive).
- **Double-points final round**: the last round awards x2 to keep the tension.
- **Surprise stars (end of session)**: a bonus for random milestones (e.g., "most total hits", "fewest
  false starts"), a nod to Mario Party's bonus stars. Low weight so it doesn't distort results.

> For the MVP, it's recommended to start **without bonuses** (position-based award only) and add them
> later.

---

## 3.1 Handicap / catch-up

To keep sessions competitive and full of comebacks, the engine can apply **bounded** catch-up based on
the current standings. Two levers, both optional and configurable per session:

- **Mechanical handicap** (in-game): the engine passes a handicap factor to each mini-game's handicap
  hooks (see `minigame-catalog.md` §H) — leader nerf, trailer boost, team weighting. The factor scales
  with how far ahead/behind a player is.
- **Scoring handicap** (points): trailing players can receive a small multiplier on earned points (e.g.,
  up to +20% for the bottom placements), or the leader's award is slightly compressed.

Guardrails:
- **Capped**: total handicap effect is bounded so it narrows gaps without handing out wins.
- **Opt-in**: ships toggled off in the MVP; tuned once real sessions are observed.
- **Transparent**: if scoring handicap is applied, show it in the results screen so it never feels
  arbitrary.

---

## 4. Cumulative scoreboard

- After each round, the mini-game's points are added to each player's **session scoreboard**.
- Shown: points earned in the round + accumulated total + current ranking position.
- The engine keeps the scoreboard as server-authoritative state.

---

## 5. Final ranking and tiebreakers

At the end of the last round, players are ordered by **total accumulated points** (higher wins).

### Tiebreaker rules (in order)
1. **Most 1st places** achieved during the session. *(Implemented — `domain/services/finalRanking`.)*
2. **Best average position** across mini-games. *(Implemented.)*
3. **Result in a quick tiebreaker mini-game** (e.g., "Quick reaction", 1 round). *(Future — needs an
   engine sub-flow; see `implementation-decisions.md` D12.)*
4. If still tied: **shared tie** on the podium. *(Implemented — players equal on 1+2 share a rank.)*

---

## 6. Session example (4 players, 4 rounds)

| Player | R1 (pos→pts) | R2 | R3 | R4 | Total |
|--------|-------------|----|----|----|-------|
| Ana | 1st → 10 | 2nd → 7 | 1st → 10 | 3rd → 5 | **32** |
| Marta | 2nd → 7 | 1st → 10 | 3rd → 5 | 1st → 10 | **32** |
| Luis | 3rd → 5 | 3rd → 5 | 2nd → 7 | 2nd → 7 | 24 |
| Pep | 4th → 4 | 4th → 4 | 4th → 4 | 4th → 4 | 16 |

Ana/Marta tie at 32 → tiebreak by "most 1st places": Ana 2 vs Marta 2 → still tied → by average
position: equal → tiebreaker mini-game. This illustrates why the compressed award keeps the session
alive until the end.

---

## 7. Special-case handling

- **Mid-session drop-out**: a leaving player keeps their points but doesn't score in future rounds; the
  award is recomputed with the remaining players.
- **Reconnection**: on return, they recover their accumulated scoreboard (FR-2.3).
- **Disqualification in a mini-game** (e.g., a false start): they get the worst position of that round
  (0 points), not negative points.

---

## 8. Configurable parameters (summary)

| Parameter | Default | Notes |
|-----------|---------|-------|
| Position award table | 10/7/5/4/3/2/2/1/1/0 | Adjustable; covers up to 10 players |
| Rounds per session | 4 (TBD, PRD §12) | |
| Bonuses | Disabled in MVP | Speed, double final round, stars |
| Handicap / catch-up | Disabled in MVP | Mechanical (in-game) + scoring; capped |
| Tie rounding | Average, 1 decimal | Or integer rounding |
| Tiebreaker mini-game | Quick reaction | Configurable |
