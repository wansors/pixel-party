import type { SessionManager } from '../../../application/session/SessionManager'

export interface SimulationLoopHandle {
  stop(): void
  // Test seam: drive N ticks synchronously without the wall clock.
  stepTick(n?: number): void
}

// Fixed-timestep driver: advances every active session engine at TICK_HZ. Party mini-games don't need
// 60 Hz. The setInterval is the only wall-clock pacing; all game logic reads time via the Clock port.
export function buildSimulationLoop(manager: SessionManager, tickHz: number): SimulationLoopHandle {
  const intervalMs = 1000 / tickHz
  const timer = setInterval(() => manager.tickAll(), intervalMs)
  return {
    stop() {
      clearInterval(timer)
    },
    stepTick(n = 1) {
      for (let i = 0; i < n; i++) manager.tickAll()
    },
  }
}
