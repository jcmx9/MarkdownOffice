import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PIPELINE_SCHEMA } from '../../../src/core/frontmatter-schema'
import type { ValidationContext } from '../../../src/core/frontmatter-validate'
import {
  inputsKey,
  SetCheck,
  type SetCheckHost,
  type SetStatus,
  setStatus,
  setTitle,
} from '../../../src/renderer/ui/set-status'

const ctx: ValidationContext = {
  schema: PIPELINE_SCHEMA,
  sets: ['memo', 'din5008a'],
  header: null,
  profile: null,
}
const note = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n\nText\n`

describe('setStatus', () => {
  it.each([
    ['no front matter', 'Text\n'],
    ['no template:', note('title: A')],
    ['an empty template:', note('template:')],
  ])('is null for %s', (_, text) => {
    expect(setStatus(text, ctx)).toBeNull()
  })

  it('names the set without errors', () => {
    expect(setStatus(note('template: memo'), ctx)).toEqual({
      name: 'memo',
      errors: 0,
      unknown: false,
    })
  })

  it('counts errors only, not warnings', () => {
    // toc: ja is an error, toc: Auto a warning (frontmatter-validate.test.ts).
    expect(setStatus(note('template: memo', 'toc: Auto'), ctx)?.errors).toBe(0)
    expect(setStatus(note('template: memo', 'toc: ja'), ctx)?.errors).toBe(1)
  })

  it('reports a set that is not installed', () => {
    expect(setStatus(note('template: din5008b'), ctx)).toEqual({
      name: 'din5008b',
      errors: 1,
      unknown: true,
    })
  })

  it('counts a missing profile as an error', () => {
    const missing = { ...ctx, profile: { status: 'missing' as const, searched: ['/x'] } }
    expect(setStatus(note('template: memo', 'profile: work'), missing)?.errors).toBe(1)
  })
})

describe('setTitle', () => {
  it.each<[SetStatus, string]>([
    [{ name: 'memo', errors: 0, unknown: false }, 'memo'],
    [{ name: 'memo', errors: 1, unknown: false }, 'memo – 1 Fehler im YAML-Kopf'],
    [{ name: 'memo', errors: 3, unknown: false }, 'memo – 3 Fehler im YAML-Kopf'],
    [{ name: 'x', errors: 1, unknown: true }, 'x – 1 Fehler im YAML-Kopf (Set nicht installiert)'],
  ])('%j', (s, title) => {
    expect(setTitle(s)).toBe(title)
  })
})

describe('inputsKey', () => {
  it('changes with path, template: and profile:, not with the body', () => {
    const a = note('template: memo', 'profile: work')
    expect(inputsKey('/a.md', a)).toBe(inputsKey('/a.md', `${a}more text`))
    expect(inputsKey('/a.md', a)).not.toBe(inputsKey('/b.md', a))
    expect(inputsKey('/a.md', a)).not.toBe(inputsKey(null, a))
    expect(inputsKey('/a.md', a)).not.toBe(inputsKey('/a.md', note('template: din5008a')))
    expect(inputsKey('/a.md', a)).not.toBe(
      inputsKey('/a.md', note('template: memo', 'profile: home')),
    )
  })
})

/** A host with one shown tab whose text the test edits; main answers when `answer()` runs. */
function fakeHost(text: string) {
  const state = { shown: 1, texts: new Map([[1, text]]) }
  const pending: Array<() => void> = []
  const host = {
    snapshot: vi.fn((id: number) => {
      const t = state.texts.get(id)
      if (t === undefined || id !== state.shown) return null
      return { text: t, key: inputsKey(`/n${id}.md`, t) }
    }),
    context: vi.fn(
      (_id: number) =>
        new Promise<{ ctx: ValidationContext; cache: boolean } | null>((resolve) =>
          pending.push(() => resolve({ ctx, cache: true })),
        ),
    ),
    paint: vi.fn(),
  } satisfies SetCheckHost
  const answer = async () => {
    for (const p of pending.splice(0)) p()
    await vi.runAllTimersAsync()
  }
  return { host, state, answer }
}

describe('SetCheck', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('paints nothing without asking main when no set is named', async () => {
    const { host } = fakeHost(note('title: A'))
    await new SetCheck(host).now(1)
    expect(host.context).not.toHaveBeenCalled()
    expect(host.paint).toHaveBeenCalledWith(1, null)
  })

  it('debounces typing and reuses the inputs while the key stays', async () => {
    const { host, state, answer } = fakeHost(note('template: memo'))
    const check = new SetCheck(host, 500)
    void check.now(1)
    await answer()
    expect(host.paint).toHaveBeenLastCalledWith(1, { name: 'memo', errors: 0, unknown: false })
    state.texts.set(1, note('template: memo', 'toc: j'))
    check.schedule(1)
    state.texts.set(1, note('template: memo', 'toc: ja'))
    check.schedule(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(host.paint).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(host.paint).toHaveBeenCalledTimes(2)
    expect(host.paint).toHaveBeenLastCalledWith(1, { name: 'memo', errors: 1, unknown: false })
    // One round trip for the whole run of typing: the key never changed.
    expect(host.context).toHaveBeenCalledOnce()
  })

  it('asks main again when template: changes, and when fresh', async () => {
    const { host, state, answer } = fakeHost(note('template: memo'))
    const check = new SetCheck(host)
    void check.now(1)
    await answer()
    state.texts.set(1, note('template: din5008a'))
    check.schedule(1)
    await vi.advanceTimersByTimeAsync(500)
    await answer()
    expect(host.context).toHaveBeenCalledTimes(2)
    void check.now(1, true)
    await answer()
    expect(host.context).toHaveBeenCalledTimes(3)
  })

  it('never paints a tab that is no longer shown', async () => {
    const { host, state, answer } = fakeHost(note('template: memo'))
    state.texts.set(2, note('title: B'))
    const check = new SetCheck(host)
    void check.now(1)
    state.shown = 2
    void check.now(2)
    await answer()
    expect(host.paint.mock.calls).toEqual([[2, null]])
  })

  it('drops an answer for an older text; the pending debounce paints instead', async () => {
    const { host, state, answer } = fakeHost(note('template: memo'))
    const check = new SetCheck(host)
    const first = check.now(1)
    state.texts.set(1, note('template: memo', 'toc: ja'))
    check.schedule(1)
    await answer()
    await first
    // The debounced run found the inputs cached by the dropped one and painted the new text.
    expect(host.paint.mock.calls).toEqual([[1, { name: 'memo', errors: 1, unknown: false }]])
    expect(host.context).toHaveBeenCalledOnce()
  })

  it('does not cache a fallback context and forgets closed tabs', async () => {
    const { host } = fakeHost(note('template: memo'))
    host.context.mockImplementation(async () => ({ ctx, cache: false }))
    const check = new SetCheck(host)
    await check.now(1)
    await check.now(1)
    expect(host.context).toHaveBeenCalledTimes(2)
    host.context.mockImplementation(async () => ({ ctx, cache: true }))
    await check.now(1)
    await check.now(1)
    expect(host.context).toHaveBeenCalledTimes(3)
    check.forget(1)
    await check.now(1)
    expect(host.context).toHaveBeenCalledTimes(4)
  })
})
