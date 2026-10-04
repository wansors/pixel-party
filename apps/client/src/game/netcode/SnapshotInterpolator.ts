// Client-side snapshot interpolation for real-time mini-games (Phase 5 netcode hardening).
//
// The server is authoritative and broadcasts ROUND_STATE snapshots at a throttled rate (~6.7 Hz with
// the default snapshotEveryNTicks). Rendering the latest snapshot directly makes continuous motion
// (a bouncing ball, falling fruit) stutter. This buffers the two most recent snapshots and, given the
// current client time, yields the pair to lerp between with a fraction `t`, rendering ~renderDelayMs in
// the past so there is always a "next" snapshot to interpolate toward.
//
// Deliberately dumb and framework-free: it stores snapshots + client arrival times and computes `t`.
// The scene decides which fields to lerp (positions), leaving discrete fields (scores) read from `to`.
export class SnapshotInterpolator<T> {
  private prev?: { at: number; snap: T }
  private curr?: { at: number; snap: T }

  // The delay must cover the snapshot interval (150 ms at 20 Hz / every 3 ticks): shorter, and every
  // snapshot plays as a freeze then a jump, because render time catches up with the newest snapshot.
  constructor(private readonly renderDelayMs = 150) {}

  // Record a freshly received snapshot with the client time it arrived.
  push(snap: T, now: number): void {
    // Ignore a duplicate push at the same instant (e.g. same tick re-delivered) to keep spans sane.
    if (this.curr && this.curr.at === now) {
      this.curr = { at: now, snap }
      return
    }
    this.prev = this.curr
    this.curr = { at: now, snap }
  }

  // The freshest snapshot (for reading discrete/authoritative fields like scores or game-over).
  latest(): T | undefined {
    return this.curr?.snap
  }

  // The pair to interpolate between plus `t` in [0,1]. Before two snapshots exist it returns the single
  // snapshot with t=1 (nothing to interpolate). `now` is the current client clock (e.g. scene time.now).
  sample(now: number): { from: T; to: T; t: number } | undefined {
    if (!this.curr) return undefined
    if (!this.prev) return { from: this.curr.snap, to: this.curr.snap, t: 1 }
    const renderTime = now - this.renderDelayMs
    const span = this.curr.at - this.prev.at
    if (span <= 0) return { from: this.prev.snap, to: this.curr.snap, t: 1 }
    const t = Math.max(0, Math.min(1, (renderTime - this.prev.at) / span))
    return { from: this.prev.snap, to: this.curr.snap, t }
  }

  reset(): void {
    this.prev = undefined
    this.curr = undefined
  }
}

// Scalar linear interpolation helper scenes can use on individual fields.
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
