// Subprocess tests of the bundled `markdown-office` command. The bundle is built once with
// vite.cli.config.mts into a temp folder; the real build.sh / convert.ps1 are replaced by fakes next
// to a copy of it, so only the wrapper's own behaviour is tested.
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const ROOT = path.join(__dirname, '../../..')
const win = process.platform === 'win32'

let outDir = ''
let CLI = ''

beforeAll(async () => {
  outDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mdo cli bundle ')))
  await build({
    configFile: path.join(ROOT, 'vite.cli.config.mts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  })
  CLI = path.join(outDir, 'cli.js')
}, 60_000)
afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true })
})

describe('bundle', () => {
  it('is one CommonJS file that starts with the header comment', () => {
    expect(readdirSync(outDir)).toEqual(['cli.js'])
    const src = readFileSync(CLI, 'utf8')
    expect(src.startsWith('// Entry point of the `markdown-office` command')).toBe(true)
    expect(src).not.toMatch(/^\s*(import|export)\s/m)
  })

  it('requires nothing but Node built-ins (node:*), so it runs without node_modules', () => {
    const src = readFileSync(CLI, 'utf8')
    const required = [...src.matchAll(/\brequire\(\s*(["'`])(.*?)\1\s*\)/g)].map((m) => m[2])
    expect(required.length).toBeGreaterThan(0)
    for (const id of required) expect(id).toMatch(/^node:/)
  })
})

describe('cli.js', () => {
  let dir = ''
  let real = ''
  let layout = ''
  let record = ''

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mdo cli ')))
    real = path.join(dir, 'real pipeline')
    layout = path.join(dir, 'layout', 'pipeline')
    record = path.join(dir, 'record')
    mkdirSync(real)
    mkdirSync(layout, { recursive: true })
    copyFileSync(CLI, path.join(real, 'cli.js'))
    writeFileSync(
      path.join(real, 'build.sh'),
      [
        '#!/usr/bin/env bash',
        'printf "%s\\n" "$@" > "$FAKE_RECORD.args"',
        'e=unset; [ -n "$ELECTRON_RUN_AS_NODE" ] && e=$ELECTRON_RUN_AS_NODE',
        'l="$(printenv LD_LIBRARY_PATH || echo unset)"',
        'printf "%s\\n" "$MDO_PIPELINE_ROOT" "$MDO_SETS_DIR" "$MDO_VERSION" "$PATH" "$e" "$l" > "$FAKE_RECORD.env"',
        'if [ -n "$FAKE_SIGNAL" ]; then kill -TERM $$; fi',
        'exit "$FAKE_EXIT"',
        '',
      ].join('\n'),
    )
    writeFileSync(
      path.join(real, 'convert.ps1'),
      [
        '$args | Set-Content -LiteralPath "$($env:FAKE_RECORD).args"',
        '$e = if ($env:ELECTRON_RUN_AS_NODE) { $env:ELECTRON_RUN_AS_NODE } else { "unset" }',
        '@($env:MDO_PIPELINE_ROOT, $env:MDO_SETS_DIR, $env:MDO_VERSION, $env:Path, $e) | Set-Content -LiteralPath "$($env:FAKE_RECORD).env"',
        'exit [int]$env:FAKE_EXIT',
        '',
      ].join('\r\n'),
    )
    // A symlinked cli.js (e.g. a hand-made link to a pipeline folder); Windows without symlink
    // rights gets copies (as dev-layout.sh under Git Bash), so there the scripts sit next to them.
    if (win) {
      copyFileSync(CLI, path.join(layout, 'cli.js'))
      copyFileSync(path.join(real, 'convert.ps1'), path.join(layout, 'convert.ps1'))
    } else symlinkSync(path.join(real, 'cli.js'), path.join(layout, 'cli.js'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const run = (args: string[], env: Record<string, string> = {}) => {
    // FAKE_EXIT defaults to 0, FAKE_SIGNAL to off (see the fake build.sh / convert.ps1).
    const clean = { ...process.env }
    for (const k of Object.keys(clean)) if (k.startsWith('MDO_')) delete clean[k]
    return spawnSync(process.execPath, [path.join(layout, 'cli.js'), ...args], {
      env: {
        ...clean,
        ELECTRON_RUN_AS_NODE: '1',
        FAKE_RECORD: record,
        FAKE_EXIT: '0',
        FAKE_SIGNAL: '',
        ...env,
      },
      encoding: 'utf8',
    })
  }
  const lines = (file: string) =>
    readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((l, i, a) => l !== '' || i < a.length - 1)

  // A stand-in app: with plain Node as process.execPath, `--app <script> …` runs the script.
  const fakeApp = () => {
    const script = path.join(dir, 'fake app.js')
    writeFileSync(
      script,
      [
        "const fs = require('node:fs')",
        'const rec = process.env.FAKE_RECORD',
        "if (process.argv.includes('--version')) { console.log('Markdown Office 1.2.3'); process.exit(3) }",
        "fs.writeFileSync(rec + '.app.tmp', JSON.stringify({ args: process.argv.slice(2), node: process.env.ELECTRON_RUN_AS_NODE ?? null, log: process.env.MDO_LAUNCH_LOG ?? null, cwd: process.cwd() }))",
        "console.log('app started')",
        "fs.renameSync(rec + '.app.tmp', rec + '.app')",
        '',
      ].join('\n'),
    )
    return script
  }
  const waitFor = async (file: string) => {
    for (let i = 0; i < 100; i++) {
      try {
        return readFileSync(file, 'utf8')
      } catch {
        await new Promise((r) => setTimeout(r, 50))
      }
    }
    throw new Error(`timed out waiting for ${file}`)
  }

  it('--app starts the app detached with the remaining arguments and returns at once', async () => {
    const log = path.join(dir, 'state dir', 'launch.log')
    const r = run(['--app', fakeApp(), 'Notiz mit Leerzeichen.md', '--template', 'x y'], {
      MDO_LAUNCH_LOG: log,
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    const seen = JSON.parse(await waitFor(`${record}.app`))
    expect(seen.args).toEqual(['Notiz mit Leerzeichen.md', '--template', 'x y'])
    expect(seen.node).toBeNull()
    expect(seen.log).toBeNull()
    expect(realpathSync(seen.cwd)).toBe(realpathSync(process.cwd()))
    expect(readFileSync(log, 'utf8')).toContain('app started')
  })

  it('--app --version waits for the app and passes its output and exit code on', () => {
    const r = run(['--app', fakeApp(), '--version'])
    expect(r.status).toBe(3)
    expect(r.stdout.trim()).toBe('Markdown Office 1.2.3')
  })

  it.skipIf(win)('passes the exit code and every argument through unchanged', () => {
    const r = run(['Notiz mit Leerzeichen.md', '--no-source'], { FAKE_EXIT: '4' })
    expect(r.status).toBe(4)
    expect(lines(`${record}.args`)).toEqual(['Notiz mit Leerzeichen.md', '--no-source'])
  })

  it.skipIf(win)('sets the MDO_* variables from the invoked folder and prefixes PATH', () => {
    const r = run(['x.md'], { MDO_VERSION: '26.10.0' })
    expect(r.status).toBe(0)
    const [root, sets, version, pathVar, electron] = lines(`${record}.env`)
    expect(root).toBe(layout)
    expect(sets).toBe(path.join(layout, '..', 'sets'))
    expect(version).toBe('26.10.0')
    expect(pathVar?.startsWith(`${path.join(layout, 'bin')}${path.delimiter}`)).toBe(true)
    expect(electron).toBe('unset')
  })

  // Through a symlink (the dev layout linked cli.js before the CLI was bundled; a hand-made link
  // still works the same way). The pipeline root is the symlink's folder (argv[1], not
  // resolved), while build.sh is the one next to the real file — a decoy build.sh beside the
  // symlink must not run.
  it.skipIf(win)('through a symlinked cli.js: root from the link, build.sh from the target', () => {
    writeFileSync(
      path.join(layout, 'build.sh'),
      ['#!/usr/bin/env bash', 'touch "$FAKE_RECORD.decoy"', 'exit 9', ''].join('\n'),
    )
    const r = run(['x.md'])
    expect(r.status).toBe(0)
    expect(existsSync(`${record}.decoy`)).toBe(false)
    expect(lines(`${record}.args`)).toEqual(['x.md'])
    const [root, sets] = lines(`${record}.env`)
    expect(root).toBe(layout)
    expect(sets).toBe(path.join(layout, '..', 'sets'))
  })

  it.skipIf(win)("removes the app's own library folder from LD_LIBRARY_PATH", () => {
    const own = path.join(path.dirname(realpathSync(process.execPath)), 'usr', 'lib')
    expect(run(['x.md'], { LD_LIBRARY_PATH: `${own}:/keep me` }).status).toBe(0)
    expect(lines(`${record}.env`)[5]).toBe('/keep me')
    expect(run(['x.md'], { LD_LIBRARY_PATH: own }).status).toBe(0)
    expect(lines(`${record}.env`)[5]).toBe('unset')
  })

  it.skipIf(win)('exits with 1 when the pipeline dies from a signal', () => {
    expect(run(['x.md'], { FAKE_SIGNAL: '1' }).status).toBe(1)
  })

  it.runIf(win)('runs convert.ps1 and passes code, arguments and variables (Windows)', () => {
    const r = run(['Notiz mit Leerzeichen.md'], { FAKE_EXIT: '4' })
    expect(r.status).toBe(4)
    expect(lines(`${record}.args`)).toEqual(['Notiz mit Leerzeichen.md'])
    const [root, sets, version, pathVar] = lines(`${record}.env`)
    expect(root).toBe(layout)
    expect(sets).toBe(path.join(layout, '..', 'sets'))
    expect(version).toBe('dev')
    expect(pathVar?.toLowerCase().startsWith(path.join(layout, 'bin').toLowerCase())).toBe(true)
  })
})
