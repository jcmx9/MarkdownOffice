import { describe, expect, it } from 'vitest'
import { platformFromUserAgent, revealLabel } from '../../../src/shared/reveal'

describe('revealLabel', () => {
  it.each([
    ['darwin', 'Im Finder zeigen'],
    ['win32', 'Im Explorer zeigen'],
    ['linux', 'Im Dateimanager zeigen'],
    ['freebsd', 'Im Dateimanager zeigen'],
  ])('%s → %s', (platform, label) => {
    expect(revealLabel(platform)).toBe(label)
  })
})

describe('platformFromUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/39.0.0', 'darwin'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/39.0.0', 'win32'],
    ['Mozilla/5.0 (X11; Linux x86_64) Electron/39.0.0', 'linux'],
  ])('%s → %s', (ua, platform) => {
    expect(platformFromUserAgent(ua)).toBe(platform)
  })
})
