import { mkdtemp, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Ch } from '../../../src/shared/ipc'

type Handler = (e: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const showItemInFolder = vi.fn()
const openPath = vi.fn(async (_p: string) => '')

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: (ch: string, fn: Handler) => handlers.set(ch, fn),
    on: vi.fn(),
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  shell: {
    showItemInFolder: (p: string) => showItemInFolder(p),
    openPath: (p: string) => openPath(p),
  },
}))

const { AppContext } = await import('../../../src/main/context')
const { registerIpc } = await import('../../../src/main/ipc')

const invoke = (ch: string, ...args: unknown[]) => {
  const h = handlers.get(ch)
  if (!h) throw new Error(`no handler for ${ch}`)
  return Promise.resolve(h({ sender: {} }, ...args))
}

let root: string
let base: string
let ctx: InstanceType<typeof AppContext>
const savedTemplates = process.env.MDO_TEMPLATES

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'mdo-ipc-reveal-')))
  base = join(root, 'Markdown Office')
  delete process.env.MDO_TEMPLATES
  handlers.clear()
  showItemInFolder.mockClear()
  openPath.mockReset()
  openPath.mockImplementation(async () => '')
  const paths = { root: join(root, 'p'), sets: join(root, 'sets'), cli: '', fonts: '' }
  ctx = new AppContext(join(root, 'user-data'), base, { paths, version: 'dev' })
  registerIpc(ctx)
})

afterEach(() => {
  if (savedTemplates === undefined) delete process.env.MDO_TEMPLATES
  else process.env.MDO_TEMPLATES = savedTemplates
})

describe('reveal in file manager', () => {
  it('shows an allowed note', async () => {
    const note = join(root, 'a.md')
    await writeFile(note, 'A')
    ctx.allow([note])
    expect(await invoke(Ch.revealPath, note)).toBeNull()
    expect(showItemInFolder).toHaveBeenCalledWith(note)
  })

  it('refuses a path main did not allow', async () => {
    const note = join(root, 'fremd.md')
    await writeFile(note, 'A')
    expect(await invoke(Ch.revealPath, note)).toMatch(/^Zugriff verweigert/)
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('reports a missing file instead of doing nothing', async () => {
    const note = join(root, 'weg.md')
    ctx.allow([note])
    expect(await invoke(Ch.revealPath, note)).toBe(`Datei nicht gefunden: ${note}`)
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('rejects a non-string argument', async () => {
    expect(await invoke(Ch.revealPath, 42)).toBe('Ungültiger Parameter.')
    expect(showItemInFolder).not.toHaveBeenCalled()
  })
})

describe('open templates folder', () => {
  it('creates the Vorlagen folder when missing and opens it', async () => {
    const dir = join(base, 'Vorlagen')
    expect(await invoke(Ch.openTemplatesFolder)).toBeNull()
    expect((await stat(dir)).isDirectory()).toBe(true)
    expect(openPath).toHaveBeenCalledWith(dir)
  })

  it('follows MDO_TEMPLATES like the set listing', async () => {
    process.env.MDO_TEMPLATES = join(root, 'eigene')
    expect(await invoke(Ch.openTemplatesFolder)).toBeNull()
    expect(openPath).toHaveBeenCalledWith(join(root, 'eigene'))
  })

  it('returns the openPath error for the user', async () => {
    openPath.mockImplementation(async () => 'kein Programm')
    expect(await invoke(Ch.openTemplatesFolder)).toBe(
      'Vorlagen-Ordner konnte nicht geöffnet werden: kein Programm',
    )
  })
})
