import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ch } from '../../../src/shared/ipc'

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

vi.mock('../../../src/main/files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/files')>()
  return { ...actual, canonicalPaths: vi.fn(actual.canonicalPaths) }
})

const files = await import('../../../src/main/files')
const { AppContext } = await import('../../../src/main/context')
const { registerIpc } = await import('../../../src/main/ipc')

const invoke = (ch: string, ...args: unknown[]) => {
  const h = handlers.get(ch)
  if (!h) throw new Error(`no handler for ${ch}`)
  return h({ sender: {} }, ...args)
}

let real: string
let link: string
let userData: string
let ctx: InstanceType<typeof AppContext>

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mdo-ipc-'))
  real = join(await realpath(dir), 'echt')
  link = join(dir, 'verknuepft')
  userData = join(dir, 'user-data')
  await mkdir(real)
  await mkdir(userData)
  // Junctions need no admin rights on Windows; the type is ignored elsewhere.
  await symlink(real, link, 'junction')
  await writeFile(join(real, 'a.md'), 'A')
  handlers.clear()
  showOpenDialog.mockReset()
  vi.mocked(files.canonicalPaths).mockClear()
  ctx = new AppContext(userData, userData)
  registerIpc(ctx)
})

/** File symlinks need admin rights or developer mode on Windows: skip there if refused. */
async function fileLink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, 'file')
    return true
  } catch {
    return false
  }
}

describe('ipc paths', () => {
  it('applies only the latest watch list when calls resolve out of order', async () => {
    await ctx.openPaths([join(real, 'a.md')])
    await writeFile(join(real, 'b.md'), 'B')
    await ctx.openPaths([join(real, 'b.md')])
    const setFiles = vi.spyOn(ctx.watcher, 'setFiles').mockImplementation(() => undefined)
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      release = r
    })
    const actual = vi.mocked(files.canonicalPaths).getMockImplementation()
    if (!actual) throw new Error('missing implementation')
    vi.mocked(files.canonicalPaths).mockImplementationOnce(async (paths) => {
      await gate
      return actual(paths)
    })

    const first = invoke(Ch.watch, [join(real, 'a.md')])
    const second = invoke(Ch.watch, [join(real, 'a.md'), join(real, 'b.md')])
    await second
    release()
    await first

    expect(setFiles).toHaveBeenLastCalledWith([join(real, 'a.md'), join(real, 'b.md')])
  })

  it('watch canonicalises paths before handing them to the watcher', async () => {
    await ctx.openPaths([join(real, 'a.md')])
    const setFiles = vi.spyOn(ctx.watcher, 'setFiles').mockImplementation(() => undefined)
    await invoke(Ch.watch, [join(link, 'a.md'), join(real, 'a.md'), join(real, 'fremd.md')])
    expect(setFiles).toHaveBeenLastCalledWith([join(real, 'a.md')])
  })

  it('refuses to save through an allowed path replaced by a link to a foreign file', async () => {
    const foreign = join(real, 'fremd.md')
    await writeFile(foreign, 'fremd')
    await ctx.openPaths([join(real, 'a.md')])
    await rm(join(real, 'a.md'))
    if (!(await fileLink(foreign, join(real, 'a.md')))) return

    const res = await invoke(Ch.saveNote, join(real, 'a.md'), 'überschrieben', false)

    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('Zugriff verweigert') })
    expect(await readFile(foreign, 'utf8')).toBe('fremd')
  })

  it('rename returns the canonical path for a note opened via a symlinked folder', async () => {
    await ctx.openPaths([join(link, 'a.md')])
    const res = await invoke(Ch.renameNote, join(link, 'a.md'), 'b')
    expect(res).toEqual({ ok: true, path: join(real, 'b.md') })
    expect(ctx.isAllowed(join(real, 'b.md'))).toBe(true)
  })

  it('newNotePath with a symlinked default folder returns canonical, distinct paths', async () => {
    ctx.settings = { ...ctx.settings, defaultFolder: link }
    const one = (await invoke(Ch.newNotePath)) as string
    const two = (await invoke(Ch.newNotePath)) as string
    expect(one.startsWith(join(real, ''))).toBe(true)
    expect(two.startsWith(join(real, ''))).toBe(true)
    expect(two).not.toBe(one)
    expect(ctx.reserved.has(one) && ctx.reserved.has(two)).toBe(true)
  })

  it('newNotePath in a missing folder under a symlinked folder is canonical', async () => {
    ctx.settings = { ...ctx.settings, defaultFolder: join(link, 'neu', 'tief') }
    const p = (await invoke(Ch.newNotePath)) as string
    expect(p.startsWith(join(real, 'neu', 'tief', ''))).toBe(true)
    expect(await readdir(join(real, 'neu'))).toEqual(['tief'])
  })

  it('the open dialog returns canonical, deduplicated, allowed paths', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [join(link, 'a.md'), join(real, 'a.md')],
    })
    expect(await invoke(Ch.openDialog)).toEqual([join(real, 'a.md')])
    expect(ctx.isAllowed(join(real, 'a.md'))).toBe(true)
    expect(ctx.isAllowed(join(link, 'a.md'))).toBe(false)
  })

  it('a note opened via a symlinked file is identified by its target', async () => {
    if (!(await fileLink(join(real, 'a.md'), join(real, 'verweis.md')))) return
    await ctx.openPaths([join(real, 'verweis.md'), join(real, 'a.md')])
    expect(ctx.startup().openPaths).toEqual([join(real, 'a.md')])
  })
})
