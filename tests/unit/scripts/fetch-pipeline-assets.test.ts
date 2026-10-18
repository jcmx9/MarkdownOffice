import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Manifest } from '../../../scripts/fetch-pipeline-assets.mjs'
import { fetchAssets, folderName } from '../../../scripts/fetch-pipeline-assets.mjs'

type SetEntry = Manifest['sets'][number]
type FontLicense = Manifest['fonts'][number]['license']
type DictLicense = NonNullable<Manifest['dictionaries']>[number]['license']

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

let work: string
let outDir: string
let served: Map<string, Buffer>
let calls: string[]

/** Builds a .tar.xz / .tar.gz from a map of relative path to content. */
function makeArchive(name: string, files: Record<string, string>): Buffer {
  const src = mkdtempSync(join(work, 'src-'))
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(src, rel, '..'), { recursive: true })
    writeFileSync(join(src, rel), content)
  }
  const out = join(work, name)
  const flag = name.endsWith('.xz') ? '-cJf' : '-czf'
  execFileSync('tar', [flag, out, '-C', src, '.'])
  return readFileSync(out)
}

async function download(url: string): Promise<Buffer> {
  calls.push(url)
  const body = served.get(url)
  if (!body) throw new Error('HTTP 404')
  return body
}

function makeManifest() {
  const typstUrl = 'https://x.test/typst-a.tar.xz'
  const typst = makeArchive('typst.tar.xz', {
    'typst-a/typst': 'BIN',
    'typst-a/LICENSE': 'Apache',
    'typst-a/NOTICE': 'n',
  })
  const fontUrl = 'https://x.test/fonts.tar.xz'
  const fonts = makeArchive('fonts.tar.xz', {
    'pkg/VAR/A.otf': 'A',
    'pkg/VAR/B.otf': 'B',
    'pkg/LICENSE.md': 'OFL A',
  })
  const rawUrl = 'https://x.test/Raw.ttf'
  const raw = Buffer.from('RAW')
  const oflUrl = 'https://x.test/raw/OFL.txt'
  const ofl = Buffer.from('OFL Raw')
  const pkgUrl = 'https://packages.typst.org/preview/cm-1.0.0.tar.gz'
  const pkg = makeArchive('cm.tar.gz', {
    'typst.toml': 'version = "1.0.0"',
    'lib.typ': 'x',
    LICENSE: 'MIT',
  })
  const deUrl = 'https://x.test/dict/de-de-3-0.bdic'
  const de = Buffer.from('BDIC-DE')
  // Served base64-encoded, like Gitiles' ?format=TEXT; the pin is the decoded text's hash.
  const deLicUrl = 'https://x.test/README_de_DE.txt?format=TEXT'
  const deLic = Buffer.from('LGPL de')
  const enUrl = 'https://x.test/dict/en-us-10-1.bdic'
  const en = Buffer.from('BDIC-EN')
  const enLicUrl = 'https://x.test/README_en_US.txt'
  const enLic = Buffer.from('SCOWL en')
  served = new Map([
    [typstUrl, typst],
    [fontUrl, fonts],
    [rawUrl, raw],
    [oflUrl, ofl],
    [pkgUrl, pkg],
    [deUrl, de],
    [deLicUrl, Buffer.from(deLic.toString('base64'))],
    [enUrl, en],
    [enLicUrl, enLic],
  ])
  return {
    typst: {
      version: '9',
      licenses: ['LICENSE', 'NOTICE'],
      targets: { 'darwin-arm64': { url: typstUrl, sha256: sha(typst), bin: 'typst-a/typst' } },
    },
    fonts: [
      {
        url: fontUrl,
        sha256: sha(fonts),
        extract: ['VAR/A.otf', 'VAR/B.otf'],
        license: { file: 'A-LICENSE.md', extract: 'LICENSE.md' } as FontLicense,
      },
      {
        url: rawUrl,
        sha256: sha(raw),
        file: 'Raw.ttf',
        license: { file: 'Raw-OFL.txt', url: oflUrl, sha256: sha(ofl) } as FontLicense,
      },
    ],
    packages: [{ name: 'cm', version: '1.0.0', sha256: sha(pkg), license: 'LICENSE' }],
    sets: [] as SetEntry[],
    dictionaries: [
      {
        code: 'de-DE',
        file: 'de-DE-3-0.bdic',
        url: deUrl,
        sha256: sha(de),
        license: {
          file: 'de-DE-LICENSE.txt',
          url: deLicUrl,
          encoding: 'base64',
          sha256: sha(deLic),
        } as DictLicense,
      },
      {
        code: 'en-US',
        file: 'en-US-10-1.bdic',
        url: enUrl,
        sha256: sha(en),
        license: { file: 'en-US-LICENSE.txt', url: enLicUrl, sha256: sha(enLic) } as DictLicense,
      },
    ],
  }
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mdo-assets-'))
  outDir = join(work, 'out')
  calls = []
})
afterEach(() => rmSync(work, { recursive: true, force: true }))

const run = (manifest: ReturnType<typeof makeManifest>, extra = {}) =>
  fetchAssets({
    manifest,
    target: 'darwin-arm64',
    outDir,
    download,
    log: () => {},
    env: {},
    ...extra,
  })

describe('folderName', () => {
  it('maps node platforms to the electron-builder os names', () => {
    expect(folderName('darwin-arm64')).toBe('mac-arm64')
    expect(folderName('win32-x64')).toBe('win-x64')
    expect(folderName('linux-x64')).toBe('linux-x64')
  })
})

describe('fetchAssets', () => {
  it('writes typst, fonts and vendor packages into outDir', async () => {
    await run(makeManifest())
    expect(readFileSync(join(outDir, 'mac-arm64', 'typst'), 'utf8')).toBe('BIN')
    expect(readdirSync(join(outDir, 'fonts')).sort()).toEqual(['A.otf', 'B.otf', 'Raw.ttf'])
    expect(readFileSync(join(outDir, 'vendor', 'cm', 'typst.toml'), 'utf8')).toContain('1.0.0')
  })

  it('collects the licence texts of Typst, the fonts and the packages', async () => {
    await run(makeManifest())
    const lic = (rel: string) => readFileSync(join(outDir, 'licenses', rel), 'utf8')
    expect(lic('typst/LICENSE')).toBe('Apache')
    expect(lic('typst/NOTICE')).toBe('n')
    expect(lic('fonts/A-LICENSE.md')).toBe('OFL A')
    expect(lic('fonts/Raw-OFL.txt')).toBe('OFL Raw')
    expect(lic('packages/cm/LICENSE')).toBe('MIT')
  })

  it('fetches the dictionaries and their licences (a base64 one decoded)', async () => {
    await run(makeManifest())
    const out = (rel: string) => readFileSync(join(outDir, rel), 'utf8')
    expect(out('dictionaries/de-DE-3-0.bdic')).toBe('BDIC-DE')
    expect(out('dictionaries/en-US-10-1.bdic')).toBe('BDIC-EN')
    expect(out('licenses/dictionaries/de-DE-LICENSE.txt')).toBe('LGPL de')
    expect(out('licenses/dictionaries/en-US-LICENSE.txt')).toBe('SCOWL en')
  })

  it('verifies a dictionary against its pin and leaves no partial file', async () => {
    const manifest = makeManifest()
    const de = manifest.dictionaries[0] as { sha256: string; url: string }
    de.sha256 = '0'.repeat(64)
    await expect(run(manifest)).rejects.toThrow(`Prüfsumme falsch: ${de.url}`)
    expect(existsSync(join(outDir, 'dictionaries', 'de-DE-3-0.bdic'))).toBe(false)
  })

  it('verifies a decoded licence against its pin', async () => {
    const manifest = makeManifest()
    const de = manifest.dictionaries[0] as { license: DictLicense }
    de.license = { ...de.license, sha256: '0'.repeat(64) }
    await expect(run(manifest)).rejects.toThrow(
      'Prüfsumme falsch: https://x.test/README_de_DE.txt?format=TEXT',
    )
  })

  it('verifies a separately downloaded licence against its pin', async () => {
    const manifest = makeManifest()
    const raw = manifest.fonts[1] as { license: FontLicense }
    raw.license = { ...raw.license, sha256: '0'.repeat(64) }
    await expect(run(manifest)).rejects.toThrow('Prüfsumme falsch: https://x.test/raw/OFL.txt')
  })

  it('fails when an archive lacks its licence', async () => {
    const manifest = makeManifest()
    const pkg = makeArchive('nolic.tar.gz', { 'typst.toml': 'x' })
    served.set('https://packages.typst.org/preview/cm-1.0.0.tar.gz', pkg)
    manifest.packages[0] = { name: 'cm', version: '1.0.0', sha256: sha(pkg), license: 'LICENSE' }
    await expect(run(manifest)).rejects.toThrow('Lizenz fehlt im Paket: LICENSE')
  })

  it('fetches again when only the licence of an earlier fetch is missing', async () => {
    const manifest = makeManifest()
    await run(manifest)
    const first = calls.length
    rmSync(join(outDir, 'licenses', 'typst', 'NOTICE'))
    await run(manifest)
    expect(calls.length).toBe(first + 1)
    expect(existsSync(join(outDir, 'licenses', 'typst', 'NOTICE'))).toBe(true)
  })

  it('throws on a checksum mismatch and leaves no partial file', async () => {
    const manifest = makeManifest()
    const first = manifest.fonts[1] as { sha256: string; url: string }
    first.sha256 = '0'.repeat(64)
    await expect(run(manifest)).rejects.toThrow(`Prüfsumme falsch: ${first.url}`)
    expect(existsSync(join(outDir, 'fonts', 'Raw.ttf'))).toBe(false)
    expect(readdirSync(outDir).filter((n) => n.startsWith('.tmp'))).toEqual([])
  })

  it('wraps a failed download', async () => {
    const manifest = makeManifest()
    served.delete('https://x.test/Raw.ttf')
    await expect(run(manifest)).rejects.toThrow(
      'Download fehlgeschlagen: https://x.test/Raw.ttf (HTTP 404)',
    )
  })

  it('rejects an unknown target before downloading anything', async () => {
    await expect(run(makeManifest(), { target: 'linux-arm64' })).rejects.toThrow(
      'Kein Typst für linux-arm64',
    )
    expect(calls).toEqual([])
  })

  it('does not download again when everything is intact', async () => {
    const manifest = makeManifest()
    await run(manifest)
    const first = calls.length
    expect(first).toBe(9)
    await run(manifest)
    expect(calls.length).toBe(first)
  })

  it('downloads again when an output file is missing', async () => {
    const manifest = makeManifest()
    await run(manifest)
    rmSync(join(outDir, 'mac-arm64', 'typst'))
    await run(manifest)
    expect(calls.length).toBe(10)
  })
})

describe('error messages', () => {
  it('reports a failing git archive in German', async () => {
    const manifest = {
      ...makeManifest(),
      sets: [{ name: 'memo', repo: 'o/r', tag: 'nope', sha256: '' }],
    }
    await expect(run(manifest, { env: { MDO_SET_MEMO_DIR: work } })).rejects.toThrow(
      /git archive fehlgeschlagen/,
    )
  })

  it('reports a broken archive in German', async () => {
    const manifest = makeManifest()
    const bad = Buffer.from('not an archive')
    served.set('https://packages.typst.org/preview/cm-1.0.0.tar.gz', bad)
    manifest.packages[0] = { name: 'cm', version: '1.0.0', sha256: sha(bad), license: 'LICENSE' }
    await expect(run(manifest)).rejects.toThrow(/Entpacken fehlgeschlagen/)
  })
})

describe('sets', () => {
  const setEntry = {
    name: 'memo',
    repo: 'o/set-memo',
    tag: 'v1.0.0',
    sha256: '',
  }

  it('refuses an empty sha256 without the local override', async () => {
    const manifest = { ...makeManifest(), sets: [setEntry] }
    await expect(run(manifest)).rejects.toThrow(/memo.*sha256.*MDO_SET_MEMO_DIR/s)
  })

  it('copies only tracked files from MDO_SET_MEMO_DIR at the pinned tag', async () => {
    const repo = join(work, 'set-repo')
    mkdirSync(repo)
    const git = (...a: string[]) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a])
    git('init', '-q')
    writeFileSync(join(repo, 'memo.typ'), 'T')
    git('add', '.')
    git('commit', '-q', '-m', 'x')
    git('tag', 'v1.0.0')
    writeFileSync(join(repo, 'untracked.txt'), 'no')
    const manifest = { ...makeManifest(), sets: [setEntry] }
    await run(manifest, { env: { MDO_SET_MEMO_DIR: repo } })
    expect(readFileSync(join(outDir, 'sets', 'memo', 'memo.typ'), 'utf8')).toBe('T')
    expect(existsSync(join(outDir, 'sets', 'memo', 'untracked.txt'))).toBe(false)
  })

  it('downloads the tag archive and verifies a pinned sha256', async () => {
    const url = 'https://github.com/o/set-memo/archive/refs/tags/v1.0.0.tar.gz'
    const base = makeManifest()
    const archive = makeArchive('set.tar.gz', { 'set-memo-1.0.0/memo.typ': 'T' })
    served.set(url, archive)
    const manifest = { ...base, sets: [{ ...setEntry, sha256: sha(archive) }] }
    await run(manifest)
    expect(readFileSync(join(outDir, 'sets', 'memo', 'memo.typ'), 'utf8')).toBe('T')
  })
})
