import { chmod, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ch } from '../../../src/shared/ipc'
import type { Settings } from '../../../src/shared/types'
import { makeFakeCli } from '../../helpers/fake-cli'

type Handler = (e: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const showOpenDialog = vi.fn()

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) },
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
  return h({ sender: {} }, ...args)
}

let root: string
let userData: string
let ctx: InstanceType<typeof AppContext>

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'mdo-settings-')))
  userData = join(root, 'user-data')
  await mkdir(userData)
  handlers.clear()
  showOpenDialog.mockReset()
  ctx = new AppContext(userData, root)
  registerIpc(ctx)
})

const stored = async (): Promise<unknown> =>
  JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'))

describe('settings:update', () => {
  it('persists valid values, returns them and applies them at once', async () => {
    const folder = join(root, 'Neue Notizen')
    const next = (await invoke(Ch.updateSettings, {
      defaultFolder: folder,
      presentFontFactor: 2.4,
      headerDefault: 'titleblock',
    })) as Settings
    expect(next).toMatchObject({
      defaultFolder: folder,
      presentFontFactor: 2.4,
      headerDefault: 'titleblock',
    })
    expect(ctx.settings).toEqual(next)
    expect(await stored()).toEqual(next)
    const note = (await invoke(Ch.newNotePath)) as string
    expect(note.startsWith(join(folder, ''))).toBe(true)
  })

  it('never persists invalid input', async () => {
    const before = { ...ctx.settings }
    const next = await invoke(Ch.updateSettings, {
      defaultFolder: 'relativ',
      snippetFolder: '',
      presentFontFactor: 7,
      headerDefault: 'xml',
    })
    expect(next).toEqual(before)
    expect(await stored()).toEqual(before)
  })

  it('a reloaded context reads the saved settings', async () => {
    await invoke(Ch.updateSettings, { presentFontFactor: 1.2, headerDefault: 'titleblock' })
    const again = new AppContext(userData, root)
    await again.load()
    expect(again.settings).toMatchObject({ presentFontFactor: 1.2, headerDefault: 'titleblock' })
  })

  it('exports through the configured pipeline with the app version', async () => {
    const bin = await mkdtemp(join(root, 'cli-'))
    const fake = await makeFakeCli(bin, { stdout: 'PDF erzeugt: a.pdf' })
    const paths = { root: join(root, 'p'), sets: join(root, 's'), cli: fake.cli, fonts: '' }
    const app = new AppContext(userData, root, { paths, version: '26.10.0' })
    const note = join(root, 'a.md')
    await writeFile(note, '# A\n')
    expect(await app.exportPdf(note)).toEqual({ kind: 'ok', message: 'PDF erzeugt: a.pdf' })
    const record = JSON.parse(await readFile(fake.recordFile, 'utf8'))
    expect(record.args).toEqual([note])
    expect(record.env).toMatchObject({ MDO_VERSION: '26.10.0', MDO_SETS_DIR: paths.sets })
  })

  it('drops keys it does not know', async () => {
    const next = (await invoke(Ch.updateSettings, { unbekannt: '/x' })) as Settings
    expect(next).not.toHaveProperty('unbekannt')
    expect(await stored()).not.toHaveProperty('unbekannt')
  })

  it('a snippet folder change is what listSnippets reads', async () => {
    const snippets = join(root, 'Bausteine')
    await mkdir(snippets)
    await writeFile(join(snippets, 'gruss.tpl.md'), 'Hallo')
    await invoke(Ch.updateSettings, { snippetFolder: snippets })
    expect(await invoke(Ch.listSnippets)).toEqual([
      { name: 'gruss', body: 'Hallo', source: 'user' },
    ])
  })
})

describe('settings:get-status', () => {
  it.skipIf(process.platform === 'win32')(
    'reports the app version and the bundled Typst version, asked once',
    async () => {
      const pipeline = join(root, 'pipeline')
      await mkdir(join(pipeline, 'bin'), { recursive: true })
      const calls = join(root, 'calls.txt')
      const typst = join(pipeline, 'bin', 'typst')
      await writeFile(typst, `#!/bin/sh\necho x >> '${calls}'\necho "typst 0.15.0 (3ae52774)"\n`)
      await chmod(typst, 0o755)
      const paths = { root: pipeline, sets: '', cli: '', fonts: '' }
      const app = new AppContext(userData, root, { paths, version: '26.10.0' })
      expect(await app.settingsStatus()).toEqual({ version: '26.10.0', typst: '0.15.0' })
      expect(await app.settingsStatus()).toEqual({ version: '26.10.0', typst: '0.15.0' })
      expect((await readFile(calls, 'utf8')).trim().split('\n')).toHaveLength(1)
    },
  )

  it('reports a missing Typst as null', async () => {
    const paths = { root: join(root, 'leer'), sets: '', cli: '', fonts: '' }
    const app = new AppContext(userData, root, { paths, version: '26.10.0' })
    expect(await app.settingsStatus()).toEqual({ version: '26.10.0', typst: null })
  })
})

describe('settings:choose-path', () => {
  it('folders: picker may create folders, returns the canonical path', async () => {
    const real = join(root, 'echt')
    const link = join(root, 'verknuepft')
    await mkdir(real)
    await symlink(real, link, 'junction')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [link] })
    expect(await invoke(Ch.choosePath, 'folder', root)).toBe(real)
    const options = showOpenDialog.mock.calls[0]?.[0] as Electron.OpenDialogOptions
    expect(options.properties).toEqual(['openDirectory', 'createDirectory'])
    expect(options.defaultPath).toBe(root)
  })

  it('cancel returns null', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await invoke(Ch.choosePath, 'folder', '')).toBeNull()
    const options = showOpenDialog.mock.calls[0]?.[0] as Electron.OpenDialogOptions
    expect(options.defaultPath).toBeUndefined()
  })

  it.each(['file', 'anything'])('rejects the kind %s', async (kind) => {
    await expect(Promise.resolve(invoke(Ch.choosePath, kind, ''))).rejects.toThrow()
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
})
