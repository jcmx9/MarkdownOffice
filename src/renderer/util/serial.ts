/** Runs async ops strictly one after another; a failing op never blocks the ones after it. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0

  /** An op is queued or running. */
  get busy(): boolean {
    return this.pending > 0
  }

  /** Queues op; the returned promise settles like op itself. */
  run(op: () => Promise<void>): Promise<void> {
    this.pending++
    const result = this.tail.then(op)
    const done = (): void => {
      this.pending--
    }
    this.tail = result.then(done, done)
    return result
  }
}

/**
 * Coalesces toggles of an on/off state whose switch takes a while to settle (a fullscreen
 * request still animating). A toggle while a switch is in flight is not dropped: the latest
 * wanted state is remembered and applied once the switch settles, compared with the state at
 * that moment, so an even number of extra toggles is a no-op (last intent wins).
 */
export class LatestToggle {
  private running = false
  /** Wanted state from toggles during the running switch; null = none. */
  private wanted: boolean | null = null

  constructor(
    private readonly state: () => boolean,
    private readonly apply: (on: boolean) => Promise<void>,
  ) {}

  /** The state a toggle during the running switch still wants; null when none is pending. */
  get pendingWant(): boolean | null {
    return this.running ? this.wanted : null
  }

  /** Settles when this toggle (and any toggles coalesced into it) has been applied. */
  toggle(): Promise<void> {
    return this.set(!(this.running ? (this.wanted ?? this.state()) : this.state()))
  }

  /**
   * Asks for one state, not a flip: during a running switch it becomes the wanted state, so
   * repeated calls never undo each other. Idle and already in that state, it does nothing.
   */
  async set(on: boolean): Promise<void> {
    if (this.running) {
      this.wanted = on
      return
    }
    if (on === this.state()) return
    this.running = true
    try {
      let next: boolean | null = on
      while (next !== null) {
        await this.apply(next)
        const wanted: boolean | null = this.wanted
        this.wanted = null
        next = wanted === null || wanted === this.state() ? null : wanted
      }
    } finally {
      this.running = false
      this.wanted = null
    }
  }
}
