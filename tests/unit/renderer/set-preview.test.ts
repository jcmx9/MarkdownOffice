import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SetPreview, type SetPreviewHost } from '../../../src/renderer/ui/set-preview'
import type { PreviewInputs } from '../../../src/shared/types'

const inputs = (set: string): PreviewInputs => ({
  set,
  css: [],
  preview: null,
  profile: {},
  signature: null,
})

function setup() {
  const keys = new Map<number, string | null>([[1, 'k1']])
  const pending: Array<(v: PreviewInputs | null | undefined) => void> = []
  const applied: Array<[number, PreviewInputs | null]> = []
  const host: SetPreviewHost = {
    key: vi.fn((id: number) => keys.get(id) ?? null),
    fetch: vi.fn(() => new Promise<PreviewInputs | null | undefined>((res) => pending.push(res))),
    apply: (id, v) => void applied.push([id, v]),
  }
  return { keys, pending, applied, host, sp: new SetPreview(host, 500) }
}
const flush = () => Promise.resolve().then(() => Promise.resolve())

describe('SetPreview', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks main only when the key changes', async () => {
    const { sp, host, pending } = setup()
    for (let i = 0; i < 3; i++) {
      sp.schedule(1)
      vi.advanceTimersByTime(500)
      pending.shift()?.(inputs('memo'))
      await flush()
    }
    expect(host.fetch).toHaveBeenCalledTimes(1)
  })

  it('focus (fresh) asks again for an unchanged key', async () => {
    const { sp, host, pending } = setup()
    const a = sp.now(1)
    pending.shift()?.(null)
    await a
    const b = sp.now(1, true)
    pending.shift()?.(null)
    await b
    expect(host.fetch).toHaveBeenCalledTimes(2)
  })

  it('a stale answer after a tab switch is dropped', async () => {
    const { sp, keys, pending, applied } = setup()
    keys.set(2, 'k2')
    const a = sp.now(1)
    keys.set(1, null)
    const b = sp.now(2)
    pending[0]?.(inputs('a'))
    pending[1]?.(inputs('b'))
    await Promise.all([a, b])
    expect(applied).toEqual([[2, inputs('b')]])
  })

  it('a failed fetch applies nothing and is retried next time', async () => {
    const { sp, host, pending, applied } = setup()
    const a = sp.now(1)
    pending.shift()?.(undefined)
    await a
    const b = sp.now(1)
    pending.shift()?.(null)
    await b
    expect(host.fetch).toHaveBeenCalledTimes(2)
    expect(applied).toEqual([[1, null]])
  })

  it('forget drops the cache', async () => {
    const { sp, host, pending } = setup()
    const a = sp.now(1)
    pending.shift()?.(null)
    await a
    sp.forget(1)
    const b = sp.now(1)
    pending.shift()?.(null)
    await b
    expect(host.fetch).toHaveBeenCalledTimes(2)
  })
})
