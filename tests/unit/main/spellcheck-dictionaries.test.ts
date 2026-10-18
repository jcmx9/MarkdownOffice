import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  codeOf,
  installBundledDictionaries,
  installedCodes,
} from '../../../src/main/spellcheck/dictionaries'

const dir = () => mkdtempSync(join(tmpdir(), 'mdo-dict-'))

describe('installBundledDictionaries', () => {
  it('copies missing files and reports their codes', async () => {
    const from = dir()
    const to = join(dir(), 'Dictionaries')
    writeFileSync(join(from, 'de-DE-3-0.bdic'), 'DE')
    writeFileSync(join(from, 'en-US-10-1.bdic'), 'EN')
    expect((await installBundledDictionaries(from, to)).sort()).toEqual(['de-DE', 'en-US'])
    expect(readFileSync(join(to, 'de-DE-3-0.bdic'), 'utf8')).toBe('DE')
  })

  it('replaces an installed file that differs from the bundled one', async () => {
    const from = dir()
    const to = dir()
    writeFileSync(join(from, 'de-DE-3-0.bdic'), 'DE')
    writeFileSync(join(to, 'de-DE-3-0.bdic'), 'BROKEN')
    await installBundledDictionaries(from, to)
    expect(readFileSync(join(to, 'de-DE-3-0.bdic'), 'utf8')).toBe('DE')
  })

  it('keeps a newer downloaded file with the same name', async () => {
    const from = dir()
    const to = join(dir(), 'Dictionaries')
    writeFileSync(join(from, 'de-DE-3-0.bdic'), 'DE-OLD')
    mkdirSync(to, { recursive: true })
    writeFileSync(join(to, 'de-DE-3-0.bdic'), 'DE-NEWER')
    writeFileSync(
      join(to, 'mdo-dictionaries.json'),
      JSON.stringify({ version: '26.11.0', files: { 'de-DE-3-0.bdic': 'x' } }),
    )
    await installBundledDictionaries(from, to)
    expect(readFileSync(join(to, 'de-DE-3-0.bdic'), 'utf8')).toBe('DE-NEWER')
  })

  it('matches the update state case-insensitively (Electron asks for lowercase names)', async () => {
    const from = dir()
    const to = dir()
    writeFileSync(join(from, 'de-DE-3-0.bdic'), 'DE-OLD')
    writeFileSync(join(to, 'de-DE-3-0.bdic'), 'DE-NEWER')
    writeFileSync(
      join(to, 'mdo-dictionaries.json'),
      JSON.stringify({ version: '26.11.0', files: { 'de-de-3-0.bdic': 'x' } }),
    )
    await installBundledDictionaries(from, to)
    expect(readFileSync(join(to, 'de-DE-3-0.bdic'), 'utf8')).toBe('DE-NEWER')
  })

  it('lists installed codes from file names', async () => {
    const to = dir()
    writeFileSync(join(to, 'fr-FR-3-0.bdic'), 'FR')
    writeFileSync(join(to, 'notes.txt'), '')
    expect(await installedCodes(to)).toEqual(['fr-FR'])
  })

  it('lists a lowercase file under its canonical code, once', async () => {
    const to = dir()
    writeFileSync(join(to, 'de-de-3-0.BDIC'), 'DE')
    writeFileSync(join(to, 'nl-3-0.bdic'), 'NL')
    expect(await installedCodes(to)).toEqual(['de-DE', 'nl'])
  })

  it('reports no codes for a missing folder', async () => {
    expect(await installedCodes(join(dir(), 'nope'))).toEqual([])
  })
})

describe('codeOf', () => {
  it.each([
    ['de-DE-3-0.bdic', 'de-DE'],
    ['de-de-3-0.bdic', 'de-DE'],
    ['en-US-10-1.bdic', 'en-US'],
    ['nl-3-0.bdic', 'nl'],
  ])('%s → %s', (file, code) => {
    expect(codeOf(file)).toBe(code)
  })
})
