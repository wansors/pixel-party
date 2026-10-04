import { describe, expect, test } from 'bun:test'
import { bumpFromCommits, nextVersion } from './release-version'

describe('release version', () => {
  test('bumps one part and resets the ones below it', () => {
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0')
    expect(nextVersion('1.4.2', 'minor')).toBe('1.5.0')
    expect(nextVersion('1.4.2', 'patch')).toBe('1.4.3')
  })

  test('every change is at least a minor; a breaking one is a major', () => {
    expect(bumpFromCommits(['fix: a typo', 'feat: a new game'])).toBe('minor')
    expect(bumpFromCommits([])).toBe('minor')
    expect(bumpFromCommits(['feat!: new wire protocol'])).toBe('major')
    expect(bumpFromCommits(['feat(protocol)!: drop v4'])).toBe('major')
    expect(bumpFromCommits(['feat: x\n\nBREAKING CHANGE: old clients must refresh'])).toBe('major')
    expect(bumpFromCommits(['docs: mention breaking change: nothing'])).toBe('minor')
  })
})
