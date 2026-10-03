// Color Trap (Stroop) wire shapes. A color WORD is drawn in a mismatched INK color; tap the button
// matching the ink, not the word it spells: +1, while a wrong color costs a point. The prompt sequence
// is common to everyone (seeded server side); the authoritative scoring lives in the domain module.

export interface ColorTrapColor {
  name: string
  // 0xRRGGBB for the Phaser canvas.
  hex: number
}

// Shared palette so client buttons and server prompt indices agree. Index === wire value.
export const COLOR_TRAP_COLORS: readonly ColorTrapColor[] = [
  { name: 'RED', hex: 0xe63946 },
  { name: 'GREEN', hex: 0x2a9d3f },
  { name: 'BLUE', hex: 0x3a7bd5 },
  { name: 'YELLOW', hex: 0xf4c20d },
]

export const COLOR_TRAP_COLOR_COUNT = COLOR_TRAP_COLORS.length

export interface ColorTrapSnapshot {
  // 0-based index of the active prompt; total prompts in the sequence.
  index: number
  total: number
  // Active prompt: `word` = color index spelled by the text, `ink` = color index it is drawn in.
  // null between/after prompts.
  word: number | null
  ink: number | null
  // ms left in the current prompt window.
  promptRemainingMs: number
  // playerId -> points so far (right answers minus wrong ones; can go negative).
  scores: Record<string, number>
  // players who already locked an answer for the current prompt.
  answeredCurrent: string[]
}

// Answer for a specific prompt index (server ignores stale/duplicate answers, and takes the previous
// prompt's answer only for a short grace period after it closed — so the client must stop taking taps
// once its own clock runs the prompt out). `color` is the tapped ink-color index; correct when it
// equals the prompt's ink.
export interface ColorTrapInput {
  kind: 'answer'
  prompt: number
  color: number
}
