import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  listProfiles,
  listSets,
  readSetHeader,
  userTemplatesDir,
} from '../../../src/main/templates'

const MEMO = '---\n# Memo-Kopf\ntemplate: memo   # Set\n---\n'
const DIN = '---\n# Brief\ntemplate: din5008a\nprofile: beispiel   # Profil\n---\n'

/** Writes files (paths relative to a fresh temp dir) and returns the dir. */
async function tree(files: Record<string, string | Buffer>): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mdo-tpl-'))
  for (const [rel, body] of Object.entries(files)) {
    const p = join(d, rel)
    await mkdir(join(p, '..'), { recursive: true })
    await writeFile(p, body)
  }
  return d
}

/** A bundled sets dir with memo and din5008a plus a user dir. */
async function fixture(user: Record<string, string | Buffer> = {}) {
  const root = await tree({
    'sets/memo/memo.typ': '',
    'sets/memo/memo.header.md': MEMO,
    'sets/din5008a/din5008a.typ': '',
    'sets/din5008a/din5008a.header.md': DIN,
    'sets/din5008a/profiles/beispiel.yaml': '',
    ...Object.fromEntries(Object.entries(user).map(([k, v]) => [`user/${k}`, v])),
  })
  await mkdir(join(root, 'user'), { recursive: true })
  return { sets: join(root, 'sets'), user: join(root, 'user') }
}

describe('userTemplatesDir', () => {
  it('uses MDO_TEMPLATES, relative to the working directory', () => {
    expect(userTemplatesDir({ MDO_TEMPLATES: '/abs/v' }, '/docs')).toBe(resolve('/abs/v'))
    expect(userTemplatesDir({ MDO_TEMPLATES: 'rel/v' }, '/docs')).toBe(
      resolve(process.cwd(), 'rel/v'),
    )
  })

  it('falls back to <documents>/Markdown Office/Vorlagen (also for an empty value)', () => {
    const expected = join('/docs', 'Markdown Office', 'Vorlagen')
    expect(userTemplatesDir({}, '/docs')).toBe(expected)
    expect(userTemplatesDir({ MDO_TEMPLATES: '' }, '/docs')).toBe(expected)
  })
})

describe('listSets', () => {
  it('lists bundled sets sorted, with hint and profile flag', async () => {
    const { sets, user } = await fixture()
    expect(await listSets(sets, user)).toEqual([
      { name: 'din5008a', source: 'bundled', hint: 'Brief', hasProfile: true },
      { name: 'memo', source: 'bundled', hint: 'Memo-Kopf', hasProfile: false },
    ])
  })

  it('finds flat and folder user sets; a user set shadows a bundled one', async () => {
    const { sets, user } = await fixture({
      'flat.typ': '',
      'flat.header.md': '---\n# Flach\ntemplate: flat\n---\n',
      'eigen/eigen.typ': '',
      'eigen/eigen.header.md': '---\n# Eigen\n---\n',
      'memo.typ': '',
      'nohead/nohead.typ': '',
    })
    const list = await listSets(sets, user)
    expect(list.map((s) => [s.name, s.source, s.hint])).toEqual([
      ['din5008a', 'bundled', 'Brief'],
      ['eigen', 'user', 'Eigen'],
      ['flat', 'user', 'Flach'],
      // The user's flat memo.typ wins and has no header file next to it.
      ['memo', 'user', 'ohne Header-Vorlage'],
      ['nohead', 'user', 'ohne Header-Vorlage'],
    ])
  })

  it('ignores bad names, folders without <n>.typ and non-files', async () => {
    const { sets, user } = await fixture({
      'Bad.typ': '',
      'with space.typ': '',
      'empty/readme.md': '',
      'notes.md': '',
    })
    await mkdir(join(user, 'dir.typ'))
    await mkdir(join(sets, 'loose'))
    expect((await listSets(sets, user)).map((s) => s.name)).toEqual(['din5008a', 'memo'])
  })

  it('returns [] for missing folders and does not create them', async () => {
    const missing = join(tmpdir(), `mdo-none-${Date.now()}`)
    expect(await listSets(join(missing, 's'), join(missing, 'u'))).toEqual([])
    await expect(stat(missing)).rejects.toThrow()
  })

  it('treats an oversized or invalid UTF-8 header as no header', async () => {
    const { sets, user } = await fixture({
      'big.typ': '',
      'big.header.md': `---\nprofile: x\n# ${'x'.repeat(64 * 1024)}\n---\n`,
      'bin.typ': '',
      'bin.header.md': Buffer.from([0x2d, 0xff, 0xfe]),
    })
    const list = await listSets(sets, user)
    for (const name of ['big', 'bin']) {
      expect(list.find((s) => s.name === name)).toEqual({
        name,
        source: 'user',
        hint: 'ohne Header-Vorlage',
        hasProfile: false,
      })
    }
  })
})

describe('readSetHeader', () => {
  it('reads the winning set header, BOM stripped', async () => {
    const { sets, user } = await fixture({
      'eigen/eigen.typ': '',
      'eigen/eigen.header.md': Buffer.from('﻿---\ntemplate: eigen\n---\n', 'utf8'),
    })
    expect(await readSetHeader(sets, user, 'memo')).toBe(MEMO)
    expect(await readSetHeader(sets, user, 'eigen')).toBe('---\ntemplate: eigen\n---\n')
  })

  it('reads the header next to a flat user set, not the shadowed bundled one', async () => {
    const { sets, user } = await fixture({
      'memo.typ': '',
      'memo.header.md': '---\ntemplate: memo # mine\n---\n',
    })
    expect(await readSetHeader(sets, user, 'memo')).toBe('---\ntemplate: memo # mine\n---\n')
  })

  it('falls back to a minimal header (missing, oversized or invalid UTF-8 file)', async () => {
    const { sets, user } = await fixture({
      'a.typ': '',
      'b.typ': '',
      'b.header.md': 'x'.repeat(64 * 1024 + 1),
      'c.typ': '',
      'c.header.md': Buffer.from([0xff]),
    })
    for (const n of ['a', 'b', 'c']) {
      expect(await readSetHeader(sets, user, n)).toBe(`---\ntemplate: ${n}\n---\n`)
    }
  })

  it('is null for unknown sets and invalid names (never a path)', async () => {
    const { sets, user } = await fixture()
    for (const n of ['nope', '../sets/memo/memo', 'Memo', '', 'memo/memo']) {
      expect(await readSetHeader(sets, user, n)).toBeNull()
    }
  })

  it.skipIf(process.platform === 'win32')(
    'never opens a FIFO header file (it would block a libuv thread)',
    async () => {
      const { sets, user } = await fixture({ 'f.typ': '' })
      execFileSync('mkfifo', [join(user, 'f.header.md')])
      expect(await readSetHeader(sets, user, 'f')).toBe('---\ntemplate: f\n---\n')
      expect((await listSets(sets, user)).find((s) => s.name === 'f')?.hint).toBe(
        'ohne Header-Vorlage',
      )
    },
  )
})

describe('listProfiles', () => {
  it('merges user and set profiles, deduplicated and sorted; .yml and bad names ignored', async () => {
    const { sets, user } = await fixture({
      'profiles/kanzlei.yaml': '',
      'profiles/beispiel.yaml': '',
      'profiles/alt.yml': '',
      'profiles/Bad.yaml': '',
      'profiles/notes.md': '',
    })
    await mkdir(join(user, 'profiles', 'dir.yaml'))
    expect(await listProfiles(sets, user, 'din5008a')).toEqual(['beispiel', 'kanzlei'])
  })

  it('uses the profiles folder of the winning set', async () => {
    const { sets, user } = await fixture({
      'din5008a/din5008a.typ': '',
      'din5008a/profiles/eigenes.yaml': '',
    })
    expect(await listProfiles(sets, user, 'din5008a')).toEqual(['eigenes'])
  })

  it('is [] for unknown sets, invalid names and missing folders', async () => {
    const { sets, user } = await fixture()
    expect(await listProfiles(sets, user, 'memo')).toEqual([])
    expect(await listProfiles(sets, user, 'nope')).toEqual([])
    expect(await listProfiles(sets, user, '../x')).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('skips a FIFO profile', async () => {
    const { sets, user } = await fixture({ 'profiles/ok.yaml': '' })
    execFileSync('mkfifo', [join(user, 'profiles', 'pipe.yaml')])
    expect(await listProfiles(sets, user, 'din5008a')).toEqual(['beispiel', 'ok'])
  })
})
