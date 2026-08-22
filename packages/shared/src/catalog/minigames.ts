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

export interface MiniGameMeta {
  readonly id: MiniGameId
  readonly name: string
  readonly format: MiniGameFormat
  // Whether the server runs a continuous fixed-timestep tick for this game (real-time) or it resolves
  // on intent/timeout only (turn-based / instantaneous scoring).
  readonly realtime: boolean
  // Nominal round duration in seconds (host-tunable later); 0 = ends on an explicit finish condition.
  readonly durationSec: number
  readonly blurb: string
  // Skill axes this game exercises (Phase 4 radar). At least one; drives per-axis aggregation only.
  readonly axes: readonly SkillAxis[]
}

// Two starter descriptors so the registry/lobby have something concrete to list. Real games land as
// their domain modules + scenes are built out.
export const MINIGAMES: readonly MiniGameMeta[] = [
  {
    id: 'reaction-duel',
    name: 'Reaction Duel',
    format: 'ffa',
    realtime: true,
    durationSec: 0,
    blurb: 'Tap the instant the light turns green. Too early and you are out.',
    axes: ['reflexes'],
  },
  {
    id: 'button-masher',
    name: 'Button Masher',
    format: 'ffa',
    realtime: true,
    durationSec: 10,
    blurb: 'Mash as fast as you can before the timer runs out.',
    axes: ['speed'],
  },
  {
    id: 'color-trap',
    name: 'Color Trap',
    format: 'ffa',
    realtime: true,
    durationSec: 22,
    blurb: 'Tap the INK color of the word, not what it spells. Mind the trap.',
    axes: ['focus'],
  },
  {
    id: 'trivia',
    name: 'Lightning Quiz',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Answer fast — correct answers score, and speed earns a bonus.',
    axes: ['knowledge'],
  },
  {
    id: 'balloon-chicken',
    name: 'Balloon Chicken',
    format: 'ffa',
    realtime: true,
    durationSec: 20,
    blurb: 'Pump for points, but cash out before it bursts — or lose it all.',
    axes: ['nerve'],
  },
  {
    id: 'number-rush',
    name: 'Number Rush',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Tap the numbers 1 to 25 in order as fast as you can.',
    axes: ['focus', 'speed'],
  },
  {
    id: 'quick-math',
    name: 'Quick Math',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Solve as many sums as you can before the timer runs out.',
    axes: ['knowledge'],
  },
  {
    id: 'odd-one-out',
    name: 'Odd One Out',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Spot the one tile that stands out. The grid keeps growing.',
    axes: ['focus'],
  },
  {
    id: 'higher-lower',
    name: 'Higher or Lower',
    format: 'ffa',
    realtime: true,
    durationSec: 22,
    blurb: 'Guess if the next card is higher or lower. One miss ends your run.',
    axes: ['nerve'],
  },
  {
    id: 'bug-smash',
    name: 'Bug Smash',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Smash the bugs, dodge the bombs. Fastest hands win.',
    axes: ['reflexes'],
  },
  {
    id: 'stop-clock',
    name: 'Stop the Clock',
    format: 'ffa',
    realtime: true,
    durationSec: 25,
    blurb: 'Stop the needle as close to the target as you can. Three tries.',
    axes: ['precision'],
  },
  {
    id: 'memory-flash',
    name: 'Memory Flash',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Count the flash — how many of the target colour did you see?',
    axes: ['memory'],
  },
  {
    id: 'simon',
    name: 'Simon',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Watch the sequence, then repeat it. It grows every round.',
    axes: ['memory'],
  },
  {
    id: 'pixel-hoops',
    name: 'Pixel Hoops',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Charge and release to sink the basket. Chain them for combos.',
    axes: ['precision'],
  },
  {
    id: 'pixel-weight',
    name: 'Pixel Weight',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'A pixel object flashes — guess how many pixels it is made of.',
    axes: ['precision', 'memory'],
  },
  {
    id: 'pixel-split',
    name: 'Pixel Split',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Cut the object in two halves with the same number of pixels.',
    axes: ['precision'],
  },
  {
    id: 'tug-of-war',
    name: 'Tug of War',
    format: 'team',
    realtime: true,
    durationSec: 15,
    blurb: 'Two teams, one rope. Mash together to pull the marker to your side.',
    axes: ['speed'],
  },
  {
    id: 'sink-the-fleet',
    name: 'Sink the Fleet',
    format: 'duel',
    realtime: true,
    durationSec: 30,
    blurb: 'Head-to-head Battleship. Take turns firing to sink your rival before they sink you.',
    axes: ['precision'],
  },
  {
    id: 'bomb-relay',
    name: 'Bomb Relay',
    format: 'team',
    realtime: true,
    durationSec: 25,
    blurb: 'Pass the bomb down your team — mash your leg and hand it off before the fuse blows.',
    axes: ['speed'],
  },
  {
    id: 'fruit-catch',
    name: 'Fruit Catch',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Slide your basket to catch the falling fruit — and dodge the bombs.',
    axes: ['reflexes', 'precision'],
  },
  {
    id: 'pixel-rain',
    name: 'Pixel Rain',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Dodge the falling blocks. Last one standing wins.',
    axes: ['reflexes'],
  },
  {
    id: 'pixel-dash',
    name: 'Pixel Dash',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Tap to jump the obstacles as they rush in. Clear the most to win.',
    axes: ['reflexes', 'precision'],
  },
  {
    id: 'snake-arena',
    name: 'Snake Arena',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Eat, grow, and do not crash. The longest snake wins.',
    axes: ['reflexes', 'focus'],
  },
  {
    id: 'pixel-pong',
    name: 'Pixel Pong',
    format: 'duel',
    realtime: true,
    durationSec: 30,
    blurb: 'Head-to-head pong. First to five points takes the duel.',
    axes: ['reflexes', 'precision'],
  },
  {
    id: 'sumo-push',
    name: 'Sumo Push',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Shove everyone else out of the ring. Last sumo standing wins.',
    axes: ['reflexes'],
  },
  {
    id: 'match-pairs',
    name: 'Match',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Flip the cards and clear every matching pair before anyone else.',
    axes: ['memory', 'focus'],
  },
  {
    id: 'quick-draw',
    name: 'Quick Draw',
    format: 'duel',
    realtime: true,
    durationSec: 20,
    blurb: 'Wait for FIRE, then draw first. Flinch early and you lose.',
    axes: ['reflexes'],
  },
  {
    id: 'pixel-roulette',
    name: 'Pixel Roulette',
    format: 'ffa',
    realtime: true,
    durationSec: 15,
    blurb: 'Spin for a random number. Highest wins — pure luck.',
    axes: ['nerve'],
  },
  {
    id: 'sudoku-race',
    name: 'Sudoku Race',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Everyone solves the same mini sudoku. Fastest correct grid wins.',
    axes: ['focus', 'knowledge'],
  },
  {
    id: 'pixel-beat',
    name: 'Pixel Beat',
    format: 'ffa',
    realtime: true,
    durationSec: 40,
    blurb: 'Tap along to the beat before it fades. Timing is everything.',
    axes: ['reflexes'],
  },
  {
    id: 'fleet-battle',
    name: 'Fleet Battle',
    format: 'team',
    realtime: true,
    durationSec: 90,
    blurb: 'Team Battleship — coordinate shots with your squad to sink the enemy fleet first.',
    axes: ['precision'],
  },
  {
    id: 'maze-sprint',
    name: 'Maze Sprint',
    format: 'ffa',
    realtime: true,
    durationSec: 45,
    blurb: 'Race through the same maze as everyone else. Fastest exit wins.',
    axes: ['focus'],
  },
  {
    id: 'line-clear-sprint',
    name: 'Line Clear Sprint',
    format: 'ffa',
    realtime: true,
    durationSec: 60,
    blurb: 'Stack pixels, clear lines, beat the clock. Most lines wins.',
    axes: ['precision'],
  },
  {
    id: 'quick-tetris',
    name: 'Quick Tetris',
    format: 'ffa',
    realtime: true,
    durationSec: 45,
    blurb: 'A short, frantic Tetris sprint — first to clear the target lines wins.',
    axes: ['speed'],
  },
  {
    id: 'bubble-pop',
    name: 'Bubble Pop',
    format: 'ffa',
    realtime: true,
    durationSec: 60,
    blurb: 'Shoot color-matched bubbles to pop clusters of three or more. Clear the board fastest.',
    axes: ['precision'],
  },
]

export const MINIGAMES_BY_ID: ReadonlyMap<MiniGameId, MiniGameMeta> = new Map(
  MINIGAMES.map((m) => [m.id, m]),
)
