/** What main does with the window for one renderer fullscreen request. */
export interface FullScreenAction {
  /** Call win.setFullScreen(set), or leave the window alone (null). */
  set: boolean | null
  /** The user (not the app) had the window fullscreen before the request. */
  was: boolean
}

/** An app-requested enter that has neither fired 'enter-full-screen' nor shows up in
 * isFullScreen() by then counts as refused by the OS. Generous, so a slow Linux WM or a macOS
 * Space switch under load does not get a false „Vollbild nicht verfügbar“. */
export const REFUSED_MS = 4000
/** How long after a refusal a late 'enter-full-screen' is still taken as the app's own. */
export const LATE_ENTER_MS = 10_000

/** The part of a BrowserWindow the fullscreen logic needs (fakes in tests). */
export interface FullScreenWindow {
  isFullScreen(): boolean
  setFullScreen(on: boolean): void
}

/**
 * Tracks whether the app itself put the window into fullscreen, by intent rather than by
 * win.isFullScreen(), which lags behind while macOS animates or a Linux WM answers.
 *
 * - The app only leaves a fullscreen it requested: a user's own fullscreen survives Present.
 * - Every app-requested leave is counted, also one requested while the enter still animates,
 *   so its late 'leave-full-screen' is never reported as an OS leave that would end a Present
 *   mode entered since.
 * - A leave the app did not request (green button, OS shortcut) is reported.
 * - An enter the OS refuses (no 'enter-full-screen' within REFUSED_MS) resets the intent, so
 *   Present runs windowed and later requests and leaves are judged afresh. An enter that only
 *   arrives late is adopted while Present still wants it, or left at once otherwise.
 */
export class FullScreenOwner {
  /** The app requested fullscreen and has not asked to leave since. */
  private owned = false
  /** App-requested leaves whose 'leave-full-screen' is still to come. */
  private pendingLeaves = 0
  /** The latest renderer request (true = Present wants fullscreen). */
  private wanted = false
  /** A refusal was reported recently: a late 'enter-full-screen' is the app's own. */
  private refusedRecently = false
  private enterTimer: ReturnType<typeof setTimeout> | null = null
  private lateTimer: ReturnType<typeof setTimeout> | null = null
  private settleEnter: (() => void) | null = null

  /** Records a renderer request; isFullScreen is the window's current (possibly stale) state. */
  request(on: boolean, isFullScreen: boolean): FullScreenAction {
    this.wanted = on
    if (on) {
      if (this.owned) return { set: null, was: false }
      // A fullscreen that is only waiting for the app's own leave is not the user's.
      if (isFullScreen && this.pendingLeaves === 0) return { set: null, was: true }
      this.owned = true
      this.clearLate()
      return { set: true, was: false }
    }
    if (!this.owned) return { set: null, was: isFullScreen && this.pendingLeaves === 0 }
    this.owned = false
    this.pendingLeaves++
    return { set: false, was: false }
  }

  /**
   * Resolves when the app's enter took effect or was refused: by 'enter-full-screen' (onEnter),
   * or after REFUSED_MS, when a window that is still not fullscreen counts as refused: the
   * intent is reset (not app-owned, no pending leaves) and onRefused is called.
   */
  awaitEnter(isFullScreen: () => boolean, onRefused: () => void): Promise<void> {
    this.settle()
    return new Promise<void>((resolve) => {
      this.settleEnter = resolve
      this.enterTimer = setTimeout(() => {
        this.enterTimer = null
        if (!isFullScreen()) {
          this.owned = false
          this.pendingLeaves = 0
          this.refusedRecently = true
          this.lateTimer = setTimeout(() => this.clearLate(), LATE_ENTER_MS)
          onRefused()
        }
        this.settle()
      }, REFUSED_MS)
    })
  }

  /**
   * Call on 'enter-full-screen'; true when the window must leave fullscreen again at once
   * (a refused enter arrived late after Present had already ended).
   */
  onEnter(): boolean {
    this.settle()
    if (!this.refusedRecently) return false
    this.clearLate()
    if (this.wanted) {
      this.owned = true
      return false
    }
    this.pendingLeaves++
    return true
  }

  /** Cancels timers and settles a pending enter (window closed). */
  dispose(): void {
    this.settle()
    this.clearLate()
  }

  private settle(): void {
    if (this.enterTimer !== null) clearTimeout(this.enterTimer)
    this.enterTimer = null
    const resolve = this.settleEnter
    this.settleEnter = null
    resolve?.()
  }

  private clearLate(): void {
    if (this.lateTimer !== null) clearTimeout(this.lateTimer)
    this.lateTimer = null
    this.refusedRecently = false
  }

  /** Call on 'leave-full-screen'; true when the OS (not the app) left fullscreen. */
  onLeave(): boolean {
    if (this.pendingLeaves > 0) {
      this.pendingLeaves--
      return false
    }
    this.owned = false
    return true
  }
}

/**
 * Applies one renderer request to the window. An app-requested enter resolves once it took
 * effect or was refused (see FullScreenOwner.awaitEnter), so the renderer's request stays in
 * flight during the enter animation. Resolves to whether the user (not the app) had the
 * window fullscreen before the request.
 */
export async function setWindowFullScreen(
  owner: FullScreenOwner,
  win: FullScreenWindow,
  on: boolean,
  onRefused: () => void,
): Promise<boolean> {
  const action = owner.request(on, win.isFullScreen())
  if (action.set === null) return action.was
  if (!action.set) {
    win.setFullScreen(false)
    return action.was
  }
  // Wait before the call: on Windows 'enter-full-screen' fires synchronously inside
  // setFullScreen(true) and must settle this enter, not leave it in flight until REFUSED_MS.
  const entered = owner.awaitEnter(() => win.isFullScreen(), onRefused)
  win.setFullScreen(true)
  await entered
  return action.was
}
