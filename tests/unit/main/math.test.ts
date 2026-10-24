import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

const { MathRenderer, firstError } = await import('../../../src/main/math')
const { MATH_PROGRAM, MATH_REFUSED } = await import('../../../src/core/math')

const TYPST_CODE = 'Typst-Code in Formeln wird in der Vorschau nicht ausgeführt'
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

  it.each([
    ['in the middle', ['x', '\\ce{H2O}', 'y'], 1],
    ['first', ['\\ce{H2O}', 'x', 'y'], 0],
  ])(
    'reports a mitex error %s with its message alone, neighbours render',
    async (_n, texs, bad) => {
      // mitex runs only here now (no renderer pre-check): Typst says `plugin errored with: error:
      // unknown command: \ce` with an excerpt in mitex/, a formula error that halving isolates.
      const r = new MathRenderer(ROOT)
      const res = await r.render(texs.map((tex) => ({ tex, display: false })))
      res.forEach((x, i) => {
        if (i === bad) expect(x).toEqual({ ok: false, error: 'unknown command: \\ce' })
        else expect(ok(x).svg).toMatch(/^<svg/)
      })
    },
  )

  it('bounds a macro-expansion bomb (memory watchdog or timeout) and stays responsive', async () => {
    // 4^9 copies of `xx` from ~350 characters: unbounded, ~1.2 GB and 2+ s in Typst + mitex.
    // Lower limits keep the test quick; without `ps` the timeout ends the run instead.
    const names = 'abcdefghij'.split('')
    const bomb =
      '\\newcommand{\\a}{xx}' +
      names
        .slice(1)
        .map((n, i) => `\\newcommand{\\${n}}{${`\\${names[i]}`.repeat(4)}}`)
        .join('') +
      '\\j'
    const r = new MathRenderer(ROOT, {
      maxRssBytes: 256 * 1024 ** 2,
      timeoutMs: 1500,
      deadlineMs: 5000,
    })
    const start = Date.now()
    const [res, after] = await r.render([
      { tex: bomb, display: true },
      { tex: 'x', display: false },
    ])
    expect(res?.ok).toBe(false)
    expect(['Formel braucht zu viel Speicher', 'Zeitüberschreitung']).toContain(
      res?.ok === false ? res.error : '',
    )
    expect(ok(after).svg).toMatch(/^<svg/)
    expect(Date.now() - start).toBeLessThan(15_000)
  }, 30_000)

  it('sets an escaped \\# as math text; a bare # is refused before compiling', async () => {
    // What this proves: the escape renders and a bare `#` never reaches Typst. It proves nothing
    // about the sandbox: several mitex commands do pass text into Typst code; the known ones are
    // refused (tests below), and the boundary for the rest is the sandbox (--root temp dir,
    // empty package dirs, dead proxy, timeout, memory watchdog).
    const r = new MathRenderer(ROOT)
    const [escaped, bare] = await r.render([
      { tex: '\\#read("/etc/passwd")', display: false },
      { tex: '#read("/etc/passwd")', display: false },
    ])
    expect(JSON.stringify([escaped, bare])).not.toContain('root:')
    expect(ok(escaped).width).toBeLessThan(20)
    expect(bare).toEqual({ ok: false, error: TYPST_CODE })
  })

  it.each([
    ['a display label', 'x \\label{eq:1}', true],
    ['a label in text mode', '\\text{\\label{eq:1} a}', false],
    ['an escaped # in text', '\\text{a \\# b}', false],
    ['a colour by name', '\\textcolor{red}{x}', false],
    ['a colour with a model', '\\color[rgb]{1,0,0} x', true],
    ['$ inside \\text', '\\text{a $x$ b}', false],
    ['a label with a non-ASCII letter', 'x \\label{eq:Ü}', true],
    ['a non-ASCII label in text mode', '\\text{\\label{äöü} a}', false],
  ])('still renders %s', async (_name, tex, display) => {
    const r = new MathRenderer(ROOT)
    const [res] = await r.render([{ tex, display }])
    expect(ok(res).svg).toMatch(/^<svg/)
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
    // \\label's argument is raw in text mode (the sixth passthrough): a bare # is refused.
    '\\text{\\label{#panic(read("/formulas.json"))}}',
    '\\text{\\label{x>#panic(1)<y}}',
    '\\text{\\label{#panic(str(range(2000000).len()))}}',
    '\\includegraphics{a"b}',
    '#read("/etc/passwd")',
    // An escaped backslash before it: the # is bare.
    '\\\\#panic(1)',
    // The same passthrough without any #: out of the label into markup, math or code.
    '\\text{\\label{x>$hspace(p a n i c \\( 1 \\))$<y}}',
    '\\textcolor{\\label{x>], panic(1), [<y}}{z}',
    '\\newcommand{\\x}{\\label}\\text{\\x{a>], panic(1), [<b}}',
    // The colour model is raw too, as a code argument.
    '\\color[{x], panic(1), [y}]{red} z',
    '\\textcolor[$hspace(p a n i c \\( 1 \\))$]{red}{z}',
    '\\textcolor%\n[{a]}]{red}{x}',
    '\\newcommand{\\x}{\\textcolor}\\x[{a]}]{red}{x}',
    // Unicode letters are allowed in a label, the punctuation that leaves it still is not.
    'x \\label{Ü]}',
    'x \\label{ä$b}',
    'x \\label{ä>b}',
    'x \\label{ä<b}',
    'x \\label{a,b}',
    'x \\label{a(b)}',
    'x \\label{a"b}',
  ])('refuses raw Typst code without compiling it: %s', async (tex) => {
    const spawnImpl = vi.fn() as unknown as typeof spawn
    const r = new MathRenderer(await fakeRoot(), { spawnImpl })
    expect(await r.render([{ tex, display: false }])).toEqual([
      { ok: false, error: 'Typst-Code in Formeln wird in der Vorschau nicht ausgeführt' },
    ])
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it('pins mitex 0.2.7, the version the refusals and the output allowlist were audited for', () => {
    // A mitex bump must re-audit specs/latex/standard.typ (eval, raw output) and re-probe the
    // converter's `#` emissions (MITEX_CODE in src/core/math.ts) before this pin may change.
    const assets = JSON.parse(
      readFileSync(join(__dirname, '../../../scripts/pipeline-assets.json'), 'utf8'),
    ) as { packages: { name: string; version: string }[] }
    expect(assets.packages.find((p) => p.name === 'mitex')?.version).toBe('0.2.7')
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

/** Runs MATH_PROGRAM alone (no source checks) on `items` with the real Typst; its stderr. */
const runProgram = async (items: MathItem[]): Promise<{ code: number | null; stderr: string }> => {
  const dir = await tempDir('mdo-math-program-')
  await cp(join(ROOT, 'vendor', 'mitex'), join(dir, 'mitex'), { recursive: true })
  await writeFile(join(dir, 'main.typ'), MATH_PROGRAM)
  await writeFile(join(dir, 'formulas.json'), JSON.stringify(items))
  return new Promise((resolve) => {
    let stderr = ''
    const args = ['compile', '--root', dir, '--format', 'svg', 'main.typ', 'out-{0p}.svg']
    const child = spawn(TYPST, args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      stderr += d
    })
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

describe.skipIf(skip)('MATH_PROGRAM output checks (real Typst, no source checks)', () => {
  // The second layer: these reach Typst only if main's source checks missed them.
  it.each([
    '\\text{\\label{#panic(1)}}',
    '\\text{\\label{x>#panic(1)<y}}',
    '\\text{\\label{x>$hspace(p a n i c \\( 1 \\))$<y}}',
    '\\textcolor[$hspace(p a n i c \\( 1 \\))$]{red}{z}',
    '\\color[{x], panic(1), [y}]{red} z',
    '\\text{\\includegraphics{x}}',
    '\\text{\\iftypst #panic(1) \\fi}',
  ])('panics with the refusal marker: %s', async (tex) => {
    const res = await runProgram([{ tex, display: true }])
    expect(res.code).not.toBe(0)
    expect(res.stderr).toContain(MATH_REFUSED)
    expect(res.stderr).not.toContain('panicked with: 1')
  })

  it.each([
    'x \\label{eq:1}',
    '\\text{a \\# b}',
    '\\textcolor[rgb]{1,0,0}{x}',
    '\\text{\\textbf{b} \\emph{e} $x$}',
    '\\text{\\footnote{f} \\section{s}}',
    '\\begin{cases} a & b \\\\ c & d \\end{cases}',
  ])('leaves legitimate output alone: %s', async (tex) => {
    const res = await runProgram([{ tex, display: false }])
    expect(res.stderr).toBe('')
    expect(res.code).toBe(0)
  })
})

/** A stand-in Typst that runs `script` (Node) in the run's temp dir. */
const scriptSpawn = (script: (cwd: string) => string) => {
  let calls = 0
  const impl = ((_cmd: string, _args: string[], opts: { cwd: string }) => {
    calls++
    return spawn(process.execPath, ['-e', script(opts.cwd)], opts)
  }) as unknown as typeof spawn
  return { impl, calls: () => calls }
}

/** Node code writing `pages` tight SVG pages of `body` into the run's dir. */
const writePages = (pages: number, body = '') =>
  `for (let p = 1; p <= ${pages}; p++) require('fs').writeFileSync('out-' + p + '.svg', '<svg width="5pt" height="4pt">${body}</svg>')`

describe('MathRenderer (limits and messages)', () => {
  it('turns the program refusal marker into the refusal message', async () => {
    const typst = scriptSpawn(
      () => `console.error('error: panicked with: "${MATH_REFUSED}"'); process.exit(1)`,
    )
    const r = new MathRenderer(await fakeRoot(), { spawnImpl: typst.impl, rssProbe: null })
    expect(await r.render([{ tex: 'x', display: true }])).toEqual([
      { ok: false, error: TYPST_CODE },
    ])
  })

  it.skipIf(process.platform === 'win32')(
    'kills a run whose memory passes the limit and says why',
    async () => {
      const hang = hangingSpawn()
      const probed: number[] = []
      const r = new MathRenderer(await fakeRoot(), {
        timeoutMs: 20_000,
        spawnImpl: hang.impl,
        maxRssBytes: 1024 ** 3,
        rssProbe: async (pid) => {
          probed.push(pid)
          return 2 * 1024 ** 3
        },
      })
      const res = await r.render([{ tex: 'x', display: true }])
      expect(res).toEqual([{ ok: false, error: 'Formel braucht zu viel Speicher' }])
      const child = hang.children[0] as ChildProcess
      expect(probed[0]).toBe(child.pid)
      await exited(child)
      expect(child.signalCode).toBe('SIGTERM')
    },
  )

  it('leaves a run below the memory limit alone', async () => {
    const typst = scriptSpawn(() => `setTimeout(() => { ${writePages(1)} }, 600)`)
    let probes = 0
    const r = new MathRenderer(await fakeRoot(), {
      spawnImpl: typst.impl,
      rssProbe: async () => {
        probes++
        return 100 * 1024 ** 2
      },
    })
    const [res] = await r.render([{ tex: 'x', display: true }])
    expect(res?.ok).toBe(true)
    expect(probes).toBeGreaterThan(0)
  })

  it('fails formulas whose SVG output passes the size cap', async () => {
    const typst = scriptSpawn(() => writePages(1, 'x'.repeat(2000)))
    const r = new MathRenderer(await fakeRoot(), {
      spawnImpl: typst.impl,
      rssProbe: null,
      maxSvgBytes: 1000,
    })
    expect(await r.render([{ tex: 'x', display: true }])).toEqual([
      { ok: false, error: 'Formel zu groß für die Vorschau' },
    ])
  })

  it('stops halving when every run fails the same way without a formula to blame', async () => {
    const typst = scriptSpawn(
      () => `console.error('error: dyld: Library not loaded: libfoo'); process.exit(1)`,
    )
    const r = new MathRenderer(await fakeRoot(), { spawnImpl: typst.impl, rssProbe: null })
    const items = Array.from({ length: 8 }, (_, i) => ({ tex: `x_${i}`, display: true }))
    const res = await r.render(items)
    expect(res).toEqual(items.map(() => ({ ok: false, error: 'dyld: Library not loaded: libfoo' })))
    // The whole batch, then halves down to the first item: 4 runs, not 15.
    expect(typst.calls()).toBe(4)
  })

  it('keeps halving when the first formula itself is the culprit', async () => {
    // Typst's excerpt points into the program: a formula error, even with the batch's message.
    const typst = fakeTypst((batch) => (batch.some((i) => i.tex === 'bad') ? 'fail' : 'ok'))
    const located = ((cmd: string, args: string[], opts: { cwd: string }) => {
      const items = JSON.parse(readFileSync(join(opts.cwd, 'formulas.json'), 'utf8')) as MathItem[]
      if (items.some((i) => i.tex === 'bad')) {
        const err =
          "console.error('error: unknown variable: bad\\n   ┌─ main.typ:9:5'); process.exit(1)"
        return spawn(process.execPath, ['-e', err], opts)
      }
      return typst.impl(cmd, args, opts as never)
    }) as unknown as typeof spawn
    const r = new MathRenderer(await fakeRoot(), { spawnImpl: located, rssProbe: null })
    const items = ['bad', 'a', 'b', 'c'].map((tex) => ({ tex, display: true }))
    const res = await r.render(items)
    expect(res[0]).toEqual({ ok: false, error: 'unknown variable: bad' })
    expect(res.slice(1).map((x) => x.ok)).toEqual([true, true, true])
  })

  it('cuts the temp dir from Typst messages', async () => {
    const typst = scriptSpawn(
      (cwd) =>
        `console.error('error: file not found (searched at ' + ${JSON.stringify(cwd)} + '/formulas.json)'); process.exit(1)`,
    )
    const r = new MathRenderer(await fakeRoot(), { spawnImpl: typst.impl, rssProbe: null })
    const [res] = await r.render([{ tex: 'x', display: true }])
    expect(res).toEqual({ ok: false, error: 'file not found (searched at formulas.json)' })
  })

  it('firstError cuts every given spelling of the dir, the longer one first', () => {
    const stderr = 'error: failed to load /private/var/T/mdo-math-1/x.typ and /var/T/mdo-math-1\n'
    expect(firstError(stderr, 1, ['/var/T/mdo-math-1', '/private/var/T/mdo-math-1'])).toBe(
      'failed to load x.typ and ',
    )
    expect(firstError('', 3)).toBe('Typst endete mit Code 3.')
    // A mitex error comes wrapped by Typst's plugin call; the tooltip shows mitex's message.
    expect(firstError('error: plugin errored with: error: unknown command: \\ce\n', 1)).toBe(
      'unknown command: \\ce',
    )
  })
})
