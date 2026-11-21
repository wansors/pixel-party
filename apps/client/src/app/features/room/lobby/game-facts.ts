import { fitsPlayers, type MiniGameId } from '@pp/shared'

// Small formatters shared by the game picker's cards and the game sheet.

// "3-8" — a player range (one number when both ends match).
export function playerRange(lo: number, hi: number): string {
  return lo === hi ? `${lo}` : `${lo}-${hi}`
}

// "45s" / "1:40" — a game's round length.
export function roundLength(sec: number): string {
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

// Why a game can't be picked right now: the headcount is outside its range, or a team is empty.
export function unfitReason(id: MiniGameId, connected: number): 'range' | 'teams' {
  return fitsPlayers(id, connected) ? 'teams' : 'range'
}
