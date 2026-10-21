// Pure helpers of the `markdown-office` command (src/cli/launch.ts); the subprocess behaviour of
// the bundled cli.js is covered by bundle.test.ts.
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appLaunch,
  appVersion,
  invocation,
  pipelineSpawnOptions,
  powershellPath,
  stripAppLibraryPath,
} from '../../../src/cli/launch'

describe('powershellPath', () => {
  const sys32 = (root: string) => `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`

  it('prefers the absolute system path from SystemRoot when it exists', () => {
    const exists = (p: string) => p === sys32('D:\\Win')
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
    const read = (file: string) => {
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
  const same = (p: string) => p

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
    const real = (p: string) => p.replace('/home/link', '/data/home')
    expect(stripAppLibraryPath('/home/link/mdo/usr/lib:/a', '/data/home/mdo', real)).toBe('/a')
  })
})
