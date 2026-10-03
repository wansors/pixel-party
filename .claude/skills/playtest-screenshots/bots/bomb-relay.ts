// Bomb Relay bot: mashes ~10 times a second while it holds its team's bomb. One bot in four dozes off
// instead, to show the idle skip.
type Snap = { teams: Record<string, { holderId: string }>; playerTeam: Record<string, string> }

export default function play(s: Snap, me: string): unknown {
  const team = s.playerTeam[me]
  if (!team || s.teams[team]?.holderId !== me || me.charCodeAt(0) % 4 === 0) return null
  return Math.random() < 0.5 ? [{ kind: 'mash' }, { kind: 'mash' }] : { kind: 'mash' }
}
