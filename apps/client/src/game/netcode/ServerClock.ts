// The server's round clock, estimated on this client from snapshots' `remainingMs`.
//
// Games whose motion is a pure function of time (falling fruit and blocks, obstacles rushing in) don't
// need interpolation: they extrapolate each snapshot forward on this clock, so what you see is where the
// server judges it — not ~100–250 ms behind, as an interpolation buffer renders. The estimate keeps the
// least-delayed snapshot seen (`arrival + remainingMs` is smallest for the snapshot that travelled
// fastest), so a late packet never makes the picture jump back, and the clock runs smoothly between
// snapshots. Framework-free, like SnapshotInterpolator.
export class ServerClock {
  // Client time at which the round's remaining time reaches 0, as best estimated so far.
  private endsAt = Number.POSITIVE_INFINITY

  // Record a fresh snapshot's `remainingMs` with the client time it arrived.
  sync(remainingMs: number, now: number): void {
    // A snapshot stamped at the buzzer (remainingMs clamped to 0) says nothing about the offset.
    if (remainingMs > 0) this.endsAt = Math.min(this.endsAt, now + remainingMs)
  }

  // Server milliseconds elapsed since a snapshot that reported `remainingMs` was taken (0 before the
  // first sync).
  since(remainingMs: number, now: number): number {
    if (!Number.isFinite(this.endsAt)) return 0
    return Math.max(0, remainingMs - (this.endsAt - now))
  }

  reset(): void {
    this.endsAt = Number.POSITIVE_INFINITY
  }
}
