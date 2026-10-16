import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FullScreenOwner,
  type FullScreenWindow,
  REFUSED_MS,
  setWindowFullScreen,
} from '../../../src/main/fullscreen'

describe('FullScreenOwner', () => {
  it('enters and leaves a fullscreen the app requested; its own leave is not reported', () => {
    const o = new FullScreenOwner()
    expect(o.request(true, false)).toEqual({ set: true, was: false })
    expect(o.request(false, true)).toEqual({ set: false, was: false })
    expect(o.onLeave()).toBe(false)
  })

  it('counts a leave requested while the enter still animates (isFullScreen still false)', () => {
    const o = new FullScreenOwner()
    o.request(true, false)
    expect(o.request(false, false)).toEqual({ set: false, was: false })
    expect(o.onLeave()).toBe(false)
  })

  it('a late leave from an earlier exit never ends a Present entered since', () => {
    const o = new FullScreenOwner()
    o.request(true, false) // enter, animating
    o.request(false, false) // Esc during the animation
    // Re-enter while the window is fullscreen and only waiting for the app's own leave.
    expect(o.request(true, true)).toEqual({ set: true, was: false })
    expect(o.onLeave()).toBe(false) // the late leave of the earlier exit
    // The new Present still owns fullscreen and leaves it again.
    expect(o.request(false, true)).toEqual({ set: false, was: false })
    expect(o.onLeave()).toBe(false)
  })

  it('repeated toggles never end in a fullscreen the app no longer leaves', () => {
    const o = new FullScreenOwner()
    for (let i = 0; i < 5; i++) {
      expect(o.request(true, i > 0).set).toBe(true)
      expect(o.request(false, false).set).toBe(false)
    }
    for (let i = 0; i < 5; i++) expect(o.onLeave()).toBe(false)
    expect(o.request(true, false)).toEqual({ set: true, was: false })
  })

  it('ignores duplicate requests', () => {
    const o = new FullScreenOwner()
    o.request(true, false)
    expect(o.request(true, false).set).toBeNull()
    o.request(false, true)
    expect(o.request(false, true).set).toBeNull()
    expect(o.onLeave()).toBe(false)
    expect(o.onLeave()).toBe(true)
  })

  it('reports a genuine OS leave and forgets ownership', () => {
    const o = new FullScreenOwner()
    o.request(true, false)
    expect(o.onLeave()).toBe(true)
    // Present ends; its exit request must not touch the window again.
    expect(o.request(false, false).set).toBeNull()
  })

  it('reports an OS leave after earlier app leaves have settled', () => {
    const o = new FullScreenOwner()
    o.request(true, false)
    o.request(false, true)
    expect(o.onLeave()).toBe(false)
    o.request(true, false)
    expect(o.onLeave()).toBe(true)
  })

  it('never leaves a fullscreen the user started', () => {
    const o = new FullScreenOwner()
    expect(o.request(true, true)).toEqual({ set: null, was: true })
    expect(o.request(false, true)).toEqual({ set: null, was: true })
    expect(o.onLeave()).toBe(true) // the user leaving their own fullscreen is an OS leave
  })
})

/** A window whose fullscreen requests only take effect when `enter()`/`leave()` are called. */
function fakeWindow(): FullScreenWindow & { full: boolean; calls: boolean[] } {
  return {
    full: false,
    calls: [],
    isFullScreen() {
      return this.full
    },
    setFullScreen(on: boolean) {
      this.calls.push(on)
    },
  }
}

describe('setWindowFullScreen: refused enter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports a refusal when the window never enters, and resets the intent', async () => {
    const o = new FullScreenOwner()
    const win = fakeWindow()
    const refused = vi.fn()
    let settled = false
    const done = setWindowFullScreen(o, win, true, refused).then((was) => {
      settled = true
      return was
    })
    expect(win.calls).toEqual([true])
    await vi.advanceTimersByTimeAsync(REFUSED_MS - 1)
    expect(settled).toBe(false)
    expect(refused).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await done).toBe(false)
    expect(refused).toHaveBeenCalledTimes(1)
    // Not app-owned any more: leaving Present does not touch the window ...
    expect(o.request(false, false)).toEqual({ set: null, was: false })
    // ... and a later OS leave is reported again (no stale pending leaves).
    expect(o.onLeave()).toBe(true)
  })

  it('a refusal also drops leaves still pending for that enter', async () => {
    const o = new FullScreenOwner()
    const win = fakeWindow()
    const refused = vi.fn()
    const enter = setWindowFullScreen(o, win, true, refused)
    o.request(false, false) // a leave counted while the enter was in flight
    await vi.advanceTimersByTimeAsync(REFUSED_MS)
    await enter
    expect(o.onLeave()).toBe(true)
  })

  it('settles at once on enter-full-screen; no refusal', async () => {
    const o = new FullScreenOwner()
    const win = fakeWindow()
    const refused = vi.fn()
    const done = setWindowFullScreen(o, win, true, refused)
    await vi.advanceTimersByTimeAsync(500)
    win.full = true
    expect(o.onEnter()).toBe(false)
    expect(await done).toBe(false)
    await vi.advanceTimersByTimeAsync(REFUSED_MS * 2)
    expect(refused).not.toHaveBeenCalled()
    expect(o.request(false, true)).toEqual({ set: false, was: false })
  })

  it('no refusal when the window is fullscreen at the deadline without an event', async () => {
    const o = new FullScreenOwner()
    const win = fakeWindow()
    const refused = vi.fn()
    const done = setWindowFullScreen(o, win, true, refused)
    win.full = true
    await vi.advanceTimersByTimeAsync(REFUSED_MS)
    await done
    expect(refused).not.toHaveBeenCalled()
    expect(o.request(false, true).set).toBe(false)
  })

  it('a late enter after a refusal is adopted while Present still wants fullscreen', async () => {
    const o = new FullScreenOwner()
    const win = fakeWindow()
    const done = setWindowFullScreen(o, win, true, vi.fn())
    await vi.advanceTimersByTimeAsync(REFUSED_MS)
    await done
    win.full = true
    expect(o.onEnter()).toBe(false) // stay fullscreen, owned by the app again
    expect(o.request(false, true)).toEqual({ set: false, was: false })
    expect(o.onLeave()).toBe(false)
  })

  it('a late enter after Present already ended is left again at once', async () => {
    const o = new FullScreenOwner()
    const win = fakeWindow()
    const done = setWindowFullScreen(o, win, true, vi.fn())
    await vi.advanceTimersByTimeAsync(REFUSED_MS)
    await done
    expect(await setWindowFullScreen(o, win, false, vi.fn())).toBe(false)
    win.full = true
    expect(o.onEnter()).toBe(true) // the caller leaves fullscreen: Edit is never fullscreen
    expect(o.onLeave()).toBe(false) // that leave is the app's own
  })

  it("an enter long after a refusal is the user's own", async () => {
    const o = new FullScreenOwner()
    const win = fakeWindow()
    const done = setWindowFullScreen(o, win, true, vi.fn())
    await vi.advanceTimersByTimeAsync(REFUSED_MS)
    await done
    await setWindowFullScreen(o, win, false, vi.fn())
    await vi.advanceTimersByTimeAsync(60_000)
    win.full = true
    expect(o.onEnter()).toBe(false)
    expect(o.request(true, true)).toEqual({ set: null, was: true })
  })

  it("leaves and the user's own fullscreen settle immediately", async () => {
    const o = new FullScreenOwner()
    const win = fakeWindow()
    win.full = true
    expect(await setWindowFullScreen(o, win, true, vi.fn())).toBe(true)
    expect(await setWindowFullScreen(o, win, false, vi.fn())).toBe(true)
    expect(win.calls).toEqual([])
  })

  it('settles at once when the enter takes effect synchronously (Windows)', async () => {
    const o = new FullScreenOwner()
    const refused = vi.fn()
    // Electron on Windows emits 'enter-full-screen' inside setFullScreen(true).
    const win: FullScreenWindow = {
      full: false,
      isFullScreen() {
        return this.full
      },
      setFullScreen(on: boolean) {
        this.full = on
        if (on) o.onEnter()
      },
    } as FullScreenWindow & { full: boolean }
    let settled = false
    const done = setWindowFullScreen(o, win, true, refused).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    await done
    await vi.advanceTimersByTimeAsync(REFUSED_MS * 2)
    expect(refused).not.toHaveBeenCalled()
    expect(o.request(false, true)).toEqual({ set: false, was: false })
  })

  it('waits 4 s before calling an enter refused (slow WMs, Space switches)', () => {
    expect(REFUSED_MS).toBe(4000)
  })

  it('dispose cancels a pending refusal', async () => {
    const o = new FullScreenOwner()
    const refused = vi.fn()
    void setWindowFullScreen(o, fakeWindow(), true, refused)
    o.dispose()
    await vi.advanceTimersByTimeAsync(REFUSED_MS * 2)
    expect(refused).not.toHaveBeenCalled()
  })
})
