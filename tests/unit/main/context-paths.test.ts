import { mkdir, mkdtemp, realpath, rename, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: vi.fn() },
  BrowserWindow: class {},
  dialog: {},
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}))

const { AppContext } = await import('../../../src/main/context')

let real: string
let link: string
let userData: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mdo-ctx-'))
  real = join(await realpath(dir), 'echt')
  link = join(dir, 'verknuepft')
  userData = join(dir, 'user-data')
  await mkdir(real)
  await mkdir(userData)
  // Junctions need no admin rights on Windows; the type is ignored elsewhere.
  await symlink(real, link, 'junction')
  await writeFile(join(real, 'a.md'), 'x')
})

describe('AppContext paths', () => {
  it('openPaths sends one canonical path for two spellings of one file', async () => {
    const ctx = new AppContext(userData, userData)
    await ctx.openPaths([join(link, 'a.md'), join(real, 'a.md')])
    expect(ctx.startup().openPaths).toEqual([join(real, 'a.md')])
  })

  it('the allowlist holds only the canonical form and accepts both spellings', async () => {
    const ctx = new AppContext(userData, userData)
    await ctx.openPaths([join(link, 'a.md')])
    expect(ctx.isAllowed(join(real, 'a.md'))).toBe(true)
    expect(ctx.isAllowed(join(link, 'a.md'))).toBe(false)
    expect(await ctx.assertAllowed(join(link, 'a.md'))).toBe(join(real, 'a.md'))
    expect(await ctx.assertAllowed(join(real, 'a.md'))).toBe(join(real, 'a.md'))
    await expect(ctx.assertAllowed(join(real, 'b.md'))).rejects.toThrow('Zugriff verweigert')
  })

  it('session restore canonicalises and drops duplicates, keeping the first', async () => {
    await writeFile(
      join(userData, 'session.json'),
      JSON.stringify({
        tabs: [
          { path: join(link, 'a.md'), headerHidden: true },
          { path: join(real, 'a.md'), headerHidden: false },
        ],
        activeIndex: 1,
        recent: [join(real, 'a.md'), join(link, 'a.md')],
      }),
    )
    const ctx = new AppContext(userData, userData)
    await ctx.load()
    expect(ctx.session.tabs).toEqual([{ path: join(real, 'a.md'), headerHidden: true }])
    expect(ctx.session.activeIndex).toBe(0)
    expect(ctx.session.recent).toEqual([join(real, 'a.md')])
    expect(ctx.isAllowed(join(real, 'a.md'))).toBe(true)
  })

  it('updateSession stores canonical tab paths without duplicates', async () => {
    const ctx = new AppContext(userData, userData)
    await ctx.openPaths([join(real, 'a.md')])
    await ctx.updateSession({
      tabs: [
        { path: join(link, 'a.md'), headerHidden: false },
        { path: join(real, 'a.md'), headerHidden: true },
      ],
    })
    expect(ctx.session.tabs).toEqual([{ path: join(real, 'a.md'), headerHidden: false }])
  })

  it('follows an external case-only rename of an open note instead of refusing it', async () => {
    const ctx = new AppContext(userData, userData)
    await ctx.openPaths([join(real, 'a.md')])
    await rename(join(real, 'a.md'), join(real, 'A.md'))
    if (!(await caseInsensitive(real))) return // the old spelling is simply gone there

    expect(await ctx.assertAllowed(join(real, 'a.md'))).toBe(join(real, 'A.md'))
    expect(ctx.isAllowed(join(real, 'A.md'))).toBe(true)
  })

  it('follows a case-only rename of a parent folder', async () => {
    const ctx = new AppContext(userData, userData)
    await mkdir(join(real, 'ordner'))
    await writeFile(join(real, 'ordner', 'n.md'), 'n')
    await ctx.openPaths([join(real, 'ordner', 'n.md')])
    await rename(join(real, 'ordner'), join(real, 'Ordner'))
    if (!(await caseInsensitive(real))) return

    expect(await ctx.assertAllowed(join(real, 'ordner', 'n.md'))).toBe(join(real, 'Ordner', 'n.md'))
  })

  it('still refuses a spelling that was never allowed', async () => {
    const ctx = new AppContext(userData, userData)
    await ctx.openPaths([join(real, 'a.md')])
    if (!(await caseInsensitive(real))) return
    await writeFile(join(real, 'b.md'), 'b')
    await expect(ctx.assertAllowed(join(real, 'B.md'))).rejects.toThrow('Zugriff verweigert')
  })
})

/** True when the folder treats `x` and `X` as the same name (macOS/Windows defaults). */
async function caseInsensitive(folder: string): Promise<boolean> {
  await writeFile(join(folder, 'probe-case'), '')
  return stat(join(folder, 'PROBE-CASE')).then(
    () => true,
    () => false,
  )
}
