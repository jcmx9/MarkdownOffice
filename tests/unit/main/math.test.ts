import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { MathItem, MathResult } from '../../../src/core/math'
import { Ch } from '../../../src/shared/ipc'

type Handler = (e: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), on: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}))

const { MathRenderer } = await import('../../../src/main/math')
const { AppContext } = await import('../../../src/main/context')
const { registerIpc } = await import('../../../src/main/ipc')

// The real Typst + mitex the PDF export runs (npm run assets); no stand-in for the happy path.
const ROOT = join(__dirname, '../../../build/pipeline-dev/pipeline')
const TYPST = join(ROOT, 'bin', process.platform === 'win32' ? 'typst.exe' : 'typst')
const skip = existsSync(TYPST) ? false : `${TYPST} missing – run npm run assets`

const ok = (r: MathResult | undefined) => {
  if (!r?.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`)
  return r
}

/** Wraps the real spawn and records every call's args and cwd. */
const recordingSpawn = () => {
  const calls: { args: string[]; cwd: string }[] = []
  let active = 0
  let maxActive = 0
  const impl = ((cmd: string, args: string[], opts: { cwd: string }) => {
    calls.push({ args, cwd: opts.cwd })
    active++
    maxActive = Math.max(maxActive, active)
    const child = spawn(cmd, args, opts)
    child.on('close', () => active--)
    return child
  }) as unknown as typeof spawn
  return { impl, calls, maxActive: () => maxActive }
}

describe.skipIf(skip)('MathRenderer (real Typst)', () => {
  it('renders a batch: inline metrics with depth, display depth 0', async () => {
    const r = new MathRenderer(ROOT)
    const [x, y, sum] = await r.render([
      { tex: 'x', display: false },
      { tex: 'y', display: false },
      { tex: '\\sum_{k=1}^n k', display: true },
    ])
    for (const res of [x, y, sum]) {
      const v = ok(res)
      expect(v.svg.trimStart()).toMatch(/^<svg/)
      expect(v.width).toBeGreaterThan(0)
      expect(v.height).toBeGreaterThan(0)
    }
    expect(ok(x).depth).toBeGreaterThanOrEqual(0)
    expect(ok(y).depth).toBeGreaterThan(ok(x).depth)
    expect(ok(sum).depth).toBe(0)
    // em of MATH_REF_PT: `y` is about half an em tall (6.47 pt at 10 pt).
    expect(ok(y).height).toBeCloseTo(0.647, 2)
  })

  it('isolates a formula Typst rejects while its neighbours render', async () => {
    const r = new MathRenderer(ROOT)
    // mitex converts \frac{1} to `frac(1)`; Typst's eval rejects it (missing argument: den).
    const res = await r.render([
      { tex: 'a', display: false },
      { tex: '\\frac{1}', display: true },
      { tex: 'b^2', display: false },
    ])
    expect(ok(res[0]).svg).toMatch(/^<svg/)
    expect(res[1]).toEqual({ ok: false, error: 'error: missing argument: den' })
    expect(ok(res[2]).svg).toMatch(/^<svg/)
  })

  it('never reads files: #read is formula text, not code', async () => {
    const r = new MathRenderer(ROOT)
    const [res] = await r.render([{ tex: '#read("/etc/passwd")', display: false }])
    expect(res).toBeDefined()
    expect(JSON.stringify(res)).not.toContain('root:')
    // A rendered file would be many lines wide; the literal source is one short formula.
    if (res?.ok) expect(res.width).toBeLessThan(20)
  })

  it('runs Typst with --root on a temp dir that is gone afterwards', async () => {
    const rec = recordingSpawn()
    const r = new MathRenderer(ROOT, { spawnImpl: rec.impl })
    const [res] = await r.render([{ tex: 'x', display: false }])
    ok(res)
    const call = rec.calls[0]
    expect(call).toBeDefined()
    const rootArg = call?.args[call.args.indexOf('--root') + 1]
    expect(rootArg).toBe(call?.cwd)
    expect(rootArg).toContain('mdo-math-')
    expect(existsSync(rootArg ?? '')).toBe(false)
  })

  it('serialises runs: a second call waits for the first', async () => {
    const rec = recordingSpawn()
    const r = new MathRenderer(ROOT, { spawnImpl: rec.impl })
    const [a, b] = await Promise.all([
      r.render([{ tex: 'x', display: false }]),
      r.render([{ tex: 'y', display: true }]),
    ])
    ok(a[0])
    ok(b[0])
    expect(rec.calls).toHaveLength(2)
    expect(rec.maxActive()).toBe(1)
  })
})

/** A root with a (fake) typst binary and mitex folder, for stubbed spawns. */
const fakeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'mdo-math-test-'))
  await mkdir(join(root, 'bin'))
  await writeFile(join(root, 'bin', process.platform === 'win32' ? 'typst.exe' : 'typst'), '')
  await mkdir(join(root, 'vendor', 'mitex'), { recursive: true })
  await writeFile(join(root, 'vendor', 'mitex', 'lib.typ'), '')
  return root
}

/** A spawn stand-in that starts a process which never finishes. */
const hangingSpawn = () => {
  const children: ChildProcess[] = []
  const impl = ((_cmd: string, _args: string[], opts: object) => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], opts)
    children.push(child)
    return child
  }) as unknown as typeof spawn
  return { impl, children }
}

const exited = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve()
    else child.on('exit', () => resolve())
  })

describe('MathRenderer (process handling)', () => {
  it('resolves an empty batch without spawning', async () => {
    const spawnImpl = vi.fn() as unknown as typeof spawn
    const r = new MathRenderer(await fakeRoot(), { spawnImpl })
    expect(await r.render([])).toEqual([])
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it('reports a missing Typst for every item', async () => {
    const r = new MathRenderer(join(tmpdir(), 'mdo-math-no-such-root'))
    const items: MathItem[] = [
      { tex: 'x', display: false },
      { tex: 'y', display: true },
    ]
    expect(await r.render(items)).toEqual([
      { ok: false, error: 'Typst nicht gefunden' },
      { ok: false, error: 'Typst nicht gefunden' },
    ])
  })

  it.skipIf(process.platform === 'win32')(
    'times out: every item fails and the child is killed',
    async () => {
      const hang = hangingSpawn()
      const r = new MathRenderer(await fakeRoot(), { timeoutMs: 50, spawnImpl: hang.impl })
      const res = await r.render([
        { tex: 'x', display: false },
        { tex: 'y', display: false },
      ])
      expect(res).toHaveLength(2)
      for (const item of res) expect(item.ok).toBe(false)
      // A timeout does not retry each formula singly: one process only.
      expect(hang.children).toHaveLength(1)
      const child = hang.children[0] as ChildProcess
      await exited(child)
      expect(child.signalCode).toBe('SIGTERM')
    },
  )

  it.skipIf(process.platform === 'win32')(
    'dispose kills the running render and clears the queue',
    async () => {
      const hang = hangingSpawn()
      const r = new MathRenderer(await fakeRoot(), { timeoutMs: 30_000, spawnImpl: hang.impl })
      const first = r.render([{ tex: 'x', display: false }])
      const second = r.render([{ tex: 'y', display: true }])
      await vi.waitFor(() => expect(hang.children).toHaveLength(1))
      r.dispose()
      const aborted = { ok: false, error: 'abgebrochen' }
      expect(await first).toEqual([aborted])
      expect(await second).toEqual([aborted])
      expect(hang.children).toHaveLength(1)
      await exited(hang.children[0] as ChildProcess)
    },
  )
})

describe('IPC renderMath', () => {
  const setup = async () => {
    handlers.clear()
    const dir = await mkdtemp(join(tmpdir(), 'mdo-math-ipc-'))
    registerIpc(new AppContext(dir, dir))
    const h = handlers.get(Ch.renderMath)
    if (!h) throw new Error('no renderMath handler')
    return (items: unknown) => h({ sender: {} }, items)
  }

  it.each([
    ['not an array', 'x'],
    ['an extra key', [{ tex: 'x', display: false, font: 'Arial' }]],
    ['a wrong type', [{ tex: 1, display: false }]],
    ['too many items', Array.from({ length: 501 }, () => ({ tex: 'x', display: false }))],
  ])('rejects a batch with %s', async (_name, items) => {
    const invoke = await setup()
    await expect(invoke(items)).rejects.toThrow('Ungültiger Parameter.')
  })

  it('answers a valid empty batch', async () => {
    const invoke = await setup()
    expect(await invoke([])).toEqual([])
  })
})
