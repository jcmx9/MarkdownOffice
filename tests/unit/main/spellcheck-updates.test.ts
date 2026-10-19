import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  installBundledDictionaries,
  readState,
  TABLE_FILE,
  updateState,
} from '../../../src/main/spellcheck/dictionaries'
import { BUILTIN_DICTIONARIES } from '../../../src/main/spellcheck/languages'
import {
  checkForUpdates,
  downloadDictionary,
  type Fetch,
} from '../../../src/main/spellcheck/updates'

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
    // The repo's table in the published shape { code, file, name }.
    [`${base}/dictionaries.json`]: JSON.stringify(
      BUILTIN_DICTIONARIES.filter((d) =>
        Object.keys(files).some((f) => f.toLowerCase() === d.file.toLowerCase()),
      ),
    ),
  }
  for (const [f, c] of Object.entries(files)) routes[`${base}/${f}`] = c
  const f: Fetch = async (url) =>
    url in routes ? new Response(routes[url]) : new Response('', { status: 404 })
  return f
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
    expect(r).toEqual({
      kind: 'updated',
      version: '26.11.0',
      files: ['de-DE-3-0.bdic'],
      pending: true,
    })
    // The open file is never renamed over during the session: staged for the next start.
    expect(readFileSync(join(d, 'de-DE-3-0.bdic'), 'utf8')).toBe('OLD')
    expect(readFileSync(join(d, 'de-DE-3-0.bdic.pending'), 'utf8')).toBe('NEW')
    // The state records the staged file's hash (activation checks it; bundled files keep off).
    expect((await readState(d)).files['de-DE-3-0.bdic']).toBe(sha('NEW'))
    expect(JSON.parse(readFileSync(join(d, TABLE_FILE), 'utf8'))).toEqual([
      { code: 'de-DE', file: 'de-DE-3-0.bdic', name: 'Deutsch' },
      { code: 'fr-FR', file: 'fr-FR-3-0.bdic', name: 'Französisch' },
    ])
    // Next start: activated before the window loads, and the bundled file does not win.
    const bundled = dir()
    writeFileSync(join(bundled, 'de-DE-3-0.bdic'), 'BUNDLED')
    await installBundledDictionaries(bundled, d)
    expect(readFileSync(join(d, 'de-DE-3-0.bdic'), 'utf8')).toBe('NEW')
    expect(existsSync(join(d, 'de-DE-3-0.bdic.pending'))).toBe(false)
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
    expect(readFileSync(join(d, 'de-DE-3-0.bdic.pending'), 'utf8')).toBe('NEW')
    expect(existsSync(join(d, 'fr-FR-3-0.bdic.pending'))).toBe(false)
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
    expect(r).toEqual({
      kind: 'updated',
      version: '26.11.0',
      files: ['de-DE-3-0.bdic'],
      pending: true,
    })
    expect(readdirSync(d).filter((x) => x.endsWith('.bdic'))).toEqual(['de-DE-3-0.bdic'])
    expect(readFileSync(join(d, 'de-DE-3-0.bdic.pending'), 'utf8')).toBe('NEW')
  })
  it('a missing installed file is placed directly (never opened), not staged', async () => {
    const d = dir()
    const r = await checkForUpdates({
      dir: d,
      fetch: release('26.11.0', { 'nl-NL-3-0.bdic': 'NL' }),
      codes: ['nl'],
      force: true,
      now: 1,
    })
    expect(r).toEqual({
      kind: 'updated',
      version: '26.11.0',
      files: ['nl-NL-3-0.bdic'],
      pending: false,
    })
    expect(readFileSync(join(d, 'nl-NL-3-0.bdic'), 'utf8')).toBe('NL')
  })
  it('ignores SHA256SUMS names that are not plain .bdic base names', async () => {
    const d = dir()
    writeFileSync(join(d, 'de-DE-3-0.bdic'), 'OLD')
    const evil = (async (url, init) => {
      const r = await release('26.11.0', { 'de-DE-3-0.bdic': 'NEW' })(url, init)
      if (!url.endsWith('/SHA256SUMS')) return r
      const extra = ['../x.bdic', '..\\x.bdic', 'a/b.bdic'].map((n) => `${sha('X')}  ${n}`)
      return new Response(`${await r.text()}\n${extra.join('\n')}`)
    }) satisfies Fetch
    const r = await checkForUpdates({ dir: d, fetch: evil, codes: ['de-DE'], force: true, now: 1 })
    expect(r.kind).toBe('updated')
    expect(existsSync(join(d, '..', 'x.bdic'))).toBe(false)
  })
})

describe('downloadDictionary', () => {
  it('installs a verified new language under the canonical name', async () => {
    const d = dir()
    const r = await downloadDictionary({
      dir: d,
      fetch: release('26.11.0', { 'fr-fr-3-0.bdic': 'FR' }),
      code: 'fr-FR',
    })
    // Missing before, so Chromium never opened it: in place at once.
    expect(r).toBe('installed')
    expect(readFileSync(join(d, 'fr-FR-3-0.bdic'), 'utf8')).toBe('FR')
  })
  it('a region-less code downloads the file Chromium opens for it (nl → nl-NL-3-0.bdic)', async () => {
    const d = dir()
    const r = await downloadDictionary({
      dir: d,
      fetch: release('26.11.0', { 'nl-NL-3-0.bdic': 'NL' }),
      code: 'nl',
    })
    expect(r).toBe('installed')
    expect(readFileSync(join(d, 'nl-NL-3-0.bdic'), 'utf8')).toBe('NL')
  })
  it('an existing (possibly open) file is staged, not replaced', async () => {
    const d = dir()
    writeFileSync(join(d, 'fr-FR-3-0.bdic'), 'OLD')
    const r = await downloadDictionary({
      dir: d,
      fetch: release('26.11.0', { 'fr-FR-3-0.bdic': 'FR' }),
      code: 'fr-FR',
    })
    expect(r).toBe('pending')
    expect(readFileSync(join(d, 'fr-FR-3-0.bdic'), 'utf8')).toBe('OLD')
    expect(readFileSync(join(d, 'fr-FR-3-0.bdic.pending'), 'utf8')).toBe('FR')
  })
  it('wrong checksum, unknown code and offline return false', async () => {
    const d = dir()
    const bad = release('26.11.0', { 'fr-FR-3-0.bdic': 'FR' }, { 'fr-FR-3-0.bdic': 'X' })
    expect(await downloadDictionary({ dir: d, fetch: bad, code: 'fr-FR' })).toBe('failed')
    // Only the cached release table, never a dictionary file.
    expect(readdirSync(d)).toEqual([TABLE_FILE])
    expect(
      await downloadDictionary({
        dir: d,
        fetch: release('26.11.0', { 'fr-FR-3-0.bdic': 'FR' }),
        code: 'it-IT',
      }),
    ).toBe('failed')
    expect(
      await downloadDictionary({
        dir: d,
        fetch: async () => {
          throw new Error('offline')
        },
        code: 'fr-FR',
      }),
    ).toBe('failed')
  })
})

describe('concurrent state operations', () => {
  const slow =
    (f: Fetch): Fetch =>
    async (u, init) => {
      await new Promise((r) => setTimeout(r, 5))
      return f(u, init)
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
    expect(ok).toBe('installed')
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
    expect(rs.map((r) => (typeof r === 'string' ? r : r.kind))).not.toContain('failed')
    expect(readdirSync(d).filter((x) => x.endsWith('.tmp'))).toEqual([])
    expect(readFileSync(join(d, 'de-DE-3-0.bdic.pending'), 'utf8')).toBe('NEW')
  })
})

describe('request timeout', () => {
  /** A fetch that never answers on its own: it only ends when the request's signal aborts. */
  const hanging: Fetch = (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener('abort', () => reject(init.signal.reason)),
    )
  /** Answers every request, but the dictionary body stalls until the signal aborts. */
  const stalledBody =
    (good: Fetch): Fetch =>
    async (url, init) => {
      if (!url.endsWith('.bdic')) return good(url, init)
      const body = new ReadableStream({
        start(c) {
          init.signal.addEventListener('abort', () => c.error(init.signal.reason))
        },
      })
      return new Response(body)
    }

  it('a stalled check fails after the timeout and releases the state lock', async () => {
    const d = dir()
    const check = checkForUpdates({
      dir: d,
      fetch: hanging,
      timeoutMs: 20,
      codes: ['de-DE'],
      force: true,
      now: 1,
    })
    // Queued behind the check on the state lock: completes only if the lock is released.
    const decline = updateState(d, (s) => ({ ...s, declined: ['fr-FR'] }))
    expect((await check).kind).toBe('failed')
    await decline
    expect((await readState(d)).declined).toEqual(['fr-FR'])
  })

  it('a stalled body ends the download too; a following decline completes', async () => {
    const d = dir()
    const r = downloadDictionary({
      dir: d,
      fetch: stalledBody(release('26.11.0', { 'fr-FR-3-0.bdic': 'FR' })),
      timeoutMs: 20,
      code: 'fr-FR',
    })
    const decline = updateState(d, (s) => ({ ...s, declined: ['nl'] }))
    expect(await r).toBe('failed')
    await decline
    expect((await readState(d)).declined).toEqual(['nl'])
    expect(existsSync(join(d, 'fr-FR-3-0.bdic'))).toBe(false)
  })
})
