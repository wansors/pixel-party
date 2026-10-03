// Mini-game catalog metadata — shared by both apps. The pure per-game logic lives server-side in
// apps/server/src/domain/minigames/; this is the wire-facing descriptor the lobby/host UI reads and the
// engine uses to pick a session line-up. Adding a game = one domain module + one client scene + one
// entry here.

export type MiniGameFormat = 'ffa' | 'duel' | 'team'

export type MiniGameId = string

// Skill axes a mini-game exercises (Phase 4 post-match analysis). Each game tags one or more; the
// session summary aggregates each player's normalized round results per axis to draw a radar/pentagon.
// Purely analytics — axes never affect scoring or the line-up.
export type SkillAxis =
  | 'reflexes'
  | 'speed'
  | 'knowledge'
  | 'memory'
  | 'precision'
  | 'nerve'
  | 'focus'

// Stable rendering order for the radar (so the polygon shape is consistent across players/sessions).
export const SKILL_AXES: readonly SkillAxis[] = [
  'reflexes',
  'speed',
  'knowledge',
  'memory',
  'precision',
  'nerve',
  'focus',
]

// A room's hard ceiling. The server's ROOM_MAX_PLAYERS may lower it; no game is built for more.
export const MAX_ROOM_PLAYERS = 12

// Who a game is built for (D27). `min`/`max` are hard limits: the lobby only offers a game while the
// room's connected headcount is inside them, and the session engine skips it otherwise. `best` is the
// sweet spot — where the game is most fun — shown on the lobby card and used by the "ideal" filter.
export interface PlayerFit {
  readonly min: number
  readonly max: number
  readonly best: readonly [number, number]
}

export interface MiniGameMeta {
  readonly id: MiniGameId
  readonly name: string
  readonly format: MiniGameFormat
  readonly players: PlayerFit
  // Whether the server runs a continuous fixed-timestep tick for this game (real-time) or it resolves
  // on intent/timeout only (turn-based / instantaneous scoring).
  readonly realtime: boolean
  // Plays well on a phone (touch controls, small portrait screen). Pixel Party is PC-first: false means
  // "best with keyboard/mouse on a big screen" — it still runs on a phone, just not comfortably
  // (continuous steering, several buttons at once, fine timing on a narrow view). Shown as a lobby
  // badge/filter and on the round intro card; never affects scoring or the line-up.
  readonly mobileFriendly: boolean
  // Nominal round duration in seconds (host-tunable later); 0 = ends on an explicit finish condition.
  readonly durationSec: number
  readonly blurb: string
  // Skill axes this game exercises (Phase 4 radar). At least one; drives per-axis aggregation only.
  readonly axes: readonly SkillAxis[]
}

// The catalog: one descriptor per mini-game, in lobby order.
export const MINIGAMES: readonly MiniGameMeta[] = [
  {
    id: 'reaction-duel',
    name: 'Reaction Duel',
    format: 'ffa',
    players: { min: 2, max: 12, best: [3, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 0,
    blurb: 'Tap the instant the light turns green. Too early and you are out.',
    axes: ['reflexes'],
  },
  {
    id: 'button-masher',
    name: 'Button Masher',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 10,
    blurb: 'Mash as fast as you can before the timer runs out.',
    axes: ['speed'],
  },
  {
    id: 'color-trap',
    name: 'Color Trap',
    format: 'ffa',
    players: { min: 1, max: 12, best: [3, 12] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 22,
    blurb: 'Tap the INK color of the word, not what it spells. Mind the trap.',
    axes: ['focus'],
  },
  {
    id: 'trivia',
    name: 'Lightning Quiz',
    format: 'ffa',
    players: { min: 1, max: 12, best: [3, 12] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Answer fast — correct answers score, and speed earns a bonus.',
    axes: ['knowledge'],
  },
  {
    id: 'weird-trivia',
    name: 'Weird Trivia',
    format: 'ffa',
    players: { min: 1, max: 12, best: [3, 12] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 50,
    blurb: 'Strange but true: pick the real answer among the absurd ones. Fast answers score more.',
    axes: ['knowledge', 'reflexes'],
  },
  {
    id: 'balloon-chicken',
    name: 'Balloon Chicken',
    format: 'ffa',
    players: { min: 2, max: 12, best: [3, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 20,
    blurb: 'Pump for points, but cash out before it bursts — or lose it all.',
    axes: ['nerve'],
  },
  {
    id: 'number-rush',
    name: 'Number Rush',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Tap the numbers 1 to 25 in order as fast as you can.',
    axes: ['focus', 'speed'],
  },
  {
    id: 'quick-math',
    name: 'Quick Math',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Solve as many sums as you can before the timer runs out.',
    axes: ['knowledge'],
  },
  {
    id: 'odd-one-out',
    name: 'Odd One Out',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Spot the one tile that stands out. The grid keeps growing.',
    axes: ['focus'],
  },
  {
    id: 'higher-lower',
    name: 'Higher or Lower',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 22,
    blurb: 'Guess if the next card is higher or lower. One miss ends your run.',
    axes: ['nerve'],
  },
  {
    id: 'bug-smash',
    name: 'Bug Smash',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Smash the bugs, dodge the bombs. Fastest hands win.',
    axes: ['reflexes'],
  },
  {
    id: 'stop-clock',
    name: 'Stop the Clock',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 25,
    blurb: 'Stop the needle as close to the target as you can. Three tries.',
    axes: ['precision'],
  },
  {
    id: 'memory-flash',
    name: 'Memory Flash',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Count the flash — how many of the target colour did you see?',
    axes: ['memory'],
  },
  {
    id: 'simon',
    name: 'Simon',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 60,
    blurb: 'Watch the sequence, then repeat it. It grows every round.',
    axes: ['memory'],
  },
  {
    id: 'pixel-hoops',
    name: 'Pixel Hoops',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Charge and release to sink the basket. Chain them for combos.',
    axes: ['precision'],
  },
  {
    id: 'pixel-weight',
    name: 'Pixel Weight',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'A pixel object flashes — guess how many pixels it is made of.',
    axes: ['precision', 'memory'],
  },
  {
    id: 'pixel-split',
    name: 'Pixel Split',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Cut the object in two halves with the same number of pixels.',
    axes: ['precision'],
  },
  {
    id: 'tug-of-war',
    name: 'Tug of War',
    format: 'team',
    players: { min: 2, max: 12, best: [4, 10] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 15,
    blurb: 'Two teams, one rope. Mash together to pull the marker to your side.',
    axes: ['speed'],
  },
  {
    id: 'sink-the-fleet',
    name: 'Sink the Fleet',
    format: 'duel',
    players: { min: 2, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 60,
    blurb: 'Head-to-head Battleship. Take turns firing to sink your rival before they sink you.',
    axes: ['precision'],
  },
  {
    id: 'bomb-relay',
    name: 'Bomb Relay',
    format: 'team',
    players: { min: 4, max: 12, best: [4, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 25,
    blurb: 'Pass the bomb down your team — mash your leg and hand it off before the fuse blows.',
    axes: ['speed'],
  },
  {
    id: 'fruit-catch',
    name: 'Fruit Catch',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Slide your basket to catch the falling fruit — and dodge the bombs.',
    axes: ['reflexes', 'precision'],
  },
  {
    id: 'pixel-rain',
    name: 'Pixel Rain',
    format: 'ffa',
    players: { min: 1, max: 12, best: [3, 10] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Dodge the falling blocks. Last one standing wins.',
    axes: ['reflexes'],
  },
  {
    id: 'pixel-dash',
    name: 'Pixel Dash',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Tap to jump the obstacles as they rush in. Clear the most to win.',
    axes: ['reflexes', 'precision'],
  },
  {
    id: 'snake-arena',
    name: 'Snake Arena',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 30,
    blurb: 'Eat, grow, and do not crash. The longest snake wins.',
    axes: ['reflexes', 'focus'],
  },
  {
    id: 'pixel-pong',
    name: 'Pixel Pong',
    format: 'duel',
    players: { min: 2, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 45,
    blurb: 'Head-to-head pong. First to five points takes the duel.',
    axes: ['reflexes', 'precision'],
  },
  {
    id: 'sumo-push',
    name: 'Sumo Push',
    format: 'ffa',
    players: { min: 3, max: 12, best: [4, 8] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 30,
    blurb: 'Shove everyone else out of the ring. Last sumo standing wins.',
    axes: ['reflexes'],
  },
  {
    id: 'match-pairs',
    name: 'Match',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Flip the cards and clear every matching pair before anyone else.',
    axes: ['memory', 'focus'],
  },
  {
    id: 'quick-draw',
    name: 'Quick Draw',
    format: 'duel',
    players: { min: 2, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 20,
    blurb: 'Wait for FIRE, then draw first. Flinch early and you lose.',
    axes: ['reflexes'],
  },
  {
    id: 'pixel-roulette',
    name: 'Pixel Roulette',
    format: 'ffa',
    players: { min: 2, max: 12, best: [4, 12] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 15,
    blurb: 'Spin for a random number. Highest wins — pure luck.',
    axes: ['nerve'],
  },
  {
    id: 'sudoku-race',
    name: 'Sudoku Race',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Everyone solves the same mini sudoku. Fastest correct grid wins.',
    axes: ['focus', 'knowledge'],
  },
  {
    id: 'pixel-beat',
    name: 'Pixel Beat',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 12] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 40,
    blurb: 'Tap along to the beat before it fades. Timing is everything.',
    axes: ['reflexes'],
  },
  {
    id: 'fleet-battle',
    name: 'Fleet Battle',
    format: 'team',
    players: { min: 4, max: 12, best: [4, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 90,
    blurb: 'Team Battleship — coordinate shots with your squad to sink the enemy fleet first.',
    axes: ['precision'],
  },
  {
    id: 'maze-sprint',
    name: 'Maze Sprint',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 45,
    blurb: 'Race through the same maze as everyone else. Fastest exit wins.',
    axes: ['focus'],
  },
  {
    id: 'line-clear-sprint',
    name: 'Line Clear Sprint',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 60,
    blurb: 'Stack pixels, clear lines, beat the clock. Most lines wins.',
    axes: ['precision'],
  },
  {
    id: 'quick-tetris',
    name: 'Quick Tetris',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 45,
    blurb: 'A short, frantic Tetris sprint — first to clear the target lines wins.',
    axes: ['speed'],
  },
  {
    id: 'bubble-pop',
    name: 'Bubble Pop',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 60,
    blurb: 'Shoot color-matched bubbles to pop clusters of three or more. Clear the board fastest.',
    axes: ['precision'],
  },
  {
    id: 'micro-race',
    name: 'Micro Race',
    format: 'ffa',
    players: { min: 1, max: 12, best: [3, 8] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 90,
    blurb: 'Tiny cars, tabletop tracks. Three laps, bump your rivals, first across the line wins.',
    axes: ['reflexes', 'precision'],
  },
  {
    id: 'dash-100m',
    name: '100m Dash',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 30,
    blurb: 'Alternate LEFT and RIGHT as fast as you can to sprint. Wait for the gun!',
    axes: ['speed', 'reflexes'],
  },
  {
    id: 'hurdles-110m',
    name: '110m Hurdles',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 8] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 35,
    blurb: 'Sprint with LEFT/RIGHT and JUMP each hurdle. Clip one and you lose your speed.',
    axes: ['speed', 'precision'],
  },
  {
    id: 'long-jump',
    name: 'Long Jump',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 45,
    blurb:
      'Sprint down the runway, hold JUMP at the board to set the angle, release to fly. 3 tries.',
    axes: ['precision', 'speed'],
  },
  {
    id: 'javelin-throw',
    name: 'Javelin',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 45,
    blurb: 'Build speed, hold THROW before the line to aim, release to launch. Longest throw wins.',
    axes: ['precision', 'speed'],
  },
  {
    id: 'glass-bridge',
    name: 'Glass Bridge',
    format: 'ffa',
    players: { min: 2, max: 10, best: [4, 8] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 75,
    blurb: 'Cross one by one: LEFT or RIGHT panel? One holds, one shatters. Watch for the glint.',
    axes: ['nerve', 'focus'],
  },
  {
    id: 'freeze-doll',
    name: 'Freeze Doll',
    format: 'ffa',
    players: { min: 1, max: 12, best: [3, 12] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 50,
    blurb: 'Hold to walk while she sings, freeze before she turns. Her laser spots any twitch!',
    axes: ['reflexes', 'nerve'],
  },
  {
    id: 'room-rush',
    name: 'Room Rush',
    format: 'ffa',
    players: { min: 3, max: 12, best: [5, 12] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 75,
    blurb: 'A number is called: pack a room with exactly that many. Shove, dash, slam the door!',
    axes: ['speed', 'nerve'],
  },
  {
    id: 'sumo-ice',
    name: 'Sumo ICE',
    format: 'ffa',
    players: { min: 2, max: 12, best: [3, 8] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 45,
    blurb: 'Sumo on a melting ice floe: slide, shove and stay on the ice. Last one dry wins!',
    axes: ['reflexes', 'precision'],
  },
  {
    id: 'pang',
    name: 'Pang',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 12] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 50,
    blurb:
      'Harpoon the bouncing balloons: each hit splits them smaller. Most pops wins, dodge them all!',
    axes: ['precision', 'reflexes'],
  },
  {
    id: 'star-blaster',
    name: 'Star Blaster',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 50,
    blurb:
      'Same waves for everyone: weave through the bullet storm, your ship fires itself. Top score wins.',
    axes: ['reflexes', 'focus'],
  },
  {
    id: 'asteroids',
    name: 'Asteroids Arena',
    format: 'ffa',
    players: { min: 1, max: 12, best: [3, 8] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 60,
    blurb: 'One shared wrap-around sky: rotate, thrust, shoot. Rocks pay, rival ships pay more!',
    axes: ['precision', 'reflexes'],
  },
  {
    id: 'bomber-express',
    name: 'Bomber Express',
    format: 'ffa',
    players: { min: 2, max: 10, best: [3, 8] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 60,
    blurb:
      'Everyone starts maxed out: huge blasts, five bombs, fast boots. Last one standing wins!',
    axes: ['reflexes', 'nerve'],
  },
  {
    id: 'brawl',
    name: 'Street Brawl',
    format: 'ffa',
    players: { min: 2, max: 12, best: [3, 8] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 75,
    blurb:
      'One street, everybody fighting: punch combos, kicks, throws, pipes and chicken. Last one up wins!',
    axes: ['reflexes', 'speed'],
  },
  {
    id: 'rally-stage',
    name: 'Rally Stage',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 12] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 70,
    blurb:
      'Point-to-point against the clock: gravel slides, tarmac grips, split times. Fastest stage wins.',
    axes: ['precision', 'speed'],
  },
  {
    id: 'speed-circuit',
    name: 'Speed Circuit',
    format: 'ffa',
    players: { min: 1, max: 12, best: [4, 10] },
    realtime: true,
    mobileFriendly: false,
    durationSec: 100,
    blurb:
      'Two laps wheel-to-wheel: tuck into the slipstream, hit the boost pads, take the flag first.',
    axes: ['precision', 'reflexes'],
  },
  {
    id: 'honeycomb-cut',
    name: 'Honeycomb Cut',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 10] },
    realtime: false,
    mobileFriendly: true,
    durationSec: 45,
    blurb:
      'Trace the shape in the candy with your needle. Stray off the line or rush and it cracks!',
    axes: ['precision', 'nerve'],
  },
  {
    id: 'jump-rope',
    name: 'Jump Rope',
    format: 'ffa',
    players: { min: 1, max: 12, best: [2, 12] },
    realtime: true,
    mobileFriendly: true,
    durationSec: 50,
    blurb:
      'A giant rope swings faster and faster: tap to jump as it sweeps under you. Two misses and you are out!',
    axes: ['reflexes', 'focus'],
  },
  {
    id: 'marbles-duel',
    name: 'Marbles Duel',
    format: 'duel',
    players: { min: 2, max: 12, best: [2, 8] },
    realtime: false,
    mobileFriendly: true,
    durationSec: 50,
    blurb:
      'Odd or even? Hide marbles in your fist, bet on your rival’s. Win them all to win the duel.',
    axes: ['nerve', 'focus'],
  },
]

export const MINIGAMES_BY_ID: ReadonlyMap<MiniGameId, MiniGameMeta> = new Map(
  MINIGAMES.map((m) => [m.id, m]),
)

// Whether a headcount is inside the game's hard limits (an unknown id fits nobody).
export function fitsPlayers(id: MiniGameId, count: number): boolean {
  const fit = MINIGAMES_BY_ID.get(id)?.players
  return fit !== undefined && count >= fit.min && count <= fit.max
}

// The part of a line-up that a room of `count` players can actually play (distinct, in pick order).
export function playableGames(ids: readonly MiniGameId[], count: number): MiniGameId[] {
  return [...new Set(ids)].filter((id) => fitsPlayers(id, count))
}

// Whether a headcount is inside the game's recommended range.
export function idealForPlayers(id: MiniGameId, count: number): boolean {
  const best = MINIGAMES_BY_ID.get(id)?.players.best
  return best !== undefined && count >= best[0] && count <= best[1]
}
