import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { SpellcheckController } from '../../../src/main/spellcheck/controller'
import { defaultSettings } from '../../../src/main/store'

vi.mock('electron', () => ({
  app: { getPreferredSystemLanguages: () => ['en-US'] },
  Menu: {},
}))

// The first installedCodes() call is held back, so it finishes after the second one.
const gate = vi.hoisted(() => ({ release: null as null | (() => void), calls: 0 }))
vi.mock('../../../src/main/spellcheck/dictionaries', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/spellcheck/dictionaries')>()),
  installedCodes: async () => {
    if (++gate.calls === 1) await new Promise<void>((r) => (gate.release = r))
    return ['de-DE', 'fr-FR', 'en-US']
  },
}))

describe('SpellcheckController.setLanguage', () => {
  it('the later request wins even when the earlier one finishes last', async () => {
    const applied: string[][] = []
    const session = {
      setSpellCheckerLanguages: (l: string[]) => applied.push(l),
      setSpellCheckerEnabled: () => undefined,
    }
    const win = { webContents: { session } } as unknown as BrowserWindow
    const c = new SpellcheckController(win, {
      userData: mkdtempSync(join(tmpdir(), 'mdo-spell-')),
      bundledDir: null,
      platform: 'win32',
      settings: () => defaultSettings('/docs'),
    })
    const first = c.setLanguage('de')
    const second = c.setLanguage('fr')
    await second
    gate.release?.()
    await first
    expect(applied).toEqual([['fr-FR']])
  })
})
