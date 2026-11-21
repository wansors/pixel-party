// Rock Paper Scissors bot: throws a random hand a beat into each throw (so the browser player sees the
// rival's READY), and sometimes dawdles past the window — like a person who can't decide.
type Hand = 'rock' | 'paper' | 'scissors'
interface View {
  opponentId: string | null
  phase: 'choose' | 'reveal' | 'done'
  youChose: boolean
  msLeft: number
  chooseMs: number
}
interface Snap {
  players: Record<string, View>
}
const HANDS: Hand[] = ['rock', 'paper', 'scissors']

export default function play(snapshot: unknown, me: string): unknown {
  const v = (snapshot as Snap)?.players?.[me]
  if (!v?.opponentId || v.phase !== 'choose' || v.youChose) return null
  if (v.chooseMs - v.msLeft < 700 || Math.random() < 0.15) return null
  return { kind: 'throw', hand: HANDS[Math.floor(Math.random() * 3)] }
}
