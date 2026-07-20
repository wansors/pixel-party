import type { Clock } from '../../../application/ports/Clock'

export class SystemClock implements Clock {
  now(): number {
    return Date.now()
  }
}
