import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Ch } from '../../../src/shared/ipc'

type Handler = (e: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: (ch: string, fn: Handler) => handlers.set(ch, fn),
    on: vi.fn(),
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}))

const { AppContext } = await import('../../../src/main/context')
const { registerIpc } = await import('../../../src/main/ipc')

const invoke = (ch: string, ...args: unknown[]) => {
  const h = handlers.get(ch)
  if (!h) throw new Error(`no handler for ${ch}`)
  return Promise.resolve(h({ sender: {} }, ...args))
}

const MEMO = '---\ntemplate: memo  # Vorlage\n---\n'
let root: string
let sets: string
let documents: string
let app: InstanceType<typeof AppContext>
const savedTemplates = process.env.MDO_TEMPLATES

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'mdo-ipc-tpl-')))
  sets = join(root, 'sets')
  documents = join(root, 'Dokumente')
  await mkdir(join(sets, 'memo', 'profiles'), { recursive: true })
  await writeFile(join(sets, 'memo', 'memo.typ'), '')
  await writeFile(join(sets, 'memo', 'memo.header.md'), `# Notiz\n${MEMO}`)
  await writeFile(join(sets, 'memo', 'profiles', 'beispiel.yaml'), 'name: x\n')
  delete process.env.MDO_TEMPLATES
  handlers.clear()
  const paths = { root: join(root, 'p'), sets, cli: '', fonts: '' }
  app = new AppContext(join(root, 'user-data'), documents, { paths, version: 'dev' })
  registerIpc(app)
})

afterEach(() => {
  if (savedTemplates === undefined) delete process.env.MDO_TEMPLATES
  else process.env.MDO_TEMPLATES = savedTemplates
})

describe('template IPC', () => {
  it('lists the bundled sets and reads a set header', async () => {
    expect(await invoke(Ch.listSets)).toEqual([
      { name: 'memo', source: 'bundled', hint: 'Notiz', hasProfile: false },
    ])
    expect(await invoke(Ch.readSetHeader, 'memo')).toBe(`# Notiz\n${MEMO}`)
    expect(await invoke(Ch.listProfiles, 'memo')).toEqual(['beispiel'])
  })

  it('reads user sets from <documents>/Markdown Office/Vorlagen by default', async () => {
    const user = join(documents, 'Markdown Office', 'Vorlagen')
    await mkdir(user, { recursive: true })
    await writeFile(join(user, 'eigen.typ'), '')
    const list = (await invoke(Ch.listSets)) as { name: string; source: string }[]
    expect(list.map((s) => [s.name, s.source])).toEqual([
      ['eigen', 'user'],
      ['memo', 'bundled'],
    ])
    expect(await invoke(Ch.readSetHeader, 'eigen')).toBe('---\ntemplate: eigen\n---\n')
  })

  it('honours MDO_TEMPLATES, read at call time like the pipeline', async () => {
    const user = join(root, 'Vorlagen-Test')
    await mkdir(join(user, 'profiles'), { recursive: true })
    await writeFile(join(user, 'brief.typ'), '')
    await writeFile(join(user, 'profiles', 'kanzlei.yaml'), 'name: k\n')
    process.env.MDO_TEMPLATES = user
    const list = (await invoke(Ch.listSets)) as { name: string }[]
    expect(list.map((s) => s.name)).toEqual(['brief', 'memo'])
    expect(await invoke(Ch.listProfiles, 'memo')).toEqual(['beispiel', 'kanzlei'])
  })

  it.each([
    ['../memo'],
    ['memo/../memo'],
    ['Memo'],
    [''],
    ['a'.repeat(200)],
    [42],
    [null],
    [{ name: 'memo' }],
  ])('refuses the name %j without touching the disk', async (name) => {
    expect(await invoke(Ch.readSetHeader, name)).toBeNull()
    expect(await invoke(Ch.listProfiles, name)).toEqual([])
  })

  it('answers null / [] for a set that does not exist', async () => {
    expect(await invoke(Ch.readSetHeader, 'fehlt')).toBeNull()
    expect(await invoke(Ch.listProfiles, 'fehlt')).toEqual([])
  })

  it('creates a profile and allows exactly its YAML for the renderer', async () => {
    const user = join(root, 'Vorlagen-Test')
    process.env.MDO_TEMPLATES = user
    await writeFile(
      join(sets, 'memo', 'memo.header.md'),
      '---\ntemplate: memo\nprofile: beispiel\n---\n',
    )
    const res = (await invoke(Ch.createProfile, 'memo', 'kanzlei')) as { ok: boolean; path: string }
    const yaml = join(user, 'memo', 'profiles', 'kanzlei.yaml')
    expect(res).toEqual({ ok: true, path: yaml })
    // The renderer may read the new file (allowed), as for a note it opened.
    expect(await invoke(Ch.readNote, yaml)).toMatchObject({ path: yaml, text: 'name: x\n' })
    expect(await invoke(Ch.createProfile, 'memo', 'kanzlei')).toEqual({
      ok: false,
      error: 'Profil kanzlei gibt es schon.',
    })
  })

  it.each([
    ['../memo', 'k'],
    ['memo', '../k'],
    ['memo', 'K'],
    [42, 'k'],
    ['memo', null],
  ])('refuses createProfile(%j, %j)', async (set, name) => {
    expect(await invoke(Ch.createProfile, set, name)).toMatchObject({ ok: false })
  })

  it('answers the validation inputs for an allowed note and for an unsaved one', async () => {
    const dir = join(root, 'notizen')
    await mkdir(join(dir, 'profiles'), { recursive: true })
    await writeFile(join(dir, 'profiles', 'ich.yaml'), 'name: x\n')
    const note = join(dir, 'a.md')
    await writeFile(note, '')
    app.allow([note])
    expect(await invoke(Ch.validationInputs, note, 'memo', 'ich')).toMatchObject({
      set: 'memo',
      sets: ['memo'],
      profile: { status: 'found' },
    })
    expect(await invoke(Ch.validationInputs, null, '', 'ich')).toMatchObject({
      set: 'memo',
      profile: { status: 'missing' },
    })
  })

  it.each([
    ['not allowed path', () => join(root, 'fremd.md'), 'memo', ''],
    ['bad template', () => null, '../memo', ''],
    ['bad template type', () => null, 42, ''],
    ['long profile', () => null, 'memo', 'a'.repeat(257)],
    ['bad profile type', () => null, 'memo', null],
    ['bad path type', () => 42, 'memo', ''],
  ])('rejects validationInputs with a %s', async (_n, path, template, profile) => {
    await writeFile(join(root, 'fremd.md'), '')
    await expect(invoke(Ch.validationInputs, path(), template, profile)).rejects.toThrow()
  })

  it('answers preview inputs for an allowed note', async () => {
    await writeFile(join(sets, 'memo', 'memo.css'), '.mdo-preview{--mdo-body-size:10pt}')
    const note = join(root, 'p.md')
    await writeFile(note, '')
    app.allow([note])
    const res = (await invoke(Ch.previewInputs, note, 'memo', '')) as {
      set: string
      css: unknown[]
    }
    expect(res.set).toBe('memo')
    expect(res.css).toHaveLength(1)
  })

  it('rejects a preview path main did not allow', async () => {
    await writeFile(join(root, 'fremd.md'), '')
    await expect(invoke(Ch.previewInputs, join(root, 'fremd.md'), 'memo', '')).rejects.toThrow()
  })

  it.each(['../x', 'A B', 'x'.repeat(65)])('rejects preview template %j', async (t) => {
    await expect(invoke(Ch.previewInputs, null, t, '')).rejects.toThrow()
  })

  it('accepts a .typ path as template', async () => {
    expect(await invoke(Ch.validationInputs, null, '/x/y.typ', '')).toMatchObject({
      set: '',
      header: null,
      schemaText: null,
    })
  })

  it('no longer offers the old memo-only channel', () => {
    expect(handlers.has('mdo:read-header-template')).toBe(false)
  })
})
