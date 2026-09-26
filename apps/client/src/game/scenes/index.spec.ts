import { MINIGAMES } from '@pp/shared'
import { SCENES } from '.'

describe('SCENES registry', () => {
  it('maps every catalog mini-game to exactly one scene', () => {
    expect(Object.keys(SCENES).sort()).toEqual(MINIGAMES.map((g) => g.id).sort())
  })
})
