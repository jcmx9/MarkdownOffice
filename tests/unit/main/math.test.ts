import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MathItem, MathResult } from '../../../src/core/math'
import { Ch } from '../../../src/shared/ipc'

type Handler = (e: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

// A gate in front of the mitex copy: lets a test dispose() while the temp dir is being prepared.
const gate = vi.hoisted(() => ({
  hold: null as Promise<void> | null,
  reached: (_dest: string) => {},
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    cp: async (...args: Parameters<typeof real.cp>) => {
      gate.reached(String(args[1]))
      if (gate.hold) await gate.hold
      return real.cp(...args)
    },
  }
})

/** Temp dirs a test made; removed after each test. */
const made: string[] = []
afterEach(async () => {
  gate.hold = null
  gate.reached = () => {}
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
const tempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

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
    expect(res[1]).toEqual({ ok: false, error: 'missing argument: den' })
    expect(ok(res[2]).svg).toMatch(/^<svg/)
  })

  it('sets a bare # call as math text (mitex escapes it)', async () => {
    // What this proves: mitex escapes a bare `#`, so `#read(…)` renders as a short formula. It
    // proves nothing about the sandbox: several mitex commands do pass text into Typst code; the
    // known ones are refused before compiling (tests below), and the boundary for the rest is
    // the sandbox (--root temp dir, empty package dirs, dead proxy, timeout).
    const r = new MathRenderer(ROOT)
    const [res] = await r.render([{ tex: '#read("/etc/passwd")', display: false }])
    expect(JSON.stringify(res)).not.toContain('root:')
    expect(ok(res).width).toBeLessThan(20)
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
  const root = await tempDir('mdo-math-test-')
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
      // The overall deadline equals the timeout: no time left to split the batch further.
      const r = new MathRenderer(await fakeRoot(), {
        timeoutMs: 50,
        deadlineMs: 50,
        spawnImpl: hang.impl,
      })
      const res = await r.render([
        { tex: 'x', display: false },
        { tex: 'y', display: false },
      ])
      const timeout = { ok: false, error: 'Zeitüberschreitung' }
      expect(res).toEqual([timeout, timeout])
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
      const child = hang.children[0] as ChildProcess
      await exited(child)
      expect(child.signalCode).toBe('SIGTERM')
    },
  )

  it('never spawns Typst after a dispose during the temp dir setup', async () => {
    const spawnImpl = vi.fn() as unknown as typeof spawn
    const r = new MathRenderer(await fakeRoot(), { spawnImpl })
    let release = () => {}
    gate.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const reached = new Promise<string>((resolve) => {
      gate.reached = resolve
    })
    const res = r.render([{ tex: 'x', display: false }])
    const tmp = dirname(await reached)
    r.dispose()
    release()
    expect(await res).toEqual([{ ok: false, error: 'abgebrochen' }])
    expect(spawnImpl).not.toHaveBeenCalled()
    expect(existsSync(tmp)).toBe(false)
  })

  // The known mitex passthroughs to Typst code (mitex 0.2.7). A lookalike such as `\hspacex`
  // needs no test: mitex rejects it as an unknown command anyway.
  it.each([
    '\\iftypst #{import "@preview/x:0.0.1": y} \\fi',
    '\\includegraphics[width=panic("PWNED")]{a}',
    '\\includegraphics{a"),panic("X"),image("b}',
    '\\hspace{\\text{panic("PWNED-hspace")}}',
    '\\vspace{\\text{panic("PWNED-vspace")}}',
    '\\raisebox{\\text{panic("PWNED-raise")}}{x}',
    '\\hspace{\\text{panic(read("/formulas.json"))}}',
  ])('refuses raw Typst code without compiling it: %s', async (tex) => {
    const spawnImpl = vi.fn() as unknown as typeof spawn
    const r = new MathRenderer(await fakeRoot(), { spawnImpl })
    expect(await r.render([{ tex, display: false }])).toEqual([
      { ok: false, error: 'Typst-Code in Formeln wird in der Vorschau nicht ausgeführt' },
    ])
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it('spawns with no TYPST_* settings, a dead proxy and package dirs in the temp dir', async () => {
    const seen: { args: string[]; opts: { cwd: string; env: NodeJS.ProcessEnv } }[] = []
    const spawnImpl = ((
      _cmd: string,
      args: string[],
      opts: { cwd: string; env: NodeJS.ProcessEnv },
    ) => {
      seen.push({ args, opts })
      return spawn(process.execPath, ['-e', ''], opts)
    }) as unknown as typeof spawn
    vi.stubEnv('TYPST_PACKAGE_PATH', '/somewhere/else')
    vi.stubEnv('https_proxy', 'http://corp-proxy:8080')
    try {
      const r = new MathRenderer(await fakeRoot(), { spawnImpl })
      await r.render([{ tex: 'x', display: true }])
    } finally {
      vi.unstubAllEnvs()
    }
    const call = seen[0]
    if (!call) throw new Error('no spawn')
    const env = call.opts.env
    expect(Object.keys(env).filter((k) => k.toUpperCase().startsWith('TYPST_'))).toEqual([])
    for (const k of [
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'ALL_PROXY',
      'all_proxy',
    ])
      expect(env[k]).toBe('http://127.0.0.1:9')
    expect(env.NO_PROXY).toBe('')
    expect(env.no_proxy).toBe('')
    expect(env.PATH).toBe(process.env.PATH)
    const flag = (name: string) => call.args[call.args.indexOf(name) + 1]
    expect(flag('--package-path')).toBe(join(call.opts.cwd, 'pkg'))
    expect(flag('--package-cache-path')).toBe(join(call.opts.cwd, 'pkg-cache'))
    expect(flag('--root')).toBe(call.opts.cwd)
  })

  it('finds one bad formula of 16 by halving (at most 9 compiles)', async () => {
    let calls = 0
    // A stand-in Typst: fails when the batch holds `bad`, else writes one tight page per page.
    const spawnImpl = ((_cmd: string, _args: string[], opts: { cwd: string }) => {
      calls++
      const items = JSON.parse(readFileSync(join(opts.cwd, 'formulas.json'), 'utf8')) as MathItem[]
      if (items.some((i) => i.tex === 'bad'))
        return spawn(
          process.execPath,
          ['-e', 'console.error("error: bad formula"); process.exit(1)'],
          opts,
        )
      const pages = items.reduce((n, i) => n + (i.display ? 1 : 2), 0)
      for (let p = 1; p <= pages; p++)
        writeFileSync(join(opts.cwd, `out-${p}.svg`), '<svg width="5pt" height="4pt"></svg>')
      return spawn(process.execPath, ['-e', ''], opts)
    }) as unknown as typeof spawn
    const r = new MathRenderer(await fakeRoot(), { spawnImpl })
    const items = Array.from({ length: 16 }, (_, i) => ({
      tex: i === 11 ? 'bad' : `x_${i}`,
      display: i % 3 === 0,
    }))
    const res = await r.render(items)
    expect(calls).toBeLessThanOrEqual(9)
    expect(res[11]).toEqual({ ok: false, error: 'bad formula' })
    res.forEach((item, i) => {
      if (i !== 11) expect(item.ok).toBe(true)
    })
  })
})

describe('IPC renderMath', () => {
  const setup = async () => {
    handlers.clear()
    const dir = await tempDir('mdo-math-ipc-')
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
    ['a formula over 10 000 characters', [{ tex: 'x'.repeat(10_001), display: false }]],
  ])('rejects a batch with %s', async (_name, items) => {
    const invoke = await setup()
    await expect(invoke(items)).rejects.toThrow('Ungültiger Parameter.')
  })

  it('answers a valid empty batch', async () => {
    const invoke = await setup()
    expect(await invoke([])).toEqual([])
  })
})

/**
 * A stand-in Typst: `decide` sees the batch and says whether it renders (one tight SVG per page),
 * fails with `error: bad formula`, or hangs.
 */
const fakeTypst = (decide: (items: MathItem[]) => 'ok' | 'fail' | 'hang') => {
  const batches: string[][] = []
  const impl = ((_cmd: string, _args: string[], opts: { cwd: string }) => {
    const items = JSON.parse(readFileSync(join(opts.cwd, 'formulas.json'), 'utf8')) as MathItem[]
    batches.push(items.map((i) => i.tex))
    const how = decide(items)
    const fail = 'console.error("error: bad formula"); process.exit(1)'
    if (how === 'fail') return spawn(process.execPath, ['-e', fail], opts)
    if (how === 'hang') return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], opts)
    const pages = items.reduce((n, i) => n + (i.display ? 1 : 2), 0)
    for (let p = 1; p <= pages; p++)
      writeFileSync(join(opts.cwd, `out-${p}.svg`), '<svg width="5pt" height="4pt"></svg>')
    return spawn(process.execPath, ['-e', ''], opts)
  }) as unknown as typeof spawn
  return { impl, batches }
}

describe.skipIf(process.platform === 'win32')('MathRenderer (deadline)', () => {
  const items = ['a', 'b', 'c', 'slow'].map((tex) => ({ tex, display: true }))

  it('splits a timed-out sub-batch further while the deadline allows', async () => {
    const typst = fakeTypst((batch) => (batch.some((i) => i.tex === 'slow') ? 'hang' : 'ok'))
    const r = new MathRenderer(await fakeRoot(), {
      timeoutMs: 200,
      deadlineMs: 10_000,
      spawnImpl: typst.impl,
    })
    const res = await r.render(items)
    expect(res.slice(0, 3).map((x) => x.ok)).toEqual([true, true, true])
    expect(res[3]).toEqual({ ok: false, error: 'Zeitüberschreitung' })
    expect(typst.batches).toEqual([
      ['a', 'b', 'c', 'slow'],
      ['a', 'b'],
      ['c', 'slow'],
      ['c'],
      ['slow'],
    ])
  })

  it('gives non-isolated items a timeout, not the batch error, once the deadline passed', async () => {
    // The batch fails with a real error, and the deadline passes while it runs (clock moved on
    // at spawn): no time to isolate the culprit, so none of the four gets `bad formula`.
    const realNow = Date.now.bind(Date)
    let offset = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
    try {
      const typst = fakeTypst(() => {
        offset = 60_000
        return 'fail'
      })
      const r = new MathRenderer(await fakeRoot(), {
        timeoutMs: 5000,
        deadlineMs: 10_000,
        spawnImpl: typst.impl,
      })
      const timeout = { ok: false, error: 'Zeitüberschreitung' }
      expect(await r.render(items)).toEqual([timeout, timeout, timeout, timeout])
      expect(typst.batches).toHaveLength(1)
    } finally {
      clock.mockRestore()
    }
  })
})
