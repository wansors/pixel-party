// Player names travel to every screen in the room, so the server cleans whatever a client sends with
// the same rules the join form applies.
export const MAX_NAME_LEN = 16

// Control and format characters out (newlines, bidi overrides, zero-width joiners), runs of spaces
// collapsed, trimmed, then cut to MAX_NAME_LEN characters (code points, so an emoji isn't split).
export function cleanName(raw: string): string {
  const flat = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return [...flat].slice(0, MAX_NAME_LEN).join('').trim()
}
