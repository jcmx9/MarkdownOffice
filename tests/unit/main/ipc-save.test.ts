import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashBytes, noteBytes } from '../../../src/main/files'
import { Ch } from '../../../src/shared/ipc'
import type { NoteFile, SaveResult } from '../../../src/shared/types'

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
  return h({ sender: {} }, ...args)
}
const save = (path: string, text: string, base: string | null, force = false) =>
  invoke(Ch.saveNote, path, text, false, base, force) as Promise<SaveResult>
const hashOf = (text: string) => hashBytes(noteBytes(text, false))

let dir: string
let note: string
let ctx: InstanceType<typeof AppContext>

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'mdo-save-')))
  note = join(dir, 'a.md')
  await writeFile(note, 'geladen')
  handlers.clear()
  ctx = new AppContext(dir, dir)
  registerIpc(ctx)
  await ctx.openPaths([note])
})

/** Loads the note like the renderer does; returns the base hash. */
async function load(path = note): Promise<string> {
  const res = (await invoke(Ch.readNote, path)) as NoteFile
  return res.hash
}

describe('saveNote base check', () => {
  it('writes when the disk still holds the base', async () => {
    const base = await load()
    const res = await save(note, 'getippt', base)
    expect(res).toEqual({ ok: true, hash: hashOf('getippt') })
    expect(await readFile(note, 'utf8')).toBe('getippt')
  })

  it('refuses without writing when the disk changed outside since the base', async () => {
    const base = await load()
    await writeFile(note, 'von außen')

    const res = await save(note, 'getippt', base)

    expect(res).toMatchObject({
      ok: false,
      conflict: { kind: 'changed', note: { path: note, text: 'von außen' } },
    })
    expect(await readFile(note, 'utf8')).toBe('von außen')
    expect(await readdir(dir)).not.toContainEqual(expect.stringMatching(/^\.a\.md\..*\.tmp$/))
  })

  it('refuses invalid UTF-8 written outside as unreadable', async () => {
    const base = await load()
    const ansi = Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]) // "Grüße" in Latin-1
    await writeFile(note, ansi)

    const res = await save(note, 'getippt', base)

    expect(res).toMatchObject({ ok: false, conflict: { kind: 'unreadable', reason: 'encoding' } })
    expect(Buffer.compare(await readFile(note), ansi)).toBe(0)
  })

  it('refuses a note deleted outside instead of recreating it', async () => {
    const base = await load()
    await rm(note)

    const res = await save(note, 'getippt', base)

    expect(res).toEqual({ ok: false, conflict: { kind: 'deleted', path: note } })
    expect(await readdir(dir)).not.toContain('a.md')
  })

  it('creates a new note whose file does not exist yet (no base)', async () => {
    const fresh = (await invoke(Ch.newNotePath)) as string
    const res = await save(fresh, 'neu', null)
    expect(res).toEqual({ ok: true, hash: hashOf('neu') })
    expect(await readFile(fresh, 'utf8')).toBe('neu')
  })

  it('refuses a new note when a file appeared at its path meanwhile', async () => {
    const fresh = (await invoke(Ch.newNotePath)) as string
    await writeFile(fresh, 'fremd')
    const res = await save(fresh, 'neu', null)
    expect(res).toMatchObject({ ok: false, conflict: { kind: 'changed' } })
    expect(await readFile(fresh, 'utf8')).toBe('fremd')
  })

  it('force overwrites an external change (explicit user choice)', async () => {
    const base = await load()
    await writeFile(note, 'von außen')
    const res = await save(note, 'meine', base, true)
    expect(res).toEqual({ ok: true, hash: hashOf('meine') })
    expect(await readFile(note, 'utf8')).toBe('meine')
  })

  it('force recreates a note deleted outside', async () => {
    const base = await load()
    await rm(note)
    expect(await save(note, 'wieder da', base, true)).toMatchObject({ ok: true })
    expect(await readFile(note, 'utf8')).toBe('wieder da')
  })

  it('passes when the disk holds our own newer write although the base lags', async () => {
    const base = await load()
    expect(await save(note, 'eins', base)).toMatchObject({ ok: true })
    // The renderer never learnt about "eins" (e.g. the reply got lost): base is still old.
    const res = await save(note, 'zwei', base)
    expect(res).toMatchObject({ ok: true })
    expect(await readFile(note, 'utf8')).toBe('zwei')
  })

  it('does not pass content the watcher merely reported (not our own write)', async () => {
    const base = await load()
    await writeFile(note, 'von außen')
    // As if the watcher had already accepted it as reported content.
    const reported = hashOf('von außen')
    ctx.watcher.acknowledge(note, reported)
    const res = await save(note, 'getippt', base)
    expect(res).toMatchObject({ ok: false, conflict: { kind: 'changed' } })
  })

  it('a refused save marks the disk state as reported, so the watcher stays silent', async () => {
    const base = await load()
    await writeFile(note, 'von außen')
    const acknowledge = vi.spyOn(ctx.watcher, 'acknowledge')
    await save(note, 'getippt', base)
    expect(acknowledge).toHaveBeenCalledWith(note, hashOf('von außen'))
  })

  it('reports a read error before the write as an error, without writing', async () => {
    if (process.platform === 'win32') return
    const base = await load()
    const { chmod } = await import('node:fs/promises')
    await chmod(note, 0o000)
    try {
      const res = await save(note, 'getippt', base)
      if (process.getuid?.() === 0) return // root reads anyway
      expect(res).toMatchObject({ ok: false, error: expect.any(String) })
    } finally {
      await chmod(note, 0o644)
    }
    expect(await readFile(note, 'utf8')).toBe('geladen')
  })

  it('rejects a malformed base', async () => {
    expect(await save(note, 'x', 42 as unknown as string)).toMatchObject({ ok: false })
    expect(await readFile(note, 'utf8')).toBe('geladen')
  })

  it('follows an external case-only rename and returns the new spelling', async () => {
    const base = await load()
    const { rename, stat } = await import('node:fs/promises')
    await rename(note, join(dir, 'A.md'))
    const insensitive = await stat(note).then(
      () => true,
      () => false,
    )
    if (!insensitive) return
    const res = await save(note, 'getippt', base)
    expect(res).toEqual({ ok: true, hash: hashOf('getippt'), path: join(dir, 'A.md') })
    expect(await readdir(dir)).toContain('A.md')
    expect(await readFile(join(dir, 'A.md'), 'utf8')).toBe('getippt')
  })

  it('a refusal after an outside case-only rename carries the new spelling', async () => {
    const base = await load()
    const { rename, stat } = await import('node:fs/promises')
    await rename(note, join(dir, 'A.md'))
    const insensitive = await stat(note).then(
      () => true,
      () => false,
    )
    if (!insensitive) return
    await writeFile(join(dir, 'A.md'), 'von außen')
    const res = await save(note, 'getippt', base)
    expect(res).toMatchObject({
      ok: false,
      path: join(dir, 'A.md'),
      conflict: { kind: 'changed', note: { path: join(dir, 'A.md') } },
    })
    expect(await readFile(join(dir, 'A.md'), 'utf8')).toBe('von außen')
  })
})
