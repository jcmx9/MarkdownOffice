// Unit tests for pipeline/cli.js (Vitest, node environment). The real build.sh / convert.ps1 are
// replaced by fakes next to a copy of cli.js, so only the wrapper's own behaviour is tested.
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  appLaunch,
  appVersion,
  invocation,
  pipelineSpawnOptions,
  powershellPath,
  stripAppLibraryPath,
} = require('./cli.js')
const CLI = path.join(import.meta.dirname, 'cli.js')
const win = process.platform === 'win32'

describe('powershellPath', () => {
  const sys32 = (root) => `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`

  it('prefers the absolute system path from SystemRoot when it exists', () => {
    const exists = (p) => p === sys32('D:\\Win')
    expect(powershellPath({ SystemRoot: 'D:\\Win' }, exists)).toBe(sys32('D:\\Win'))
  })

  it('falls back to windir, then C:\\Windows', () => {
    expect(powershellPath({ windir: 'E:\\W' }, () => true)).toBe(sys32('E:\\W'))
    expect(powershellPath({}, () => true)).toBe(sys32('C:\\Windows'))
  })

  it('falls back to the bare name when the file is missing', () => {
    expect(powershellPath({ SystemRoot: 'C:\\Windows' }, () => false)).toBe('powershell.exe')
  })
})

describe('appVersion', () => {
  it('reads the version from app.asar next to the pipeline folder', () => {
    const read = (file) => {
      expect(file).toBe(path.join('/app/Resources/pipeline', '..', 'app.asar', 'package.json'))
      return '{"name":"markdown-office","version":"26.10.1"}'
    }
    expect(appVersion('/app/Resources/pipeline', read)).toBe('26.10.1')
  })

  it('falls back to dev without app.asar or with an unusable package.json', () => {
    expect(appVersion(path.join(tmpdir(), 'no-such-mdo-root', 'pipeline'))).toBe('dev')
    expect(appVersion('/r', () => 'not json')).toBe('dev')
    expect(appVersion('/r', () => '{"version":""}')).toBe('dev')
  })
})

describe('appLaunch', () => {
  const execPath = '/Apps/Markdown Office.app/Contents/MacOS/Markdown Office'

  it('starts this binary detached with the remaining arguments, without node mode', () => {
    const l = appLaunch({
      args: ['/N/a b.md', '--no-source'],
      env: { ELECTRON_RUN_AS_NODE: '1', MDO_LAUNCH_LOG: '/s/launch.log', HOME: '/h' },
      execPath,
    })
    expect(l).toEqual({
      file: execPath,
      args: ['/N/a b.md', '--no-source'],
      env: { HOME: '/h' },
      wait: false,
      log: '/s/launch.log',
    })
  })

  it.each([['--version'], ['-V'], ['--help'], ['-h']])('waits for the app with %s', (flag) => {
    const l = appLaunch({ args: [flag], env: {}, execPath })
    expect(l.wait).toBe(true)
    expect(l.log).toBeUndefined()
  })
})

describe('invocation', () => {
  const base = { args: ['a b.md', '--template=memo'], scriptDir: '/real/pipeline' }

  it('runs build.sh with bash on POSIX and fills the MDO_* defaults', () => {
    const inv = invocation({
      ...base,
      platform: 'darwin',
      env: { PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1' },
      invokedDir: '/app/pipeline',
    })
    expect(inv.file).toBe('bash')
    expect(inv.args).toEqual(['/real/pipeline/build.sh', 'a b.md', '--template=memo'])
    expect(inv.env).toMatchObject({
      MDO_PIPELINE_ROOT: '/app/pipeline',
      MDO_SETS_DIR: '/app/sets',
      MDO_VERSION: 'dev',
      PATH: '/app/pipeline/bin:/usr/bin:/bin',
    })
    expect(inv.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('keeps MDO_* values that are already set', () => {
    const inv = invocation({
      ...base,
      platform: 'linux',
      env: { MDO_PIPELINE_ROOT: '/r', MDO_SETS_DIR: '/s', MDO_VERSION: '26.10.0' },
      invokedDir: '/ignored',
    })
    expect(inv.env).toMatchObject({
      MDO_PIPELINE_ROOT: '/r',
      MDO_SETS_DIR: '/s',
      MDO_VERSION: '26.10.0',
      PATH: '/r/bin',
    })
  })

  it("drops the app's LD_LIBRARY_PATH entry on POSIX, and keeps the variable without execDir", () => {
    const env = { LD_LIBRARY_PATH: '/opt/mdo/usr/lib' }
    const linux = { ...base, platform: 'linux', invokedDir: '/opt/mdo/resources/pipeline' }
    const stripped = invocation({ ...linux, env, execDir: '/opt/mdo' })
    expect('LD_LIBRARY_PATH' in stripped.env).toBe(false)
    const kept = invocation({
      ...linux,
      env: { LD_LIBRARY_PATH: '/opt/mdo/usr/lib:/x' },
      execDir: '/opt/mdo',
    })
    expect(kept.env.LD_LIBRARY_PATH).toBe('/x')
    expect(invocation({ ...linux, env }).env.LD_LIBRARY_PATH).toBe('/opt/mdo/usr/lib')
  })

  it('runs convert.ps1 with Windows PowerShell and prefixes the Path variable', () => {
    const inv = invocation({
      args: ['C:\\N\\a b.md'],
      scriptDir: 'C:\\Real\\pipeline',
      platform: 'win32',
      env: { Path: 'C:\\Windows' },
      invokedDir: 'C:\\App\\resources\\pipeline',
      exists: () => false,
    })
    expect(inv.file).toBe('powershell.exe')
    expect(inv.args).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\Real\\pipeline\\convert.ps1',
      'C:\\N\\a b.md',
    ])
    expect(inv.env.Path).toBe('C:\\App\\resources\\pipeline\\bin;C:\\Windows')
    expect(inv.env.PATH).toBeUndefined()
    expect(inv.env.MDO_SETS_DIR).toBe('C:\\App\\resources\\sets')
  })
})

describe('pipelineSpawnOptions', () => {
  it('hides the console window on Windows and inherits stdio', () => {
    const env = { A: '1' }
    expect(pipelineSpawnOptions(env)).toEqual({ stdio: 'inherit', env, windowsHide: true })
  })
})

describe('stripAppLibraryPath', () => {
  const same = (p) => p

  it("removes the app's own usr/lib and keeps the other entries in order", () => {
    expect(stripAppLibraryPath('/opt/mdo/usr/lib:/a:/b', '/opt/mdo', same)).toBe('/a:/b')
    expect(stripAppLibraryPath('/a:/opt/mdo/usr/lib/:/b', '/opt/mdo', same)).toBe('/a:/b')
  })

  it('returns undefined when only the app entry was set', () => {
    expect(stripAppLibraryPath('/opt/mdo/usr/lib', '/opt/mdo', same)).toBeUndefined()
  })

  it("keeps a foreign value unchanged, also another app's usr/lib", () => {
    expect(stripAppLibraryPath('/other/usr/lib:/a', '/opt/mdo', same)).toBe('/other/usr/lib:/a')
    expect(stripAppLibraryPath(undefined, '/opt/mdo', same)).toBeUndefined()
  })

  it('matches an entry that resolves to the app folder through a symlink', () => {
    const real = (p) => p.replace('/home/link', '/data/home')
    expect(stripAppLibraryPath('/home/link/mdo/usr/lib:/a', '/data/home/mdo', real)).toBe('/a')
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
    // The dev layout links cli.js; Windows without symlink rights gets copies (as dev-layout.sh
    // under Git Bash), so there the scripts sit next to the copy.
    if (win) {
      copyFileSync(CLI, path.join(layout, 'cli.js'))
      copyFileSync(path.join(real, 'convert.ps1'), path.join(layout, 'convert.ps1'))
    } else symlinkSync(path.join(real, 'cli.js'), path.join(layout, 'cli.js'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const run = (args, env = {}) => {
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
  const lines = (file) =>
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
  const waitFor = async (file) => {
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
