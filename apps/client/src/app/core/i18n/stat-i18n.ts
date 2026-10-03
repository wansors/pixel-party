// The server's per-round result stats (`NormalizedResult.stats`: "40 banked", "streak 7", "0.42 off")
// are short presentational strings built in English by every mini-game's domain module. Instead of
// threading structured stats through 55 modules and the wire, the client translates their small, fixed
// vocabulary: each English word maps to a `room.stat.<key>` entry, and `room.stat.decimal` sets the
// decimal mark. A word missing here simply shows in English — add it when a game introduces one.
const STAT_WORDS: Readonly<Record<string, string>> = {
  'finished in': 'finishedIn',
  'false start': 'falseStart',
  'no tap': 'noTap',
  'cleared!': 'clearedAll',
  banked: 'banked',
  burst: 'burst',
  passes: 'passes',
  taps: 'taps',
  correct: 'correct',
  sunk: 'sunk',
  NM: 'noMark',
  DNF: 'dnf',
  LAP: 'lap',
  lines: 'lines',
  streak: 'streak',
  done: 'done',
  pairs: 'pairs',
  level: 'level',
  cleared: 'cleared',
  long: 'long',
  right: 'right',
  wrong: 'wrong',
  pulls: 'pulls',
  solved: 'solved',
  off: 'off',
  steps: 'steps',
}

// One pass over the whole string (longest phrases first), so a translated word is never re-matched.
const STAT_PATTERN = new RegExp(
  `(?<![\\p{L}])(${Object.keys(STAT_WORDS)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?![\\p{L}])`,
  'gu',
)

export function localizeStat(stat: string, words: Readonly<Record<string, unknown>>): string {
  const out = stat.replace(STAT_PATTERN, (en) => {
    const word = words[STAT_WORDS[en] ?? '']
    return typeof word === 'string' && word !== '' ? word : en
  })
  const decimal = words['decimal']
  return typeof decimal === 'string' && decimal !== '.'
    ? out.replace(/(\d)\.(\d)/g, `$1${decimal}$2`)
    : out
}
