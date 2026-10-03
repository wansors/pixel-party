# Visual consistency audit — players across all mini-games

- **Date**: 2026-10-03
- **Scope**: the backlog's *Visual consistency audit* (Icebox). It covers how every scene draws the
  players and shows who is who, plus migrating all of them to one shared avatar set.
- **Spec**: [`art-direction.md` §6.1](art-direction.md) (character spec). **Code**: `game/avatarSprites.ts`
  (the set), `game/avatars.ts` (`ensureAvatarTexture`, `AvatarSprite`, `avatarPx`), `game/playerMarks.ts`
  (`YouMarker`, `nameTagStyle`, `addShadow`) and `game/playerStrip.ts` (avatar chips).

## 1. Findings (before)

The inventory was taken from all 54 scenes:

- **Bespoke figures** that looked nothing like the lobby avatar, each with its own grid, proportions and
  skin tone:
  - Pixel Dash runner (12×14)
  - Sumo rikishi (16×16, top-down)
  - Tug of War pullers (9×12)
  - Quick Draw gunslingers (20×20)
  - Pixel Rain slime (18×12)
  - the procedural track & field athlete (20×24, 13 poses)
- **The lobby avatar itself** was 8×8, two colors, with no outline (so dark colors vanished on dark
  backgrounds). Twelve scenes stretched it to arbitrary sizes, which made the pixels uneven
  (22 px / 8 = 2.75). It always showed the front view, even when spun in Asteroids or mirrored in
  Brawl, and it had no faces for hurt, KO or a win.
- **"Which one is me?"** had about ten different answers:
  - ▼ markers in four styles (white, amber, own color, with and without a stroke); Glass Bridge put
    its ▼ on the *active runner*, not on you
  - an amber ring, a white halo, an underline, chip backgrounds, a ▶ prefix, a white dot
  - nothing at all on the racers' track
- **Identity cues**:
  - Four games showed no identity at all (Pixel Hoops, Pixel Weight, Pixel Split, Memory Flash).
  - Several used bare color squares or names in white or grey: Reaction, Color Trap, the Tetris
    rivals, Bomb Relay's chain, and the Pang / Star Blaster thumbnails.
  - Pilots were re-tinted lighter than the player's color.
- **Shadows and elimination** looks varied scene by scene: only three scenes had shadows, and there
  were five different "out" animations.

## 2. What changed

**One avatar set** (`avatarSprites.ts`):

- Six 16×16 chibi animals with a computed style: a 1-px outline in a dark tone of the identity color,
  3-tone shading lit from the top-left, light muzzles and bellies, and smiles.
- **Views**: front, side and back.
- **Expressions**: idle with blink, happy, hurt and KO.
- **Two-frame strides**: on the side view the feet pass under the body; on the front and back views one
  foot lifts.
- The Angular chrome (SVG) and every Phaser scene render the same pixels.
- UI sizes are snapped to whole pixel steps, and round and session winners smile.

**One way to animate it** (`AvatarSprite`):

- pose, `face(dx)`, `faceMotion(dx, dy)` (top-down 4-way facing), `walk(moving, time)`, expression,
  and an automatic idle blink
- `avatarPx()` for crisp sizes

**One set of cues** (`playerMarks.ts`):

- the amber outlined bobbing ▼ (`YouMarker`)
- identity-colored outlined name tags
- ground shadows

`PlayerStrip` chips now lead with each player's avatar (with a KO face once they are out).

## 3. Per game

| Game | Before | Now |
|---|---|---|
| Freeze Doll | front avatar, amber ▼ | back view walking to the doll; turns around hurt (lasered), KO (out), happy (safe); shadow; YouMarker |
| Glass Bridge | front avatar, ▼ on the active runner | front in the queue, back on the glass, happy across, KO falling; spotlight ring on the active runner, YouMarker on you |
| Room Rush, Sumo ICE, Bomber Express | front avatar spinning/fading | top-down 4-way facing, strides (Bomber, Maze), hurt/KO/happy, shadows, YouMarker |
| Brawl | front avatar mirrored | side view, hurt on hits, KO lying down |
| Jump Rope | front avatar | happy in the air, hurt on a trip, KO; shadow shrinks while airborne |
| Pang | front avatar; rivals = color rectangles, white labels | side view while walking, hurt/KO; rival thumbnails show avatars and identity-colored labels |
| Asteroids | the avatar *was* the ship (face spun with the heading) | bubble pod: the pilot rides upright (leaning into turns), nose chevron on the rim |
| Star Blaster, Rally Stage, Speed Circuit | pilot re-tinted | pilot in the identity color; Star Blaster rivals fly as avatars in the thumbnails |
| Marbles Duel | static avatars, plain-colored names | react to every reveal (happy/hurt) and to the result (happy/KO); identity-colored names |
| Pixel Dash | capped runner | side-view avatar: stride bob, happy jump, hurt stumble, shadow |
| Sumo Push | top-down rikishi | avatar on a shadow facing its shove; hurt on clashes, KO falling off; name tags |
| Tug of War | 9×12 pullers | side-view avatars leaning back (rope at belly height); winners cheer, losers KO |
| Quick Draw | 20×20 gunslingers | side-view avatars plus a pixel revolver drawn on the signal; happy winner, KO loser, grey jumper |
| Pixel Rain | slime | avatar (still exactly the hit-zone width), side view while sliding, squashed KO; survivors strip with names |
| 100 m / 110 m hurdles / long jump / javelin | procedural 20×24 athlete | side-view avatar: distance-driven strides, block crouch, hurdle tuck, flight and landing leans, a gripped javelin; the rig was removed |
| Micro Race | car, no driver | the avatar drives (as in Rally/Circuit); YouMarker; name tags |
| Maze Sprint | color orbs, white halo | walking avatars facing their step, happy at the flag; YouMarker |
| Fruit Catch | basket only | your avatar stands in the basket, faces the way it moves, happy on a catch, hurt on a bomb |
| Balloon Chicken | generic pump; rivals named only | your avatar works the pump (nervous once it is big, KO on a burst, happy on a cash-out); rivals' avatars next to their names |
| Bubble Pop | grey cannon | your avatar mans the cannon |
| Button Masher | color bars | each player's avatar runs at the head of their bar; the leader grins |
| Bomb Relay | colored squares | the relay chain is avatars; the holder is bigger and scared |
| Reaction, Color Trap, Roulette, Simon, Snake (rivals), Tetris sprints (rivals) | color swatches / text | avatars lead each row/chip/board (KO face once out, happy for the fastest) |
| Bug Smash, Stop Clock, Pixel Beat | text chips | avatar + text chips |
| Pixel Hoops, Pixel Weight, Pixel Split, Memory Flash | no identity at all | standard strip under the HUD (avatar + name + score); in Hoops your avatar shoots (happy on a basket, hurt on a miss) |
| Trivia, Number Rush, Quick Math, Odd One Out, Higher/Lower, Match Pairs, Sudoku Race, Honeycomb Cut | "■ name" strip | avatar strip (shared `PlayerStrip`) |

## 4. Left as is (by design)

- **Abstract play pieces** carry only the identity color, because they are not the player's body:
  the Pong paddle, the snake's body, balloons, baskets, cars, ships, Tetris stacks, fleets.
- **Board games** (Sink the Fleet, Fleet Battle): names in identity colors around the boards. There is
  no figure to draw.
- **Non-player characters** (the doll, the rope turners) stay neutral humans, so they never read as a
  player.
- Pixel Rain's avatar size follows the server's hit zone, not the crisp steps: the hit contract wins.
