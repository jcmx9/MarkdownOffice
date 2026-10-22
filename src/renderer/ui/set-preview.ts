import type { PreviewInputs } from '../../shared/types'

export interface SetPreviewHost {
  /** inputsKey of the tab while it is shown and a Markdown note; null otherwise. */
  key(tabId: number): string | null
  /** null = built-in (cached); undefined = main failed (nothing applied, not cached). */
  fetch(tabId: number): Promise<PreviewInputs | null | undefined>
  apply(tabId: number, inputs: PreviewInputs | null): void
}

/**
 * Fetches the preview inputs (set CSS, preview description, profile) per tab. Modelled on
 * SetCheck: typing is debounced, main is asked only when the tab's key (path, `template:`,
 * `profile:`) changed, and an answer is applied only if no newer run started and the tab still
 * shows the same key, so a slow answer never paints over another tab's or note's look.
 */
export class SetPreview {
  private timer: ReturnType<typeof setTimeout> | null = null
  private seq = 0
  private readonly cache = new Map<number, string>()

  constructor(
    private readonly host: SetPreviewHost,
    private readonly delay = 500,
  ) {}

  /** After an edit: runs once typing has paused for `delay` ms. */
  schedule(tabId: number): void {
    this.cancel()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run(tabId, false)
    }, this.delay)
  }

  /** At once (a note opened or shown). fresh: ask main again even for an unchanged key. */
  now(tabId: number, fresh = false): Promise<void> {
    this.cancel()
    return this.run(tabId, fresh)
  }

  /** A closed tab's cached key. */
  forget(tabId: number): void {
    this.cache.delete(tabId)
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private async run(tabId: number, fresh: boolean): Promise<void> {
    const seq = ++this.seq
    const key = this.host.key(tabId)
    if (key === null) return
    // The tab state already holds the inputs for this key.
    if (!fresh && this.cache.get(tabId) === key) return
    const inputs = await this.host.fetch(tabId)
    if (seq !== this.seq || this.host.key(tabId) !== key) return
    // A failed fetch applies nothing and is not cached, so the next run asks again.
    if (inputs === undefined) {
      this.cache.delete(tabId)
      return
    }
    this.cache.set(tabId, key)
    this.host.apply(tabId, inputs)
  }
}
