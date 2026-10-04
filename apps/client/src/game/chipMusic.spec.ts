import { MINIGAMES } from '@pp/shared'
import { CHIP_SONGS } from './chipMusic'
import { roundMusic } from './musicMoods'

const LEAD_TOKEN = /^(\.|-|\d+)$/
const DRUM_TOKEN = /^[kshx.]$/

describe('chip songs', () => {
  const songs = Object.values(CHIP_SONGS).flat()

  it('every mood has at least one song', () => {
    for (const list of Object.values(CHIP_SONGS)) expect(list.length).toBeGreaterThan(0)
  })

  it('every pattern is one bar of 16 valid steps', () => {
    for (const song of songs) {
      for (const pattern of [...song.lead, song.arp, song.bass]) {
        const toks = pattern.trim().split(/\s+/)
        expect(toks.length).toBe(16)
        for (const t of toks) expect(LEAD_TOKEN.test(t)).toBe(true)
        expect(toks[0]).not.toBe('-')
      }
      for (const pattern of song.drums) {
        const toks = pattern.trim().split(/\s+/)
        expect(toks.length).toBe(16)
        for (const t of toks) expect(DRUM_TOKEN.test(t)).toBe(true)
      }
      expect(song.chords.length).toBeGreaterThan(0)
    }
  })
})

describe('roundMusic', () => {
  it('silences the games whose own sound is the game', () => {
    expect(roundMusic('pixel-beat')).toBe('none')
    expect(roundMusic('freeze-doll')).toBe('none')
    expect(roundMusic('simon')).toBe('none')
  })

  it('gives every game a mood', () => {
    for (const g of MINIGAMES) {
      expect(['action', 'think', 'tension', 'results', 'none']).toContain(roundMusic(g.id))
    }
  })
})
