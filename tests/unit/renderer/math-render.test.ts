// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MathItem, MathResult } from '../../../src/core/math'
import { type TypstPlugin, TypstPluginError } from '../../../src/core/typst-plugin'
import {
  createMathService,
  MATH_FAILED,
  MATH_TOO_LONG,
  type MathEntry,
} from '../../../src/renderer/editor/math-render'

// A real Typst formula (tests/fixtures/math, see diagram-svg.test.ts): `x\frac{1}{2}` inline.
const FRAC = readFileSync(join(__dirname, '../../fixtures/math/frac.svg'), 'utf8')

/** A mitex stand-in: rejects `\ce` with mitex's own message format, accepts everything else. */
const mitex = (): TypstPlugin => ({
  call(_name, tex) {
    const text = new TextDecoder().decode(tex)
    if (text.includes('\\ce')) throw new TypstPluginError('error: unknown command: \\ce')
    return new TextEncoder().encode('converted')
  },
})

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

/** Runs the debounce and every promise it chains (mitex load, render). */
async function settle() {
  await vi.advanceTimersByTimeAsync(200)
}

describe('createMathService', () => {
  it('is pending for a formula it has not seen', () => {
    const service = createMathService({ loadMitex: async () => mitex(), render: vi.fn() })
    expect(service.get(I('x'))).toEqual({ state: 'pending' })
  })

  it('flags a formula mitex rejects with its message and never sends it to Typst', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ loadMitex: async () => mitex(), render })
    service.request([I('\\ce{H2O}'), I('x')])
    await settle()
    expect(service.get(I('\\ce{H2O}'))).toEqual({
      state: 'error',
      message: 'unknown command: \\ce',
    })
    expect(render).toHaveBeenCalledTimes(1)
    expect(calls[0]?.items).toEqual([I('x')])
  })

  it('does not call render when every formula failed the pre-check', async () => {
    const render = vi.fn()
    const service = createMathService({ loadMitex: async () => mitex(), render })
    const updated = vi.fn()
    service.onUpdate(updated)
    service.request([I('\\ce{A}')])
    await settle()
    expect(render).not.toHaveBeenCalled()
    expect(updated).toHaveBeenCalledTimes(1)
  })

  it('batches requests inside the debounce into one render, each formula once', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ loadMitex: async () => mitex(), render })
    service.request([I('x'), { tex: 'x', display: true }])
    await vi.advanceTimersByTimeAsync(50)
    service.request([I('x'), I('y')])
    await settle()
    expect(render).toHaveBeenCalledTimes(1)
    expect(calls[0]?.items).toEqual([I('x'), { tex: 'x', display: true }, I('y')])
  })

  it('stores results as sanitised SVG and tells listeners', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ loadMitex: async () => mitex(), render })
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
    const service = createMathService({ loadMitex: async () => mitex(), render })
    service.request([I('x')])
    await settle()
    calls[0]?.resolve([okResult()])
    await vi.advanceTimersByTimeAsync(0)
    service.request([I('x')])
    await settle()
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('never lets an older response overwrite what a newer batch stored', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ loadMitex: async () => mitex(), render })
    service.request([I('x'), I('a')])
    await settle()
    service.request([I('x')])
    await settle()
    expect(calls.map((c) => c.items)).toEqual([[I('x'), I('a')], [I('x')]])
    calls[1]?.resolve([okResult()])
    await vi.advanceTimersByTimeAsync(0)
    calls[0]?.resolve([{ ok: false, error: 'stale' }, okResult()])
    await vi.advanceTimersByTimeAsync(0)
    expect(state(service.get(I('x')))).toBe('ok')
    // Keys only the older batch asked for still take its result.
    expect(state(service.get(I('a')))).toBe('ok')
  })

  it('turns a rejected render into errors and warns once', async () => {
    const { render, calls } = deferredRender()
    const warn = vi.fn()
    const service = createMathService({ loadMitex: async () => mitex(), render, warn })
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

  it('renders without the pre-check when mitex cannot be loaded', async () => {
    const { render, calls } = deferredRender()
    const warn = vi.fn()
    const loadMitex = vi.fn(async () => {
      throw new Error('no wasm')
    })
    const service = createMathService({ loadMitex, render, warn })
    service.request([I('x')])
    await settle()
    service.request([I('y')])
    await settle()
    expect(calls.map((c) => c.items)).toEqual([[I('x')], [I('y')]])
    // No retry: the file is missing for the whole session.
    expect(loadMitex).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('reloads mitex after a crash (not an error result) and still renders the formula', async () => {
    const { render, calls } = deferredRender()
    let crashed = false
    const loadMitex = vi.fn(
      async (): Promise<TypstPlugin> => ({
        call() {
          if (!crashed) {
            crashed = true
            throw new WebAssembly.RuntimeError('unreachable')
          }
          return new Uint8Array()
        },
      }),
    )
    const service = createMathService({ loadMitex, render, warn: vi.fn() })
    service.request([I('x'), I('y')])
    await settle()
    expect(calls[0]?.items).toEqual([I('x'), I('y')])
    expect(loadMitex).toHaveBeenCalledTimes(2)
  })

  it('splits more formulas than one request may carry and refuses over-long ones locally', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ loadMitex: async () => mitex(), render })
    const many = Array.from({ length: 501 }, (_, i) => I(`x_{${i}}`))
    service.request([...many, I('x'.repeat(10_001))])
    await settle()
    expect(calls.map((c) => c.items.length)).toEqual([500, 1])
    expect(service.get(I('x'.repeat(10_001)))).toEqual({ state: 'error', message: MATH_TOO_LONG })
  })

  it('flags a result whose SVG the sanitiser rejects', async () => {
    const { render, calls } = deferredRender()
    const service = createMathService({ loadMitex: async () => mitex(), render, warn: vi.fn() })
    service.request([I('x')])
    await settle()
    calls[0]?.resolve([{ ok: true, svg: '<html/>', width: 1, height: 1, depth: 0 }])
    await vi.advanceTimersByTimeAsync(0)
    expect(state(service.get(I('x')))).toBe('error')
  })
})
