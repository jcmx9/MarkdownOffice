import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { updateState } from '../../../src/main/spellcheck/dictionaries'
import { checkForUpdates, downloadDictionary } from '../../../src/main/spellcheck/updates'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const release = (version: string, files: Record<string, string>, sums = files) => {
  const base = `https://github.com/jcmx9/MarkdownOffice-dictionaries/releases/download/v${version}`
  const routes: Record<string, string> = {
    'https://api.github.com/repos/jcmx9/MarkdownOffice-dictionaries/releases/latest':
      JSON.stringify({
        tag_name: `v${version}`,
        assets: [...Object.keys(files), 'SHA256SUMS', 'dictionaries.json'].map((n) => ({
          name: n,
          browser_download_url: `${base}/${n}`,
        })),
      }),
    [`${base}/SHA256SUMS`]: Object.entries(sums)
      .map(([f, c]) => `${sha(c)}  ${f}`)
      .join('\n'),
    [`${base}/dictionaries.json`]: JSON.stringify(
      Object.keys(files).map((f) => ({ code: f.split('-').slice(0, 2).join('-'), file: f })),
    ),
  }
  for (const [f, c] of Object.entries(files)) routes[`${base}/${f}`] = c
  return async (url: string) =>
    url in routes ? new Response(routes[url]) : new Response('', { status: 404 })
}
const dir = () => mkdtempSync(join(tmpdir(), 'mdo-upd-'))

describe('checkForUpdates', () => {
  it('installs a newer release for the installed languages, verified', async () => {
    const d = dir()
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'OLD')
    const r = await checkForUpdates({
      dir: d,
      fetch: release('26.11.0', { 'de-DE-3-0.bdic': 'NEW', 'fr-FR-3-0.bdic': 'FR' }),
      codes: ['de-DE'],
      force: true,
      now: 1,
    })
    expect(r).toEqual({ kind: 'updated', version: '26.11.0', files: ['de-DE-3-0.bdic'] })
    expect(readFileSync(join(d, 'de-DE-3-0.bdic'), 'utf8')).toBe('NEW')
  })
  it('a wrong checksum keeps the old file', async () => {
    const d = dir()
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'OLD')
    const r = await checkForUpdates({
      dir: d,
      fetch: release('26.11.0', { 'de-DE-3-0.bdic': 'NEW' }, { 'de-DE-3-0.bdic': 'OTHER' }),
      codes: ['de-DE'],
      force: true,
      now: 1,
    })
    expect(r.kind).toBe('failed')
    expect(readFileSync(join(d, 'de-DE-3-0.bdic'), 'utf8')).toBe('OLD')
  })
  it('offline keeps everything and reports failed', async () => {
    const d = dir()
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'OLD')
    const r = await checkForUpdates({
      dir: d,
      fetch: async () => {
        throw new Error('offline')
      },
      codes: ['de-DE'],
      force: true,
      now: 1,
    })
    expect(r.kind).toBe('failed')
    expect(readFileSync(join(d, 'de-DE-3-0.bdic'), 'utf8')).toBe('OLD')
  })
  it('at most once a day unless forced', async () => {
    const d = dir()
    const f = release('26.11.0', { 'de-DE-3-0.bdic': 'NEW' })
    await checkForUpdates({ dir: d, fetch: f, codes: ['de-DE'], force: false, now: 1_000 })
    expect(
      (await checkForUpdates({ dir: d, fetch: f, codes: ['de-DE'], force: false, now: 2_000 }))
        .kind,
    ).toBe('skipped')
  })
  it('the same version again: current', async () => {
    const d = dir()
    const f = release('26.11.0', { 'de-DE-3-0.bdic': 'NEW' })
    await checkForUpdates({ dir: d, fetch: f, codes: ['de-DE'], force: true, now: 1 })
    expect(
      (await checkForUpdates({ dir: d, fetch: f, codes: ['de-DE'], force: true, now: 2 })).kind,
    ).toBe('current')
  })
  it('one good, one bad: good installed, version not recorded', async () => {
    const d = dir()
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'OLD')
    writeFileSync(join(d, 'fr-FR-3-0.bdic'), 'OLDFR')
    const f = release(
      '26.11.0',
      { 'de-DE-3-0.bdic': 'NEW', 'fr-FR-3-0.bdic': 'FR' },
      { 'de-DE-3-0.bdic': 'NEW', 'fr-FR-3-0.bdic': 'BAD' },
    )
    const r = await checkForUpdates({
      dir: d,
      fetch: f,
      codes: ['de-DE', 'fr-FR'],
      force: true,
      now: 1,
    })
    expect(r.kind).toBe('failed')
    expect(readFileSync(join(d, 'de-DE-3-0.bdic'), 'utf8')).toBe('NEW')
    expect(readFileSync(join(d, 'fr-FR-3-0.bdic'), 'utf8')).toBe('OLDFR')
    const st = JSON.parse(readFileSync(join(d, 'mdo-dictionaries.json'), 'utf8'))
    expect(st.version).toBeNull()
    expect(readdirSync(d).filter((x) => x.endsWith('.tmp'))).toEqual([])
  })
  it('a lowercase release asset replaces the canonical installed file, no second copy', async () => {
    const d = dir()
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'OLD')
    const r = await checkForUpdates({
      dir: d,
      fetch: release('26.11.0', { 'de-de-3-0.bdic': 'NEW' }),
      codes: ['de-DE'],
      force: true,
      now: 1,
    })
    expect(r).toEqual({ kind: 'updated', version: '26.11.0', files: ['de-DE-3-0.bdic'] })
    expect(readdirSync(d).filter((x) => x.endsWith('.bdic'))).toEqual(['de-DE-3-0.bdic'])
    expect(readFileSync(join(d, 'de-DE-3-0.bdic'), 'utf8')).toBe('NEW')
  })
})

describe('downloadDictionary', () => {
  it('installs a verified new language under the canonical name', async () => {
    const d = dir()
    const ok = await downloadDictionary({
      dir: d,
      fetch: release('26.11.0', { 'fr-fr-3-0.bdic': 'FR' }),
      code: 'fr-FR',
    })
    expect(ok).toBe(true)
    expect(readFileSync(join(d, 'fr-FR-3-0.bdic'), 'utf8')).toBe('FR')
  })
  it('wrong checksum, unknown code and offline return false', async () => {
    const d = dir()
    const bad = release('26.11.0', { 'fr-FR-3-0.bdic': 'FR' }, { 'fr-FR-3-0.bdic': 'X' })
    expect(await downloadDictionary({ dir: d, fetch: bad, code: 'fr-FR' })).toBe(false)
    expect(readdirSync(d)).toEqual([])
    expect(
      await downloadDictionary({
        dir: d,
        fetch: release('26.11.0', { 'fr-FR-3-0.bdic': 'FR' }),
        code: 'it-IT',
      }),
    ).toBe(false)
    expect(
      await downloadDictionary({
        dir: d,
        fetch: async () => {
          throw new Error('offline')
        },
        code: 'fr-FR',
      }),
    ).toBe(false)
  })
})

describe('concurrent state operations', () => {
  const slow = (f: (u: string) => Promise<Response>) => async (u: string) => {
    await new Promise((r) => setTimeout(r, 5))
    return f(u)
  }
  it('a decline during a check survives', async () => {
    const d = dir()
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'OLD')
    const f = slow(release('26.11.0', { 'de-DE-3-0.bdic': 'NEW' }))
    const check = checkForUpdates({ dir: d, fetch: f, codes: ['de-DE'], force: true, now: 1 })
    await updateState(d, (s) => ({ ...s, declined: ['fr-FR'] }))
    await check
    const st = JSON.parse(readFileSync(join(d, 'mdo-dictionaries.json'), 'utf8'))
    expect(st.declined).toEqual(['fr-FR'])
    expect(st.version).toBe('26.11.0')
  })
  it('a check and a download of different files both land in the state', async () => {
    const d = dir()
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'OLD')
    const f = slow(release('26.11.0', { 'de-DE-3-0.bdic': 'NEW', 'fr-FR-3-0.bdic': 'FR' }))
    const [, ok] = await Promise.all([
      checkForUpdates({ dir: d, fetch: f, codes: ['de-DE'], force: true, now: 1 }),
      downloadDictionary({ dir: d, fetch: f, code: 'fr-FR' }),
    ])
    expect(ok).toBe(true)
    const st = JSON.parse(readFileSync(join(d, 'mdo-dictionaries.json'), 'utf8'))
    expect(Object.keys(st.files).sort()).toEqual(['de-DE-3-0.bdic', 'fr-FR-3-0.bdic'])
  })
  it('two checks and a same-file download do not collide on temp files', async () => {
    const d = dir()
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'OLD')
    const f = slow(release('26.11.0', { 'de-DE-3-0.bdic': 'NEW' }))
    const rs = await Promise.all([
      checkForUpdates({ dir: d, fetch: f, codes: ['de-DE'], force: true, now: 1 }),
      checkForUpdates({ dir: d, fetch: f, codes: ['de-DE'], force: true, now: 2 }),
      downloadDictionary({ dir: d, fetch: f, code: 'de-DE' }),
    ])
    expect(rs.map((r) => (typeof r === 'boolean' ? r : r.kind))).not.toContain('failed')
    expect(readdirSync(d).filter((x) => x.endsWith('.tmp'))).toEqual([])
    expect(readFileSync(join(d, 'de-DE-3-0.bdic'), 'utf8')).toBe('NEW')
  })
})
