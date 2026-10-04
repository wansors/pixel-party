import { MINIGAMES_BY_ID, type MiniGameId } from '@pp/shared'
import type { ChipMood } from './chipMusic'

// Which in-round music a mini-game plays under (D32). `none` where the game's own sound IS the game:
// a rhythm to tap along to, the doll's chant whose tempo is the tell, Simon's pad tones.
export type RoundMusic = ChipMood | 'none'

const BY_GAME: Partial<Record<MiniGameId, RoundMusic>> = {
  'pixel-beat': 'none',
  'freeze-doll': 'none',
  simon: 'none',
  'reaction-duel': 'tension',
  'quick-draw': 'tension',
  'glass-bridge': 'tension',
  'balloon-chicken': 'tension',
  'higher-lower': 'tension',
  'pixel-roulette': 'tension',
  'marbles-duel': 'tension',
  'honeycomb-cut': 'tension',
  'stop-clock': 'tension',
  'color-trap': 'think',
  'bubble-pop': 'think',
  'maze-sprint': 'think',
  'sink-the-fleet': 'think',
  'fleet-battle': 'think',
}

// Explicit choice first; otherwise from the game's skill axes: brainy games think, nerve games are
// tense, everything else (reflexes, speed, precision) is action.
export function roundMusic(id: MiniGameId): RoundMusic {
  const explicit = BY_GAME[id]
  if (explicit) return explicit
  const axes = MINIGAMES_BY_ID.get(id)?.axes ?? []
  if (axes.some((a) => a === 'knowledge' || a === 'memory')) return 'think'
  if (axes[0] === 'nerve') return 'tension'
  return 'action'
}
