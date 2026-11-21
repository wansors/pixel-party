// Bar Rush wire shapes and the bar rules shared by the server and the client's prediction (D52). A
// bar-serving rush: everyone tends their own four bars against the same seeded crowd. Customers walk
// in from the door toward your end of the bar; you slide a drink down the bar you're on, the first
// customer in its way catches it and is pushed back toward the door, drinks, and slides the empty
// glass back — catch it at your end or it smashes. A drink nobody catches smashes at
// the door; a customer who reaches your end leaves angry. Customers come faster and walk faster as the
// round goes on (D40). Highest score wins.
//
// The board is integrated on a fixed BAR.dtMs grid with plain arithmetic only, so the server and the
// client compute the very same bar from the same commands. Commands (switch bar / serve) carry the
// time they were pressed and the server judges BAR.judgeMs behind real time, so the client predicts its
// own bar bit for bit.

export const BAR = {
  lanes: 4,
  startDelayMs: 1500,
  dtMs: 10,
  judgeMs: 150,
  // x runs from the door (0) to your end (1): you serve from `tapX`; a customer reaching `angryX` is
  // angry; an empty glass reaching `tapX` is caught (if you're on that bar) or smashes.
  tapX: 0.96,
  angryX: 0.92,
  serveCooldownMs: 260,
  // Speeds in bar-lengths per second.
  drinkSpeed: 1.3,
  emptySpeed: 0.5,
  slideSpeed: 0.9,
  // A caught drink pushes its customer back this long, then they drink.
  slideMs: 300,
  drinkMs: 900,
  // How close (bar-lengths) a drink must come to catch a customer.
  reach: 0.035,
  points: { serve: 1, catch: 1, smash: -2, angry: -3 },
} as const

export interface BarArrival {
  // Round time the customer walks in, on which bar, how many drinks they want, their walking speed
  // and look (cosmetic: an index into the avatar set).
  at: number
  lane: number
  wants: number
  speed: number
  look: number
}

// Customer states.
export const BAR_WALK = 0
export const BAR_SLIDE = 1
export const BAR_DRINK = 2

export interface BarCustomer {
  // Index into the arrivals (stable id, and the look).
  id: number
  lane: number
  x: number
  wants: number
  state: number
  until: number
}

export interface BarGlass {
  lane: number
  x: number
  // true = a drink sliding toward the door; false = an empty glass sliding back to you.
  full: boolean
}

export interface BarBody {
  t: number
  lane: number
  canServeAt: number
  customers: BarCustomer[]
  glasses: BarGlass[]
  // The next arrival to walk in.
  next: number
  score: number
  // Drinks served, empties caught, glasses smashed, angry customers, and when you last served (for
  // the result and the client's sounds).
  served: number
  caught: number
  smashed: number
  angry: number
  servedAt: number
}

export interface BarCmd {
  // Round time it was pressed (snapped to the grid): move to bar `lane` and/or serve.
  at: number
  lane?: number
  serve?: boolean
}

export const barSnap = (t: number): number => Math.ceil(t / BAR.dtMs) * BAR.dtMs

export function barNewBody(t: number = BAR.startDelayMs): BarBody {
  return {
    t,
    lane: 0,
    canServeAt: t,
    customers: [],
    glasses: [],
    next: 0,
    score: 0,
    served: 0,
    caught: 0,
    smashed: 0,
    angry: 0,
    servedAt: -1e9,
  }
}

export const barClone = (b: BarBody): BarBody => ({
  ...b,
  customers: b.customers.map((c) => ({ ...c })),
  glasses: b.glasses.map((g) => ({ ...g })),
})

const add = (b: BarBody, pts: number): void => {
  b.score = Math.max(0, b.score + pts)
}

// One integration step (BAR.dtMs): let customers in, take the command due (move, then serve), walk /
// push / drink the customers, slide the glasses, then settle catches and smashes.
export function barStep(b: BarBody, cmd: BarCmd | null, arrivals: readonly BarArrival[]): void {
  const t = b.t
  const dt = BAR.dtMs / 1000
  while (b.next < arrivals.length && (arrivals[b.next] as BarArrival).at <= t) {
    const a = arrivals[b.next] as BarArrival
    b.customers.push({ id: b.next, lane: a.lane, x: 0, wants: a.wants, state: BAR_WALK, until: 0 })
    b.next += 1
  }
  if (cmd) {
    if (typeof cmd.lane === 'number' && cmd.lane >= 0 && cmd.lane < BAR.lanes) b.lane = cmd.lane
    if (cmd.serve && t >= b.canServeAt) {
      b.glasses.push({ lane: b.lane, x: BAR.tapX, full: true })
      b.canServeAt = t + BAR.serveCooldownMs
      b.servedAt = t
    }
  }
  const kept: BarCustomer[] = []
  for (const c of b.customers) {
    const a = arrivals[c.id] as BarArrival
    if (c.state === BAR_WALK) {
      c.x += a.speed * dt
      if (c.x >= BAR.angryX) {
        add(b, BAR.points.angry)
        b.angry += 1
        continue
      }
    } else if (c.state === BAR_SLIDE) {
      // Pushed back toward the door (no further than it).
      c.x = Math.max(0, c.x - BAR.slideSpeed * dt)
      if (t >= c.until) {
        c.state = BAR_DRINK
        c.until = t + BAR.drinkMs
      }
    } else if (t >= c.until) {
      b.glasses.push({ lane: c.lane, x: c.x, full: false })
      if (c.wants <= 0) continue
      c.state = BAR_WALK
    }
    kept.push(c)
  }
  b.customers = kept
  const glasses: BarGlass[] = []
  for (const g of b.glasses) {
    if (g.full) {
      const from = g.x
      g.x -= BAR.drinkSpeed * dt
      // The walking customer nearest your end that this drink reached.
      let hit = null as BarCustomer | null
      for (const c of b.customers) {
        if (c.lane !== g.lane || c.state !== BAR_WALK) continue
        if (c.x <= from + BAR.reach && c.x >= g.x - BAR.reach && (!hit || c.x > hit.x)) hit = c
      }
      if (hit) {
        hit.wants -= 1
        hit.state = BAR_SLIDE
        hit.until = t + BAR.slideMs
        add(b, BAR.points.serve)
        b.served += 1
        continue
      }
      if (g.x < 0) {
        add(b, BAR.points.smash)
        b.smashed += 1
        continue
      }
    } else {
      g.x += BAR.emptySpeed * dt
      if (g.x >= BAR.tapX) {
        if (b.lane === g.lane) {
          add(b, BAR.points.catch)
          b.caught += 1
        } else {
          add(b, BAR.points.smash)
          b.smashed += 1
        }
        continue
      }
    }
    glasses.push(g)
  }
  b.glasses = glasses
  b.t = t + BAR.dtMs
}

// Carries a bar forward to `until` (round ms, on the grid), taking the commands (snapped, ascending)
// at their times; several due at one step merge (the last bar wins, any serve serves).
export function barRun(
  b: BarBody,
  until: number,
  cmds: readonly BarCmd[],
  arrivals: readonly BarArrival[],
): void {
  let i = 0
  while (i < cmds.length && (cmds[i] as BarCmd).at < b.t) i++
  while (b.t < until) {
    let merged = null as BarCmd | null
    while (i < cmds.length && (cmds[i] as BarCmd).at <= b.t) {
      const c = cmds[i] as BarCmd
      merged = {
        at: c.at,
        lane: typeof c.lane === 'number' ? c.lane : merged?.lane,
        serve: merged?.serve || c.serve,
      }
      i++
    }
    barStep(b, merged, arrivals)
  }
}

export interface BarBoardView {
  // Judged bar at body.t...
  body: BarBody
  // ...and the commands already pressed after it.
  cmds: BarCmd[]
  // The last input `seq` the server has taken (0 = none).
  ack: number
}

export interface BarRushSnapshot {
  // The seeded crowd, the same for everyone.
  arrivals: BarArrival[]
  boards: Record<string, BarBoardView>
  // Round time (ms since the round started — GO is at BAR.startDelayMs) at this snapshot.
  t: number
  // playerId -> score, for the live standings.
  progress: Record<string, number>
  remainingMs: number
}

// Move to bar `lane` (0 = top) and/or serve a drink there. `at` = when it was pressed.
export interface BarRushInput {
  kind: 'bar'
  lane?: number
  serve?: boolean
  at?: number
  seq?: number
}
