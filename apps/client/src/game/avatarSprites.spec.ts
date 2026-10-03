import { AVATARS } from '@pp/shared'
import {
  AVATAR_SIZE,
  type AvatarExpression,
  type AvatarPose,
  avatarPalette,
  avatarPixels,
  toAvatarId,
} from './avatarSprites'

const POSES: AvatarPose[] = ['front', 'side', 'back']
const EXPRESSIONS: AvatarExpression[] = ['idle', 'blink', 'happy', 'hurt', 'ko']

describe('avatar sprites', () => {
  it('draws every avatar, pose and expression as a 16x16 grid', () => {
    for (const avatar of AVATARS) {
      for (const pose of POSES) {
        for (const expression of EXPRESSIONS) {
          const grid = avatarPixels(avatar, pose, expression)
          expect(grid.length).toBe(AVATAR_SIZE)
          for (const row of grid) expect(row.length).toBe(AVATAR_SIZE)
        }
      }
    }
  })

  it('keeps the whole outlined sprite inside the grid', () => {
    for (const avatar of AVATARS) {
      for (const pose of POSES) {
        const grid = avatarPixels(avatar, pose)
        // The outline wraps the silhouette, so nothing but outline ever touches the border.
        grid.forEach((row, y) => {
          row.forEach((role, x) => {
            const border = x === 0 || y === 0 || x === AVATAR_SIZE - 1 || y === AVATAR_SIZE - 1
            if (border && role !== null)
              expect(`${avatar}/${pose} ${x},${y}:${role}`).toContain(':O')
          })
        })
      }
    }
  })

  it('shows two eyes from the front, one from the side and none from the back', () => {
    const pupils = (avatar: (typeof AVATARS)[number], pose: AvatarPose): number =>
      avatarPixels(avatar, pose)
        .flat()
        .filter((r) => r === 'W').length
    for (const avatar of AVATARS) {
      expect(pupils(avatar, 'front')).toBe(2)
      expect(pupils(avatar, 'side')).toBe(1)
      expect(pupils(avatar, 'back')).toBe(0)
    }
  })

  it('changes the eyes with the expression', () => {
    const idle = JSON.stringify(avatarPixels('cat', 'front', 'idle'))
    for (const e of EXPRESSIONS.filter((x) => x !== 'idle')) {
      expect(JSON.stringify(avatarPixels('cat', 'front', e))).not.toBe(idle)
    }
  })

  it('draws the stride frames on the feet row only', () => {
    for (const avatar of AVATARS) {
      for (const pose of POSES) {
        const still = avatarPixels(avatar, pose, 'idle', 0)
        const steps = pose === 'side' ? [1] : [1, 2]
        for (const step of steps as (1 | 2)[]) {
          const moving = avatarPixels(avatar, pose, 'idle', step)
          expect(JSON.stringify(moving)).not.toBe(JSON.stringify(still))
          // Everything above the feet (and their outline row) is untouched.
          expect(JSON.stringify(moving.slice(0, 13))).toBe(JSON.stringify(still.slice(0, 13)))
        }
      }
    }
  })

  it('derives the palette from the identity color', () => {
    const p = avatarPalette(0xff3e7f)
    expect(p.B).toBe(0xff3e7f)
    expect(p.O).toBeLessThan(p.S)
    expect(p.S).toBeLessThan(p.B)
    expect(p.H).toBeGreaterThan(p.B)
  })

  it('falls back to the cat for an unknown roster value', () => {
    expect(toAvatarId('owl')).toBe('owl')
    expect(toAvatarId('dragon')).toBe('cat')
    expect(toAvatarId(undefined)).toBe('cat')
  })
})
