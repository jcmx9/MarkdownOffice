import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: vi.fn() },
  BrowserWindow: class {},
  dialog: {},
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}))

const { AppContext } = await import('../../../src/main/context')

async function context() {
  const userData = await realpath(await mkdtemp(join(tmpdir(), 'mdo-session-')))
  return new AppContext(userData, userData)
}

describe('AppContext session patch', () => {
  it('copies the toolbar visibility and keeps it on a later patch without it', async () => {
    const ctx = await context()
    expect(ctx.session.toolbar).toEqual({ edit: true })
    await ctx.updateSession({ toolbar: { edit: false } })
    expect(ctx.session.toolbar).toEqual({ edit: false })
    await ctx.updateSession({ view: 'code' })
    expect(ctx.session.toolbar).toEqual({ edit: false })
    await ctx.updateSession({ toolbar: { edit: true } })
    expect(ctx.session.toolbar).toEqual({ edit: true })
  })
})
