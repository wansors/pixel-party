// Stop the Clock bot: stops near the target every so often, some bots sloppier than others.
type Snap = { targets: number[]; attempts: number; attemptsDone: Record<string, number> }

export default function play(s: Snap, me: string): unknown {
  const attempt = s.attemptsDone[me]
  if (attempt === undefined || attempt >= s.attempts || Math.random() > 0.15) return null
  const sloppiness = 0.02 + (me.charCodeAt(1) % 4) * 0.04
  const pos = (s.targets[attempt] ?? 0.5) + (Math.random() * 2 - 1) * sloppiness
  return { kind: 'stop', attempt, pos }
}
