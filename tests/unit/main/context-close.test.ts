import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const quit = vi.fn()

/** A BrowserWindow stand-in: close() emits a preventable 'close', then 'closed'. */
class FakeWindow extends EventEmitter {
  destroyed = false
  readonly sent: string[] = []
  readonly webContents = Object.assign(new EventEmitter(), {
    send: (ch: string) => this.sent.push(ch),
  })
  close(): void {
    let prevented = false
    this.emit('close', { preventDefault: () => (prevented = true) })
    if (prevented) return
    this.destroyed = true
    this.emit('closed')
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

let windows: FakeWindow[] = []

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: () => quit() },
  BrowserWindow: class {},
  dialog: {},
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}))
vi.mock('../../../src/main/window', () => ({
  createMainWindow: () => {
    const w = new FakeWindow()
    windows.push(w)
    return w
  },
}))

const { AppContext } = await import('../../../src/main/context')
const { Ch } = await import('../../../src/shared/ipc')

let ctx: InstanceType<typeof AppContext>

beforeEach(() => {
  windows = []
  quit.mockReset()
  ctx = new AppContext('/nicht/benutzt', '/nicht/benutzt')
  ctx.createWindow()
  ctx.startup() // the renderer is running and answers close requests
})

describe('AppContext close handshake', () => {
  it('a close request asks the renderer, and its answer closes the window', () => {
    const win = windows[0] as FakeWindow
    win.close()
    expect(win.sent).toEqual([Ch.beforeClose])
    expect(win.destroyed).toBe(false)
    ctx.closeReady(true)
    expect(win.destroyed).toBe(true)
  })

  it('ignores an answer without a pending close request', () => {
    const win = windows[0] as FakeWindow
    ctx.closeReady(true)
    expect(win.destroyed).toBe(false)
    // The stale answer did not pre-approve the next close either: it asks the renderer.
    win.close()
    expect(win.sent).toEqual([Ch.beforeClose])
    expect(win.destroyed).toBe(false)
  })

  it('a stale answer never closes a window created after the close', () => {
    const first = windows[0] as FakeWindow
    first.close()
    ctx.closeReady(true)
    expect(first.destroyed).toBe(true)
    ctx.createWindow() // macOS 'activate'
    ctx.startup()
    const second = windows[1] as FakeWindow
    ctx.closeReady(true) // the second answer to the same close
    expect(second.destroyed).toBe(false)
  })

  it('a cancelled close needs a new request; quitting is reset only by a real answer', () => {
    const win = windows[0] as FakeWindow
    ctx.markQuitting()
    win.close()
    ctx.closeReady(false)
    ctx.closeReady(true) // late, unrelated
    expect(win.destroyed).toBe(false)
    expect(quit).not.toHaveBeenCalled()
  })
})
