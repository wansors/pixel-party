// Injected so the domain stays deterministic: mini-game logic draws randomness only through this port,
// seeded per round, so "same board for everyone" games are reproducible and server-validatable.
export interface Random {
  next(): number // 0..1
}
