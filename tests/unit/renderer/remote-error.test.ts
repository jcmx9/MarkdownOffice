import { describe, expect, it } from 'vitest'
import { remoteMessage } from '../../../src/renderer/util/remote-error'

describe('remoteMessage', () => {
  it("drops Electron's invoke prefix, keeping main's sentence", () => {
    const e = new Error(
      "Error invoking remote method 'mdo:newNotePath': Error: Neue Notiz nicht möglich: „/n“.",
    )
    expect(remoteMessage(e)).toBe('Neue Notiz nicht möglich: „/n“.')
  })

  it('leaves other texts alone', () => {
    expect(remoteMessage(new Error('plain'))).toBe('plain')
    expect(remoteMessage('text')).toBe('text')
  })
})
