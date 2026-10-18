import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProfile, renameCompanionValues } from '../../../src/main/profiles'
import { listProfiles } from '../../../src/main/templates'

const DIN = '---\n# Brief\ntemplate: din5008a\nprofile: beispiel   # Profil\n---\n'
const EXAMPLE =
  '# Beispielprofil\nname: Anna\nsignature: beispiel-unterschrift.svg   # SVG\nlogo: "beispiel.logo.png"\nnote: beispiel-unterschrift.svg und mehr\n'
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])

/** Writes files (paths relative to a fresh temp dir) and returns the dir. */
async function tree(files: Record<string, string | Buffer>): Promise<string> {
  const d = await realpath(await mkdtemp(join(tmpdir(), 'mdo-prof-')))
  for (const [rel, body] of Object.entries(files)) {
    const p = join(d, rel)
    await mkdir(join(p, '..'), { recursive: true })
    await writeFile(p, body)
  }
  return d
}

async function fixture(extra: Record<string, string | Buffer> = {}) {
  const root = await tree({
    'sets/din5008a/din5008a.typ': '',
    'sets/din5008a/din5008a.header.md': DIN,
    'sets/din5008a/profiles/beispiel.yaml': EXAMPLE,
    'sets/din5008a/profiles/beispiel-unterschrift.svg': SVG,
    'sets/din5008a/profiles/beispiel.logo.png': PNG,
    // Not companions: another profile, and a name that only starts with the same letters.
    'sets/din5008a/profiles/beispielhaft.yaml': 'name: b\n',
    'sets/memo/memo.typ': '',
    'sets/memo/memo.header.md': '---\ntemplate: memo\n---\n',
    ...extra,
  })
  return { sets: join(root, 'sets'), user: join(root, 'user'), root }
}

describe('createProfile', () => {
  it('copies the example and its companions to Vorlagen/<set>/profiles, references renamed', async () => {
    const { sets, user } = await fixture()
    const res = await createProfile(sets, user, 'din5008a', 'kanzlei')
    const dir = join(user, 'din5008a', 'profiles')
    expect(res).toEqual({ ok: true, path: join(dir, 'kanzlei.yaml') })
    expect((await readdir(dir)).sort()).toEqual([
      'kanzlei-unterschrift.svg',
      'kanzlei.logo.png',
      'kanzlei.yaml',
    ])
    expect(await readFile(join(dir, 'kanzlei.yaml'), 'utf8')).toBe(
      '# Beispielprofil\nname: Anna\nsignature: kanzlei-unterschrift.svg   # SVG\nlogo: "kanzlei.logo.png"\nnote: beispiel-unterschrift.svg und mehr\n',
    )
    // Binary companions byte for byte.
    expect(await readFile(join(dir, 'kanzlei.logo.png'))).toEqual(PNG)
    expect(await readFile(join(dir, 'kanzlei-unterschrift.svg'))).toEqual(SVG)
    // The picker offers it at once (lookup step 2).
    expect(await listProfiles(sets, user, 'din5008a')).toContain('kanzlei')
  })

  it('never overwrites: the same name again is refused and the files stay as they are', async () => {
    const { sets, user } = await fixture()
    await createProfile(sets, user, 'din5008a', 'kanzlei')
    const yaml = join(user, 'din5008a', 'profiles', 'kanzlei.yaml')
    await writeFile(yaml, 'name: geändert\n')
    expect(await createProfile(sets, user, 'din5008a', 'kanzlei')).toEqual({
      ok: false,
      error: 'Profil kanzlei gibt es schon.',
    })
    expect(await readFile(yaml, 'utf8')).toBe('name: geändert\n')
  })

  it('refuses when only a companion target exists, and creates nothing', async () => {
    const { sets, user } = await fixture()
    const dir = join(user, 'din5008a', 'profiles')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'kanzlei-unterschrift.svg'), 'mine')
    expect(await createProfile(sets, user, 'din5008a', 'kanzlei')).toEqual({
      ok: false,
      error: 'Profil kanzlei gibt es schon.',
    })
    expect(await readdir(dir)).toEqual(['kanzlei-unterschrift.svg'])
    expect(await readFile(join(dir, 'kanzlei-unterschrift.svg'), 'utf8')).toBe('mine')
  })

  it('refuses a set without an example profile and an unknown set', async () => {
    const { sets, user } = await fixture()
    expect(await createProfile(sets, user, 'memo', 'kanzlei')).toEqual({
      ok: false,
      error: 'Vorlage memo bringt kein Beispielprofil mit.',
    })
    expect(await createProfile(sets, user, 'fehlt', 'kanzlei')).toMatchObject({ ok: false })
  })

  it('refuses a header whose example file is missing', async () => {
    const { sets, user } = await fixture({
      'sets/brief/brief.typ': '',
      'sets/brief/brief.header.md': '---\ntemplate: brief\nprofile: weg\n---\n',
    })
    expect(await createProfile(sets, user, 'brief', 'kanzlei')).toEqual({
      ok: false,
      error: 'Vorlage brief bringt kein Beispielprofil mit.',
    })
  })

  it.each(['Kanzlei', '../x', 'a b', '', 'a'.repeat(65)])(
    'refuses the profile name %j without touching the disk',
    async (name) => {
      const { sets, user } = await fixture()
      expect(await createProfile(sets, user, 'din5008a', name)).toMatchObject({ ok: false })
      await expect(readdir(user)).rejects.toThrow()
    },
  )

  it('uses a user set folder that holds the set itself (example and copy side by side)', async () => {
    const { sets, user } = await fixture({
      'user/brief/brief.typ': '',
      'user/brief/brief.header.md': '---\ntemplate: brief\nprofile: muster\n---\n',
      'user/brief/profiles/muster.yaml': 'name: m\n',
    })
    expect(await createProfile(sets, user, 'brief', 'neu')).toMatchObject({ ok: true })
    expect((await readdir(join(user, 'brief', 'profiles'))).sort()).toEqual([
      'muster.yaml',
      'neu.yaml',
    ])
  })
})

describe('renameCompanionValues', () => {
  const map = new Map([['a.svg', 'b.svg']])
  it.each([
    ['sig: a.svg', 'sig: b.svg'],
    ['sig: a.svg\r', 'sig: b.svg\r'],
    ["sig: 'a.svg'  # c", "sig: 'b.svg'  # c"],
    ['sig:   a.svg # c', 'sig:   b.svg # c'],
    ['sig: xa.svg', 'sig: xa.svg'],
    ['# sig: a.svg', '# sig: a.svg'],
    ['sig: a.svg.bak', 'sig: a.svg.bak'],
  ])('%j → %j', (line, out) => expect(renameCompanionValues(line, map)).toBe(out))
})
