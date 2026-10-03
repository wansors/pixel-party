import { localizeStat } from './stat-i18n'

describe('localizeStat', () => {
  const es = {
    decimal: ',',
    banked: 'guardados',
    streak: 'racha',
    falseStart: 'salida nula',
    finishedIn: 'terminado en',
    right: 'bien',
    wrong: 'mal',
    off: 'de error',
    lap: 'VUELTA',
  }

  it('translates the stat vocabulary and keeps numbers and units', () => {
    expect(localizeStat('40 banked', es)).toBe('40 guardados')
    expect(localizeStat('streak 7', es)).toBe('racha 7')
    expect(localizeStat('false start', es)).toBe('salida nula')
    expect(localizeStat('2 right · 1 wrong', es)).toBe('2 bien · 1 mal')
    expect(localizeStat('LAP 2', es)).toBe('VUELTA 2')
    expect(localizeStat('3/5 · 4210 pts', es)).toBe('3/5 · 4210 pts')
  })

  it('switches the decimal mark', () => {
    expect(localizeStat('finished in 12.3s', es)).toBe('terminado en 12,3s')
    expect(localizeStat('0.42 off', es)).toBe('0,42 de error')
    expect(localizeStat('1:23.4', es)).toBe('1:23,4')
  })

  it('leaves unknown words and English bundles alone', () => {
    expect(localizeStat('7 widgets', es)).toBe('7 widgets')
    expect(localizeStat('0.42 off', { decimal: '.', off: 'off' })).toBe('0.42 off')
    expect(localizeStat('40 banked', {})).toBe('40 banked')
  })
})
