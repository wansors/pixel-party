// Lightweight in-memory counters for Phase 1 observability (no external telemetry backend). Monotonic
// counters incremented across the WS/HTTP layer; live gauges (active rooms, running sessions) are
// merged in at read time by the caller, which owns the registry/session-manager references.
export type MetricKey =
  | 'rooms_created'
  | 'players_joined'
  | 'rejoins'
  | 'disconnects'
  | 'kicks'
  | 'host_transfers'
  | 'sessions_started'
  | 'messages'
  | 'errors'
  | 'rooms_reaped'

export interface Metrics {
  inc(key: MetricKey, n?: number): void
  snapshot(): Record<string, number>
}

export function createMetrics(): Metrics {
  const counters = new Map<string, number>()
  return {
    inc(key, n = 1) {
      counters.set(key, (counters.get(key) ?? 0) + n)
    },
    snapshot() {
      return Object.fromEntries(counters)
    },
  }
}
