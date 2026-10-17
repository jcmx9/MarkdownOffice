import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkPackedResources, manifestLicenses } from '../../../scripts/after-pack.mjs'

const fonts = ['A.otf', 'B.ttf']
const licenses = ['typst/LICENSE', 'fonts/A-OFL.txt']
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
  put(join('sets', 'memo', 'memo.typ'))
  put(join('pipeline', win ? 'convert.ps1' : 'build.sh'))
  put(join('pipeline', 'cli.js'))
  for (const l of licenses) put(join('pipeline', 'licenses', l))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mdo-pack-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('checkPackedResources', () => {
  it('passes for a complete resources dir', () => {
    complete()
    expect(() =>
      checkPackedResources({ resourcesDir: dir, platform: 'linux', fonts, licenses }),
    ).not.toThrow()
  })

  it('passes for a complete Windows resources dir', () => {
    complete(true)
    expect(() =>
      checkPackedResources({ resourcesDir: dir, platform: 'win32', fonts, licenses }),
    ).not.toThrow()
  })

  it.each([
    join('pipeline', 'bin', 'typst'),
    join('pipeline', 'fonts', 'B.ttf'),
    join('pipeline', 'vendor', 'mitex'),
    join('sets', 'memo', 'memo.typ'),
    join('pipeline', 'build.sh'),
    join('pipeline', 'cli.js'),
    join('pipeline', 'licenses', 'typst', 'LICENSE'),
    join('pipeline', 'licenses', 'fonts', 'A-OFL.txt'),
  ])('fails naming the missing %s', (rel) => {
    complete()
    rmSync(join(dir, rel), { recursive: true })
    expect(() =>
      checkPackedResources({ resourcesDir: dir, platform: 'darwin', fonts, licenses }),
    ).toThrow(`Paket unvollständig: ${join(dir, rel)} – erst npm run assets`)
  })

  // Windows has no executable bit: chmod cannot make the file non-executable there.
  it.skipIf(process.platform === 'win32')('fails when typst is not executable', () => {
    complete()
    chmodSync(join(dir, 'pipeline', 'bin', 'typst'), 0o644)
    expect(() =>
      checkPackedResources({ resourcesDir: dir, platform: 'linux', fonts, licenses }),
    ).toThrow(/Paket unvollständig/)
  })
})

describe('manifestLicenses', () => {
  it('names the licence files fetch-pipeline-assets writes', () => {
    expect(
      manifestLicenses({
        typst: { licenses: ['LICENSE', 'NOTICE'] },
        fonts: [{ license: { file: 'A-OFL.txt' } }],
        packages: [{ name: 'cm', license: 'LICENSE' }],
      }),
    ).toEqual(['typst/LICENSE', 'typst/NOTICE', 'fonts/A-OFL.txt', 'packages/cm/LICENSE'])
  })

  it('covers every font and package of the real manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'pipeline-assets.json'), 'utf8'),
    )
    const all = manifestLicenses(manifest)
    expect(all.filter((l) => l.startsWith('fonts/'))).toHaveLength(manifest.fonts.length)
    expect(all.filter((l) => l.startsWith('packages/'))).toHaveLength(manifest.packages.length)
    expect(all).toEqual(expect.arrayContaining(['typst/LICENSE', 'typst/NOTICE']))
  })
})
