// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MathItem, MathResult } from '../../../src/core/math'
import {
  createMathService,
  MATH_FAILED,
  MATH_TOO_LONG,
  MATH_UNSHOWABLE,
  type MathEntry,
} from '../../../src/renderer/editor/math-render'

// A real Typst formula (tests/fixtures/math, see diagram-svg.test.ts): `x\frac{1}{2}` inline.
const FRAC = readFileSync(join(__dirname, '../../fixtures/math/frac.svg'), 'utf8')

const okResult = (): MathResult => ({ ok: true, svg: FRAC, width: 1.17, height: 1.2, depth: 0.35 })

/** A render stub whose calls resolve when the test says so. */
function deferredRender() {
  const calls: {
    items: MathItem[]
    resolve: (r: MathResult[]) => void
    reject: (e: unknown) => void
  }[] = []
  const render = vi.fn(
    (items: MathItem[]) =>
      new Promise<MathResult[]>((resolve, reject) => calls.push({ items, resolve, reject })),
  )
  return { render, calls }
}

const I = (tex: string): MathItem => ({ tex, display: false })
const state = (e: MathEntry) => e.state

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** Runs the debounce and every promise it chains (render). */
async function settle() {
  await vi.advanceTimersByTimeAsync(200)
}

describe('createMathService', () => {
  it('is pending for a formula it has not seen', () => {
    const service = createMathService({ render: vi.fn() })
    expect(service.get(I('x'))).toEqual({ state: 'pending' })
  })

  it('sends every formula to main, mitex errors too, and shows the message main gives', async () => {
    // No renderer pre-check: mitex's conversion is unbounded (macro bombs), main runs it bounded.
    const { render, calls } = deferredRender()
    const service = createMathService({ render })
    service.request([I('\\ce{H2O}'), I('x')])
    await settle()
    expect(render).toHaveBeenCalledTimes(1)
    expect(calls[0]?.items).toEqual([I('\\ce{H2O}'), I('x')])
    calls[0]?.resolve([{ ok: false, error: 'unknown command: \\ce' }, okResult()])
    await vi.advanceTimersByTimeAsync(0)
    expect(service.get(I('\\ce{H2O}'))).toEqual({
      state: 'error',
      message: 'unknown command: \\ce',
    })
    expect(state(service.get(I('x')))).toBe('ok')
  })

  it('never loads mitex in the renderer (default render over IPC)', async () => {
    const pluginWasm = vi.fn()
    const renderMath = vi.fn(async (items: MathItem[]) => items.map(okResult))
    vi.stubGlobal('window', Object.assign(window, { mdo: { pluginWasm, renderMath } }))
    try {
      const service = createMathService()
      service.request([I('\\ce{H2O}')])
      await settle()
      expect(renderMath).toHaveBeenCalledWith([I('\\ce{H2O}')])
      expect(pluginWasm).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('batches requests inside the debounce into one render, each formula once', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ render })
    service.request([I('x'), { tex: 'x', display: true }])
    await vi.advanceTimersByTimeAsync(50)
    service.request([I('x'), I('y')])
    await settle()
    expect(render).toHaveBeenCalledTimes(1)
    expect(calls[0]?.items).toEqual([I('x'), { tex: 'x', display: true }, I('y')])
  })

  it('stores results as sanitised SVG and tells listeners', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ render })
    const updated = vi.fn()
    const off = service.onUpdate(updated)
    service.request([I('x'), I('bad')])
    await settle()
    calls[0]?.resolve([okResult(), { ok: false, error: 'unknown variable: q' }])
    await vi.advanceTimersByTimeAsync(0)
    const entry = service.get(I('x'))
    expect(entry.state).toBe('ok')
    if (entry.state !== 'ok') return
    expect(entry.svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(
      entry.svg.querySelector('use')?.getAttribute('href')?.startsWith(`#${entry.prefix}-`),
    ).toBe(true)
    expect([entry.width, entry.height, entry.depth]).toEqual([1.17, 1.2, 0.35])
    expect(service.get(I('bad'))).toEqual({ state: 'error', message: 'unknown variable: q' })
    expect(updated).toHaveBeenCalledTimes(1)
    off()
    service.request([I('z')])
    await settle()
    calls[1]?.resolve([okResult()])
    await vi.advanceTimersByTimeAsync(0)
    expect(updated).toHaveBeenCalledTimes(1)
  })

  it('does not request a formula again once it has a result', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ render })
    service.request([I('x')])
    await settle()
    calls[0]?.resolve([okResult()])
    await vi.advanceTimersByTimeAsync(0)
    service.request([I('x')])
    await settle()
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('never sends a formula again while its render is in flight', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ render })
    service.request([I('x'), I('a')])
    await settle()
    service.request([I('x'), I('b')])
    await settle()
    expect(calls.map((c) => c.items)).toEqual([[I('x'), I('a')], [I('b')]])
    calls[0]?.resolve([okResult(), okResult()])
    await vi.advanceTimersByTimeAsync(0)
    expect(state(service.get(I('x')))).toBe('ok')
  })

  it('turns a rejected render into errors and warns once', async () => {
    const { render, calls } = deferredRender()
    const warn = vi.fn()
    const service = createMathService({ render, warn })
    service.request([I('x')])
    await settle()
    calls[0]?.reject(new Error('IPC gone'))
    await vi.advanceTimersByTimeAsync(0)
    service.request([I('y')])
    await settle()
    calls[1]?.reject(new Error('IPC gone'))
    await vi.advanceTimersByTimeAsync(0)
    expect(service.get(I('x'))).toEqual({ state: 'error', message: MATH_FAILED })
    expect(service.get(I('y'))).toEqual({ state: 'error', message: MATH_FAILED })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(MATH_FAILED)
    expect(MATH_FAILED).toBe('Formeln konnten nicht gesetzt werden')
  })

  it('splits more formulas than one request may carry and refuses over-long ones locally', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ render })
    const many = Array.from({ length: 501 }, (_, i) => I(`x_{${i}}`))
    service.request([...many, I('x'.repeat(10_001))])
    await settle()
    expect(calls.map((c) => c.items.length)).toEqual([500, 1])
    expect(service.get(I('x'.repeat(10_001)))).toEqual({ state: 'error', message: MATH_TOO_LONG })
  })

  it('flags a result whose SVG the sanitiser rejects', async () => {
    const { render, calls } = deferredRender()
    const warn = vi.fn()
    const service = createMathService({ render, warn })
    service.request([I('x')])
    await settle()
    calls[0]?.resolve([{ ok: true, svg: '<html/>', width: 1, height: 1, depth: 0 }])
    await vi.advanceTimersByTimeAsync(0)
    expect(service.get(I('x'))).toEqual({ state: 'error', message: MATH_UNSHOWABLE })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('createMathService (many formulas)', () => {
  /**
   * The editor glue in small: a build asks get() for every formula, request()s the pending ones,
   * and a service update schedules the next build in a microtask (as math.ts's view plugin).
   */
  async function runEditor(count: number) {
    const rendered: string[] = []
    const render = vi.fn(async (items: MathItem[]) => {
      for (const item of items) rendered.push(item.tex)
      return items.map(okResult)
    })
    const service = createMathService({ render })
    const items = Array.from({ length: count }, (_, i) => I(`x_{${i}}`))
    const seenOk = new Set<string>()
    let flipped = 0
    let builds = 0
    const build = () => {
      builds++
      const want: MathItem[] = []
      for (const item of items) {
        const e = service.get(item)
        if (e.state === 'pending') {
          if (seenOk.has(item.tex)) flipped++
          want.push(item)
        } else seenOk.add(item.tex)
      }
      if (want.length) service.request(want)
    }
    let queued = false
    service.onUpdate(() => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        build()
      })
    })
    build()
    for (let k = 0; k < 10; k++) await settle()
    return { service, items, rendered, render, flipped, builds }
  }

  it.each([1001, 2500])(
    'settles %i formulas, each rendered once, none evicted while shown',
    async (count) => {
      const run = await runEditor(count)
      expect(run.rendered).toHaveLength(count)
      expect(new Set(run.rendered).size).toBe(count)
      expect(run.render.mock.calls.length).toBe(Math.ceil(count / 500))
      expect(run.flipped).toBe(0)
      expect(run.items.every((item) => run.service.get(item).state === 'ok')).toBe(true)
      // Settled: no build keeps asking (one per batch result at most, plus the first).
      expect(run.builds).toBeLessThanOrEqual(Math.ceil(count / 500) + 1)
    },
  )

  it('still evicts formulas no longer in use once the cache is full', async () => {
    const run = await runEditor(1000)
    const other = I('y')
    run.service.request([other])
    // Two rounds without the old formulas: they are no longer in use.
    await Promise.resolve()
    run.service.get(other)
    await Promise.resolve()
    await settle()
    expect(run.service.get(other).state).toBe('ok')
    // The oldest of the 1000 went to make room.
    expect(run.service.get(I('x_{0}')).state).toBe('pending')
  })
})
