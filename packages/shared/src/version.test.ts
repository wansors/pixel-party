import { describe, expect, test } from 'bun:test'
import rootPackage from '../../../package.json'
import { APP_VERSION } from './version'

describe('APP_VERSION', () => {
  test('matches the root package.json version', () => {
    expect(APP_VERSION).toBe(rootPackage.version)
  })
})
