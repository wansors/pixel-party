// Room Rush wire shapes ("Mingle"). A real-time FFA elimination round in a top-down arena: a slowly
// rotating carousel in the middle and ROOM_RUSH.slots small rooms around the edge, each with a door
// facing the centre. Every call runs in phases:
//   music  — everyone is held on the turning carousel; the doors stay shut;
//   call   — a number N is called and the doors of ⌊(survivors − 1) ÷ N⌋ rooms open. A room that has
//            held exactly N players for ROOM_RUSH.lockMs locks (door slams, those inside are safe);
//   reveal — the buzzer went: anyone not in a locked room (or one holding exactly N) is eliminated.
// Players steer and dash (a short shove-y burst) with sumo-style bouncy collisions. The server owns the
// physics, the rooms and every elimination; geometry is shared so both sides draw the same walls.

export const ROOM_RUSH = {
  slots: 10,
  // Room centres sit on a circle of this radius around the arena centre (0.5, 0.5).
  roomR: 0.4,
  // Half the side of a (square) room, and half the width of its door.
  half: 0.075,
  door: 0.034,
  carouselR: 0.18,
  playerR: 0.03,
  lockMs: 500,
} as const

// Angle (radians) of a room slot around the arena centre — slot 0 at the top, clockwise on screen.
export function roomRushSlotAngle(slot: number): number {
  return -Math.PI / 2 + (slot * Math.PI * 2) / ROOM_RUSH.slots
}

export type RoomRushPhase = 'music' | 'call' | 'reveal'

export interface RoomRushRoom {
  slot: number
  // Players inside right now, and how long the room has held exactly N (0…ROOM_RUSH.lockMs).
  count: number
  holdMs: number
  locked: boolean
}

export interface RoomRushPlayer {
  id: string
  x: number
  y: number
  alive: boolean
  // Inside a locked room this call.
  safe: boolean
  // Dash cooldown left (0 = ready).
  dashMs: number
}

export interface RoomRushSnapshot {
  phase: RoomRushPhase
  phaseMs: number
  phaseTotalMs: number
  // 1-based call number; `n` is the number called (0 during the music).
  call: number
  n: number
  carouselAngle: number
  // The rooms open this call (empty during the music).
  rooms: RoomRushRoom[]
  players: RoomRushPlayer[]
  // Eliminated by the last buzzer (shown during the reveal).
  outThisCall: string[]
  remainingMs: number
}

// move: steer with a direction vector (normalized server-side; {0,0} = coast). dash: a short burst in
// the steering direction (cooldown-limited).
export type RoomRushInput = { kind: 'move'; dx: number; dy: number } | { kind: 'dash' }
