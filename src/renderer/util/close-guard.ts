/** Safety cap only: with input frozen a second round normally finds nothing left to save. */
export const MAX_CLOSE_ROUNDS = 10

export interface CloseSteps {
  /** Stops every input into the documents (keyboard, snippets, dialogs). */
  freeze(): void
  unfreeze(): void
  /** Runs the pending autosave now (serialized with a running one). */
  flush(): Promise<boolean>
  saveAll(): Promise<boolean>
  /** Names of tabs whose content is not on disk. */
  pending(): string[]
  persist(): Promise<void>
  confirmDiscard(names: string[]): Promise<boolean>
}

/**
 * Answers a window close: freeze input, save until nothing is pending or a save fails, and
 * only then close. Anything left unsaved goes to the discard prompt; a cancel thaws the input.
 */
export async function closeWindow(steps: CloseSteps): Promise<boolean> {
  try {
    // Inside the try: a freeze that throws partway thaws again (unfreeze is idempotent).
    steps.freeze()
    let saved = await steps.flush()
    for (let i = 0; saved && i < MAX_CLOSE_ROUNDS && steps.pending().length > 0; i++) {
      saved = await steps.saveAll()
    }
    try {
      await steps.persist()
    } catch (e) {
      // Closing must not depend on the session write.
      console.error('persistSession failed', e)
    }
    const names = steps.pending()
    if (names.length === 0) return true
    if (await steps.confirmDiscard(names)) return true
  } catch (e) {
    steps.unfreeze()
    throw e
  }
  steps.unfreeze()
  return false
}
