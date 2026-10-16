import { describe, expect, it, vi } from 'vitest'
import {
  type CloseSteps,
  closeWindow,
  MAX_CLOSE_ROUNDS,
} from '../../../src/renderer/util/close-guard'

/** One tab; typing keeps arriving between save rounds until the input is frozen. */
function fakeTab(opts: { failSave?: boolean; answer?: boolean; typingRounds?: number } = {}) {
  const t = {
    frozen: false,
    dirty: true,
    typed: 0,
    saved: 0,
    log: [] as string[],
  }
  let typingLeft = opts.typingRounds ?? Number.POSITIVE_INFINITY
  const save = async (): Promise<boolean> => {
    t.log.push(t.frozen ? 'save(frozen)' : 'save')
    if (opts.failSave) return false
    t.saved = t.typed
    t.dirty = false
    // A keystroke arrives while the save is in flight, unless input is frozen.
    if (!t.frozen && typingLeft-- > 0) {
      t.typed++
      t.dirty = true
    }
    return true
  }
  const steps: CloseSteps = {
    freeze: vi.fn(() => {
      t.frozen = true
      t.log.push('freeze')
    }),
    unfreeze: vi.fn(() => {
      t.frozen = false
      t.log.push('unfreeze')
    }),
    flush: save,
    saveAll: save,
    pending: () => (t.dirty ? ['a.md'] : []),
    persist: vi.fn(async () => {}),
    confirmDiscard: vi.fn(async () => opts.answer ?? false),
  }
  return { t, steps }
}

describe('closeWindow', () => {
  it('freezes input before the first save and closes once everything typed is saved', async () => {
    const { t, steps } = fakeTab()
    expect(await closeWindow(steps)).toBe(true)
    expect(t.log[0]).toBe('freeze')
    expect(t.dirty).toBe(false)
    expect(t.saved).toBe(t.typed)
    expect(steps.confirmDiscard).not.toHaveBeenCalled()
    expect(steps.unfreeze).not.toHaveBeenCalled()
    expect(steps.persist).toHaveBeenCalled()
  })

  it('a failing save asks to discard; cancel makes the editor editable again', async () => {
    const { t, steps } = fakeTab({ failSave: true, answer: false })
    expect(await closeWindow(steps)).toBe(false)
    expect(steps.confirmDiscard).toHaveBeenCalledWith(['a.md'])
    expect(t.frozen).toBe(false)
  })

  it('a failing save closes only after the user confirmed the discard', async () => {
    const { t, steps } = fakeTab({ failSave: true, answer: true })
    expect(await closeWindow(steps)).toBe(true)
    expect(steps.confirmDiscard).toHaveBeenCalledWith(['a.md'])
    expect(t.frozen).toBe(true)
  })

  it('a tab that stays unsaved after the safety cap goes to the prompt, never to true', async () => {
    const { steps } = fakeTab()
    let rounds = 0
    steps.saveAll = async () => {
      rounds++
      return true // claims success but the tab stays dirty (e.g. a held tab skipped)
    }
    steps.flush = steps.saveAll
    expect(await closeWindow(steps)).toBe(false)
    expect(rounds).toBe(MAX_CLOSE_ROUNDS + 1)
    expect(steps.confirmDiscard).toHaveBeenCalledWith(['a.md'])
  })

  it('a failing session write does not block the close', async () => {
    const { steps } = fakeTab()
    steps.persist = vi.fn(async () => {
      throw new Error('disk full')
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await closeWindow(steps)).toBe(true)
    err.mockRestore()
  })

  it('an exception while saving unfreezes and is reported as not closed', async () => {
    const { t, steps } = fakeTab()
    steps.flush = async () => {
      throw new Error('boom')
    }
    await expect(closeWindow(steps)).rejects.toThrow('boom')
    expect(t.frozen).toBe(false)
  })

  it('a freeze that throws partway thaws the tabs it already froze', async () => {
    const { t, steps } = fakeTab()
    steps.freeze = vi.fn(() => {
      t.frozen = true // the first tabs are frozen ...
      throw new Error('plugin failed') // ... then a reconfigure throws
    })
    await expect(closeWindow(steps)).rejects.toThrow('plugin failed')
    expect(steps.unfreeze).toHaveBeenCalled()
    expect(t.frozen).toBe(false)
  })
})
