import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { validationInputs } from '../../../src/main/validation-inputs'

let root: string
let sets: string
let user: string
let noteDir: string

const run = (template: string, profile = '', dir: string | null = noteDir) =>
  validationInputs({ setsDir: sets, userDir: user, noteDir: dir, template, profile })

async function put(path: string, text = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'mdo-valin-')))
  sets = join(root, 'sets')
  user = join(root, 'Vorlagen')
  noteDir = join(root, 'notiz')
  await mkdir(noteDir, { recursive: true })
  await put(join(sets, 'memo', 'memo.typ'))
  await put(join(sets, 'memo', 'memo.header.md'), '---\ntemplate: memo\n---\n')
})

describe('validationInputs: set, sets, header, schema', () => {
  it('maps the template value to the set name', async () => {
    expect((await run('')).set).toBe('memo')
    expect((await run('memo')).set).toBe('memo')
    const typ = await run('/x/brief.typ')
    expect(typ).toMatchObject({ set: '', header: null, schemaText: null })
  })

  it('lists sets and reads header and schema of the winning set', async () => {
    await put(join(sets, 'memo', 'memo.schema.yaml'), 'bundled\n')
    const r = await run('memo')
    expect(r.sets).toEqual(['memo'])
    expect(r.header).toBe('---\ntemplate: memo\n---\n')
    expect(r.schemaText).toBe('bundled\n')
  })

  it('lets a user set shadow the bundled schema', async () => {
    await put(join(sets, 'memo', 'memo.schema.yaml'), 'bundled\n')
    await put(join(user, 'memo', 'memo.typ'))
    await put(join(user, 'memo', 'memo.schema.yaml'), 'user\n')
    expect((await run('memo')).schemaText).toBe('user\n')
  })

  it('gives null for a schema over 64 KiB, an unknown set and a set without schema', async () => {
    await put(join(sets, 'memo', 'memo.schema.yaml'), 'x'.repeat(64 * 1024 + 1))
    expect((await run('memo')).schemaText).toBeNull()
    const unknown = await run('fehlt')
    expect(unknown).toMatchObject({ set: 'fehlt', header: null, schemaText: null })
  })
})

describe('validationInputs: profile search', () => {
  it('is null for an empty value and for variables', async () => {
    expect((await run('memo', '')).profile).toBeNull()
    expect((await run('memo', '$HOME/p.yaml')).profile).toBeNull()
    expect((await run('memo', '%X%/p.yml')).profile).toBeNull()
  })

  it('is invalid for anything that is neither name nor yaml path', async () => {
    expect((await run('memo', 'Ich')).profile).toEqual({ status: 'invalid' })
    expect((await run('memo', 'a/b')).profile).toEqual({ status: 'invalid' })
  })

  it('reports missing with the searched folders in the pipeline order', async () => {
    const r = await run('memo', 'ich')
    expect(r.profile).toEqual({
      status: 'missing',
      searched: [
        join(noteDir, 'profiles'),
        join(user, 'memo', 'profiles'),
        join(user, 'profiles'),
        join(sets, 'memo', 'profiles'),
      ],
    })
  })

  it('skips the note folder without one and the set folder when it is <user>/<set>', async () => {
    await put(join(user, 'memo', 'memo.typ'))
    const r = await run('memo', 'ich', null)
    expect(r.profile).toEqual({
      status: 'missing',
      searched: [join(user, 'memo', 'profiles'), join(user, 'profiles')],
    })
  })

  it.each([
    [(n: string) => join(n, 'profiles')],
    [(_n: string, u: string) => join(u, 'memo', 'profiles')],
    [(_n: string, u: string) => join(u, 'profiles')],
    [(_n: string, _u: string, s: string) => join(s, 'memo', 'profiles')],
  ])('finds a profile in each searched folder', async (dirOf) => {
    await put(join(dirOf(noteDir, user, sets), 'ich.yaml'))
    expect((await run('memo', 'ich')).profile).toEqual({ status: 'found' })
  })

  it('does not count a folder named like the profile', async () => {
    await mkdir(join(noteDir, 'profiles', 'ich.yaml'), { recursive: true })
    expect((await run('memo', 'ich')).profile).toMatchObject({ status: 'missing' })
  })

  it('resolves a path value against the note folder and ~ against home', async () => {
    await put(join(noteDir, 'p.yaml'))
    expect((await run('memo', 'p.yaml')).profile).toEqual({ status: 'found' })
    expect((await run('memo', 'q.yml')).profile).toEqual({
      status: 'missing',
      searched: [join(noteDir, 'q.yml')],
    })
    expect((await run('memo', '~/mdo-test-none.yml')).profile).toEqual({
      status: 'missing',
      searched: [join(homedir(), 'mdo-test-none.yml')],
    })
    // An absolute path needs no note folder; a relative one cannot be checked without it.
    expect((await run('memo', join(noteDir, 'p.yaml'), null)).profile).toEqual({ status: 'found' })
    expect((await run('memo', 'p.yaml', null)).profile).toBeNull()
  })
})

describe('validationInputs: single .typ template', () => {
  it('searches <dir of the .typ>/profiles (build.sh does, without a set name)', async () => {
    await put(join(noteDir, 'brief.typ'))
    expect((await run('brief.typ', 'ich')).profile).toMatchObject({ status: 'missing' })
    await put(join(noteDir, 'profiles', 'ich.yaml'))
    expect((await run('brief.typ', 'ich')).profile).toEqual({ status: 'found' })
    // Relative to the note's folder, like build.sh: ../brief.typ from notiz/sub.
    expect((await run('../brief.typ', 'ich', join(noteDir, 'sub'))).profile).toEqual({
      status: 'found',
    })
  })

  it('lists that folder in searched when the profile is missing', async () => {
    const r = await run('vorl/brief.typ', 'ich')
    expect(r.profile).toEqual({
      status: 'missing',
      searched: [
        join(noteDir, 'profiles'),
        join(user, 'profiles'),
        join(noteDir, 'vorl', 'profiles'),
      ],
    })
  })

  it('does not judge a profile name when the .typ folder is unknown', async () => {
    expect((await run('brief.typ', 'ich', null)).profile).toBeNull()
    expect((await run('$HOME/brief.typ', 'ich')).profile).toBeNull()
    expect((await run('brief.typ', 'p.yaml', null)).profile).toBeNull()
  })
})
