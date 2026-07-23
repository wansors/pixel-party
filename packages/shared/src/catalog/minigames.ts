// Mini-game catalog metadata — shared by both apps. The pure per-game logic lives server-side in
// apps/server/src/domain/minigames/; this is the wire-facing descriptor the lobby/host UI reads and the
// engine uses to pick a session line-up. Adding a game = one domain module + one client scene + one
// entry here.

export type MiniGameFormat = 'ffa' | 'duel' | 'team'

export type MiniGameId = string

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
  },
  {
    id: 'button-masher',
    name: 'Button Masher',
    format: 'ffa',
    realtime: true,
    durationSec: 10,
    blurb: 'Mash as fast as you can before the timer runs out.',
  },
  {
    id: 'color-trap',
    name: 'Color Trap',
    format: 'ffa',
    realtime: true,
    durationSec: 22,
    blurb: 'Tap the INK color of the word, not what it spells. Mind the trap.',
  },
  {
    id: 'trivia',
    name: 'Lightning Quiz',
    format: 'ffa',
    realtime: true,
    durationSec: 48,
    blurb: 'Answer fast — correct answers score, and speed earns a bonus.',
  },
  {
    id: 'balloon-chicken',
    name: 'Balloon Chicken',
    format: 'ffa',
    realtime: true,
    durationSec: 20,
    blurb: 'Pump for points, but cash out before it bursts — or lose it all.',
  },
  {
    id: 'number-rush',
    name: 'Number Rush',
    format: 'ffa',
    realtime: true,
    durationSec: 40,
    blurb: 'Tap the numbers 1 to 25 in order as fast as you can.',
  },
  {
    id: 'quick-math',
    name: 'Quick Math',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Solve as many sums as you can before the timer runs out.',
  },
  {
    id: 'odd-one-out',
    name: 'Odd One Out',
    format: 'ffa',
    realtime: true,
    durationSec: 40,
    blurb: 'Spot the one tile that stands out. The grid keeps growing.',
  },
  {
    id: 'higher-lower',
    name: 'Higher or Lower',
    format: 'ffa',
    realtime: true,
    durationSec: 22,
    blurb: 'Guess if the next card is higher or lower. One miss ends your run.',
  },
  {
    id: 'bug-smash',
    name: 'Bug Smash',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Smash the bugs, dodge the bombs. Fastest hands win.',
  },
  {
    id: 'stop-clock',
    name: 'Stop the Clock',
    format: 'ffa',
    realtime: true,
    durationSec: 25,
    blurb: 'Stop the needle as close to the target as you can. Three tries.',
  },
  {
    id: 'memory-flash',
    name: 'Memory Flash',
    format: 'ffa',
    realtime: true,
    durationSec: 40,
    blurb: 'Count the flash — how many of the target colour did you see?',
  },
  {
    id: 'simon',
    name: 'Simon',
    format: 'ffa',
    realtime: true,
    durationSec: 60,
    blurb: 'Watch the sequence, then repeat it. It grows every round.',
  },
  {
    id: 'pixel-hoops',
    name: 'Pixel Hoops',
    format: 'ffa',
    realtime: true,
    durationSec: 30,
    blurb: 'Charge and release to sink the basket. Chain them for combos.',
  },
  {
    id: 'pixel-weight',
    name: 'Pixel Weight',
    format: 'ffa',
    realtime: true,
    durationSec: 40,
    blurb: 'A pixel object flashes — guess how many pixels it is made of.',
  },
  {
    id: 'pixel-split',
    name: 'Pixel Split',
    format: 'ffa',
    realtime: true,
    durationSec: 40,
    blurb: 'Cut the object in two halves with the same number of pixels.',
  },
  {
    id: 'tug-of-war',
    name: 'Tug of War',
    format: 'team',
    realtime: true,
    durationSec: 15,
    blurb: 'Two teams, one rope. Mash together to pull the marker to your side.',
  },
]

export const MINIGAMES_BY_ID: ReadonlyMap<MiniGameId, MiniGameMeta> = new Map(
  MINIGAMES.map((m) => [m.id, m]),
)
