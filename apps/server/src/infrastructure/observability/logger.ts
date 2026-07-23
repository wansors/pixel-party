export type LogLevel = 'info' | 'warn' | 'error'

// Structured JSON logging for room/session lifecycle events: one line per event on stdout — cheap to
// grep locally or ship to a log collector. Infrastructure layer, so wall-clock timestamps are fine
// (the domain determinism gate does not apply here).
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

export function createLogger(): Logger {
  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }
  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  }
}
