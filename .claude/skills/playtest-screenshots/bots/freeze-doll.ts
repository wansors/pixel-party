// Freeze Doll bot: walks while the doll sings (running early in the chant), stops on the first twitch.
type Snap = { light: string; songMs: number; songElapsedMs: number }

export default function play(s: Snap): unknown {
  if (s.light !== 'green') return { kind: 'move', mode: 'stop' }
  const left = s.songMs - s.songElapsedMs
  return { kind: 'move', mode: left > 1500 ? 'run' : left > 600 ? 'walk' : 'stop' }
}
