// Pixel Roulette bot: spins a random moment into the round.
export default function play(s: { spun: Record<string, boolean> }, me: string): unknown {
  return s.spun[me] === false && Math.random() < 0.15 ? { kind: 'spin' } : null
}
