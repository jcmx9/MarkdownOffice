import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  codeOf,
  dictionaryPath,
  installBundledDictionaries,
  installedCodes,
  offeredTable,
  parseTable,
  STATE_FILE,
  TABLE_FILE,
} from '../../../src/main/spellcheck/dictionaries'
import { BUILTIN_DICTIONARIES } from '../../../src/main/spellcheck/languages'

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
    // Chromium opens nl-NL-3-0.bdic for the code nl (spellcheck_common.cc).
    writeFileSync(join(to, 'nl-NL-3-0.bdic'), 'NL')
    // Not a name Chromium ever opens: not counted as installed.
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
    ['nl-NL-3-0.bdic', 'nl'],
    ['tr-TR-4-0.bdic', 'tr'],
    ['nl-3-0.bdic', null],
  ])('%s → %s', (file, code) => {
    expect(codeOf(file, BUILTIN_DICTIONARIES)).toBe(code)
  })
})

describe('dictionaryPath (names from the network)', () => {
  it.each([
    '../x.bdic',
    '..\\x.bdic',
    'a/b.bdic',
    'a\\b.bdic',
    '/abs.bdic',
    'de-DE-3-0.bdic.exe',
    'x..bdic',
    '',
  ])('rejects %j', (name) => {
    expect(() => dictionaryPath('/dicts', name)).toThrow(/Unzulässiger/)
  })
  it('accepts a plain .bdic base name (any case)', () => {
    expect(dictionaryPath('/dicts', 'de-de-3-0.BDIC')).toBe(join('/dicts', 'de-de-3-0.BDIC'))
  })
})

describe('dictionary table', () => {
  it('parseTable drops unusable entries (code, unsafe file)', () => {
    expect(
      parseTable([
        { code: 'nl', file: 'nl-NL-3-0.bdic', name: 'Dutch' },
        { code: 'xx', file: '../evil.bdic', name: 'Evil' },
        { code: 'not a code', file: 'a-3-0.bdic' },
        { code: 'el', file: 'el-GR-3-0.bdic' },
        'junk',
      ]),
    ).toEqual([
      { code: 'nl', file: 'nl-NL-3-0.bdic', name: 'Dutch' },
      { code: 'el', file: 'el-GR-3-0.bdic', name: 'el' },
    ])
    expect(parseTable({ not: 'an array' })).toEqual([])
  })
  it('offeredTable: built-in without cache or with a corrupt one, else the cached release', async () => {
    const d = dir()
    expect(await offeredTable(d)).toEqual(BUILTIN_DICTIONARIES)
    writeFileSync(join(d, TABLE_FILE), '{broken')
    expect(await offeredTable(d)).toEqual(BUILTIN_DICTIONARIES)
    writeFileSync(join(d, TABLE_FILE), JSON.stringify([{ code: 'el', file: 'el-GR-3-0.bdic' }]))
    expect(await offeredTable(d)).toEqual([{ code: 'el', file: 'el-GR-3-0.bdic', name: 'el' }])
  })
  it('installedCodes recognises a release-only file and keeps the built-in ones', async () => {
    const d = dir()
    writeFileSync(join(d, TABLE_FILE), JSON.stringify([{ code: 'el', file: 'el-GR-3-0.bdic' }]))
    writeFileSync(join(d, 'el-GR-3-0.bdic'), 'EL')
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'DE')
    expect(await installedCodes(d)).toEqual(['de-DE', 'el'])
  })
})

describe('pending updates (activated at start)', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  const state = (files: Record<string, string>) =>
    JSON.stringify({ version: '26.11.0', files, lastCheck: 1, declined: [] })

  it('moves a verified .pending file into place before the bundled install', async () => {
    const from = dir()
    const to = dir()
    writeFileSync(join(from, 'de-DE-3-0.bdic'), 'BUNDLED')
    writeFileSync(join(to, 'de-DE-3-0.bdic'), 'OLD')
    writeFileSync(join(to, 'de-DE-3-0.bdic.pending'), 'NEW')
    writeFileSync(join(to, STATE_FILE), state({ 'de-DE-3-0.bdic': sha('NEW') }))
    await installBundledDictionaries(from, to)
    expect(readFileSync(join(to, 'de-DE-3-0.bdic'), 'utf8')).toBe('NEW')
    expect(existsSync(join(to, 'de-DE-3-0.bdic.pending'))).toBe(false)
  })

  it('activates without a bundled folder too (macOS dev, missing assets)', async () => {
    const to = dir()
    writeFileSync(join(to, 'fr-FR-3-0.bdic'), 'OLD')
    writeFileSync(join(to, 'fr-FR-3-0.bdic.pending'), 'NEW')
    writeFileSync(join(to, STATE_FILE), state({ 'fr-FR-3-0.bdic': sha('NEW') }))
    expect(await installBundledDictionaries(null, to)).toEqual(['fr-FR'])
    expect(readFileSync(join(to, 'fr-FR-3-0.bdic'), 'utf8')).toBe('NEW')
  })

  it('deletes a pending file whose hash the state does not confirm', async () => {
    const to = dir()
    writeFileSync(join(to, 'de-DE-3-0.bdic'), 'OLD')
    writeFileSync(join(to, 'de-DE-3-0.bdic.pending'), 'TAMPERED')
    writeFileSync(join(to, STATE_FILE), state({ 'de-DE-3-0.bdic': sha('NEW') }))
    await installBundledDictionaries(null, to)
    expect(readFileSync(join(to, 'de-DE-3-0.bdic'), 'utf8')).toBe('OLD')
    expect(readdirSync(to).filter((f) => f.endsWith('.pending'))).toEqual([])
  })
})
