import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appFocus = vi.fn()

/** A BrowserWindow stand-in that records restore/focus calls. */
class FakeWindow extends EventEmitter {
  minimized = false
  readonly calls: string[] = []
  readonly webContents = Object.assign(new EventEmitter(), { send: () => undefined })
  isDestroyed(): boolean {
    return false
  }
  isMinimized(): boolean {
    return this.minimized
  }
  restore(): void {
    this.calls.push('restore')
    this.minimized = false
  }
  focus(): void {
    this.calls.push('focus')
  }
}

let windows: FakeWindow[] = []

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: vi.fn(), focus: (o: unknown) => appFocus(o) },
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

const realPlatform = process.platform
const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { value: p })

let ctx: InstanceType<typeof AppContext>

beforeEach(() => {
  windows = []
  appFocus.mockReset()
  ctx = new AppContext('/nicht/benutzt', '/nicht/benutzt')
  ctx.markInitialized()
  ctx.createWindow()
})
afterEach(() => setPlatform(realPlatform))

describe('AppContext.focus (second-instance hand-off)', () => {
  it('on macOS restores a minimized window and brings the app to the front', () => {
    setPlatform('darwin')
    const win = windows[0] as FakeWindow
    win.minimized = true
    ctx.focus()
    expect(win.calls).toEqual(['restore', 'focus'])
    expect(appFocus).toHaveBeenCalledWith({ steal: true })
  })

  it('elsewhere only focuses the window', () => {
    setPlatform('win32')
    const win = windows[0] as FakeWindow
    ctx.focus()
    expect(win.calls).toEqual(['focus'])
    expect(appFocus).not.toHaveBeenCalled()
  })
})
