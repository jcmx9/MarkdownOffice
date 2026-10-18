import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkPackedResources, manifestLicenses } from '../../../scripts/after-pack.mjs'

const fonts = ['A.otf', 'B.ttf']
const licenses = ['typst/LICENSE', 'fonts/A-OFL.txt']
const dictionaries = ['de-DE-3-0.bdic']
const packages = [
  { name: 'cmarker', version: '1' },
  { name: 'mitex', version: '1' },
  { name: 'mmdr', version: '1' },
  { name: 'cades', version: '0.3.1', store: true },
]
let dir: string

function put(rel: string, mode = 0o644) {
  const p = join(dir, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, 'x')
  chmodSync(p, mode)
}

function complete(win = false) {
  put(join('pipeline', 'bin', win ? 'typst.exe' : 'typst'), 0o755)
  for (const f of fonts) put(join('pipeline', 'fonts', f))
  for (const p of ['cmarker', 'mitex', 'mmdr']) put(join('pipeline', 'vendor', p, 'typst.toml'))
  put(join('pipeline', 'vendor', 'packages', 'preview', 'cades', '0.3.1', 'typst.toml'))
  put(join('sets', 'memo', 'memo.typ'))
  put(join('sets', 'din5008a', 'din5008a.typ'))
  put(join('pipeline', win ? 'convert.ps1' : 'build.sh'))
  put(join('pipeline', 'cli.js'))
  for (const l of licenses) put(join('pipeline', 'licenses', l))
  for (const d of dictionaries) put(join('dictionaries', d))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mdo-pack-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('checkPackedResources', () => {
  it('passes for a complete resources dir', () => {
    complete()
    expect(() =>
      checkPackedResources({ resourcesDir: dir, platform: 'linux', fonts, licenses, packages }),
    ).not.toThrow()
  })

  it('passes for a complete Windows resources dir', () => {
    complete(true)
    expect(() =>
      checkPackedResources({ resourcesDir: dir, platform: 'win32', fonts, licenses, packages }),
    ).not.toThrow()
  })

  it.each([
    join('pipeline', 'bin', 'typst'),
    join('pipeline', 'fonts', 'B.ttf'),
    join('pipeline', 'vendor', 'mitex'),
    // Store package: checked in its package-cache layout.
    join('pipeline', 'vendor', 'packages', 'preview', 'cades', '0.3.1'),
    join('sets', 'memo', 'memo.typ'),
    join('sets', 'din5008a', 'din5008a.typ'),
    join('pipeline', 'build.sh'),
    join('pipeline', 'cli.js'),
    join('pipeline', 'licenses', 'typst', 'LICENSE'),
    join('pipeline', 'licenses', 'fonts', 'A-OFL.txt'),
  ])('fails naming the missing %s', (rel) => {
    complete()
    rmSync(join(dir, rel), { recursive: true })
    expect(() =>
      checkPackedResources({ resourcesDir: dir, platform: 'darwin', fonts, licenses, packages }),
    ).toThrow(`Paket unvollständig: ${join(dir, rel)} – erst npm run assets`)
  })

  it.each(['win32', 'linux'])('on %s requires the bundled dictionaries', (platform) => {
    complete(platform === 'win32')
    rmSync(join(dir, 'dictionaries', 'de-DE-3-0.bdic'))
    expect(() =>
      checkPackedResources({
        resourcesDir: dir,
        platform,
        fonts,
        licenses,
        packages,
        dictionaries,
      }),
    ).toThrow(`Paket unvollständig: ${join(dir, 'dictionaries', 'de-DE-3-0.bdic')}`)
  })

  it('on macOS does not require dictionaries (system spellchecker)', () => {
    complete()
    rmSync(join(dir, 'dictionaries'), { recursive: true })
    expect(() =>
      checkPackedResources({
        resourcesDir: dir,
        platform: 'darwin',
        fonts,
        licenses,
        packages,
        dictionaries,
      }),
    ).not.toThrow()
  })

  // Windows has no executable bit: chmod cannot make the file non-executable there.
  it.skipIf(process.platform === 'win32')('fails when typst is not executable', () => {
    complete()
    chmodSync(join(dir, 'pipeline', 'bin', 'typst'), 0o644)
    expect(() =>
      checkPackedResources({ resourcesDir: dir, platform: 'linux', fonts, licenses, packages }),
    ).toThrow(/Paket unvollständig/)
  })
})

describe('manifestLicenses', () => {
  it('names the licence files fetch-pipeline-assets writes', () => {
    expect(
      manifestLicenses({
        typst: { licenses: ['LICENSE', 'NOTICE'] },
        fonts: [{ license: { file: 'A-OFL.txt' } }],
        packages: [
          { name: 'cm', license: 'LICENSE' },
          { name: 'qr', license: ['LICENSE', 'NOTICE'] },
        ],
        dictionaries: [
          {
            file: 'de-DE-3-0.bdic',
            license: [{ file: 'de-DE-LICENSE.txt' }, { file: 'de-DE-LGPL-2.1.txt' }],
          },
          { file: 'en-US-10-1.bdic', license: { file: 'en-US-LICENSE.txt' } },
        ],
      }),
    ).toEqual([
      'typst/LICENSE',
      'typst/NOTICE',
      'fonts/A-OFL.txt',
      'packages/cm/LICENSE',
      'packages/qr/LICENSE',
      'packages/qr/NOTICE',
      'dictionaries/de-DE-LICENSE.txt',
      'dictionaries/de-DE-LGPL-2.1.txt',
      'dictionaries/en-US-LICENSE.txt',
    ])
  })

  it('covers every font and package of the real manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'pipeline-assets.json'), 'utf8'),
    )
    const all = manifestLicenses(manifest)
    expect(all.filter((l) => l.startsWith('fonts/'))).toHaveLength(manifest.fonts.length)
    const pkgLicenses = manifest.packages.flatMap((p: { license: unknown }) =>
      Array.isArray(p.license) ? p.license : [p.license],
    )
    expect(all.filter((l) => l.startsWith('packages/'))).toHaveLength(pkgLicenses.length)
    // R3: the third-party notices bundled in cades and jogs ship as well.
    expect(all).toEqual(
      expect.arrayContaining(['packages/cades/NOTICE', 'packages/jogs/license.html']),
    )
    const dictLicenses = manifest.dictionaries.flatMap((d: { license: unknown }) =>
      Array.isArray(d.license) ? d.license : [d.license],
    )
    expect(all.filter((l) => l.startsWith('dictionaries/'))).toHaveLength(dictLicenses.length)
    // R5: the German dictionary (de_DE_neu, LGPL) ships the full LGPL text.
    expect(all).toContain('dictionaries/de-DE-LGPL-2.1.txt')
    expect(all).toEqual(expect.arrayContaining(['typst/LICENSE', 'typst/NOTICE']))
  })
})
