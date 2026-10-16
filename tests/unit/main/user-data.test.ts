import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { userDataOverride } from '../../../src/main/user-data'

const appData = resolve('/home/u/.config')

describe('userDataOverride', () => {
  it('MDO_USER_DATA wins, packaged or not', () => {
    const custom = resolve('/tmp/mdo-test')
    expect(userDataOverride({ MDO_USER_DATA: custom }, true, appData)).toBe(custom)
    expect(userDataOverride({ MDO_USER_DATA: custom }, false, appData)).toBe(custom)
  })

  it('development uses its own folder, so it never shares settings or the lock with an install', () => {
    expect(userDataOverride({}, false, appData)).toBe(join(appData, 'Markdown Office Dev'))
    expect(userDataOverride({ MDO_USER_DATA: '' }, false, appData)).toBe(
      join(appData, 'Markdown Office Dev'),
    )
  })

  it('the packaged app keeps Electron’s default', () => {
    expect(userDataOverride({}, true, appData)).toBeNull()
  })
})
