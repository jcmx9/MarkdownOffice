// Pure helpers of the `markdown-office` command (see main.ts for the wiring). Kept free of
// process-global state so the unit tests can drive them with fake environments and file checks.
import type { SpawnOptions } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export type Env = Record<string, string | undefined>

/** The command that runs the pipeline script, with the environment it needs. */
export interface Invocation {
  file: string
  args: string[]
  env: Env
}

/** How `--app [args]` starts the editor. */
export interface AppLaunch {
  file: string
  args: string[]
  env: Env
  wait: boolean
  log: string | undefined
}

/**
 * Absolute path of the system Windows PowerShell when it exists (no PATH lookup by the child),
 * else the bare name.
 */
export function powershellPath(env: Env, exists: (file: string) => boolean): string {
  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'
  const full = path.win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  return exists(full) ? full : 'powershell.exe'
}

/**
 * The app version for MDO_VERSION: `version` from <root>/../app.asar/package.json (Electron as
 * Node reads asar archives), else `dev` (development layout, plain Node).
 * @param root the pipeline folder
 */
export function appVersion(
  root: string,
  read: (file: string) => string = (file) => fs.readFileSync(file, 'utf8'),
): string {
  try {
    const { version } = JSON.parse(read(path.join(root, '..', 'app.asar', 'package.json')))
    return typeof version === 'string' && version ? version : 'dev'
  } catch {
    return 'dev'
  }
}

/** realpath, or the path itself when it cannot be resolved. */
export function realOrSelf(file: string): string {
  try {
    return fs.realpathSync(file)
  } catch {
    return file
  }
}

/**
 * LD_LIBRARY_PATH without the app's own library folder `<execDir>/usr/lib`, which the Linux shim
 * and the AppImage's AppRun put first for the editor. The pipeline and the PDF viewer it opens
 * (xdg-open) must not load those libraries. Other entries stay in order; `undefined` when nothing
 * is left. An entry matches as written or after resolving symlinks (execPath is resolved).
 * @param execDir the folder of the app binary
 */
export function stripAppLibraryPath(
  value: string | undefined,
  execDir: string,
  real: (file: string) => string = realOrSelf,
): string | undefined {
  if (!value) return value
  const own = path.posix.join(execDir, 'usr', 'lib')
  const isOwn = (entry: string) => {
    if (entry === '') return false
    const plain = path.posix.normalize(entry).replace(/\/+$/, '')
    return plain === own || real(plain) === own
  }
  const rest = value.split(':').filter((entry) => !isOwn(entry))
  return rest.length > 0 ? rest.join(':') : undefined
}

/** The command that runs the pipeline script, with the environment it needs. */
export function invocation(o: {
  platform: string
  args: string[]
  env: Env
  scriptDir: string
  invokedDir: string
  execDir?: string
  exists?: (file: string) => boolean
  version?: (root: string) => string
}): Invocation {
  const win = o.platform === 'win32'
  const p = win ? path.win32 : path.posix
  const env: Env = { ...o.env }
  // Only the wrapper runs as Node: a viewer the pipeline opens may be an Electron app itself.
  delete env.ELECTRON_RUN_AS_NODE
  if (!win && o.execDir && 'LD_LIBRARY_PATH' in env) {
    const libraryPath = stripAppLibraryPath(env.LD_LIBRARY_PATH, o.execDir)
    if (libraryPath === undefined) delete env.LD_LIBRARY_PATH
    else env.LD_LIBRARY_PATH = libraryPath
  }
  const root = env.MDO_PIPELINE_ROOT || o.invokedDir
  env.MDO_PIPELINE_ROOT = root
  if (!env.MDO_SETS_DIR) env.MDO_SETS_DIR = p.join(root, '..', 'sets')
  if (!env.MDO_VERSION) env.MDO_VERSION = (o.version ?? appVersion)(root)
  // Windows spells it Path; keep whatever spelling the environment has.
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const bin = p.join(root, 'bin')
  const current = env[pathKey]
  env[pathKey] = current ? `${bin}${p.delimiter}${current}` : bin
  if (win) {
    return {
      file: powershellPath(env, o.exists ?? fs.existsSync),
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        p.join(o.scriptDir, 'convert.ps1'),
        ...o.args,
      ],
      env,
    }
  }
  return { file: 'bash', args: [p.join(o.scriptDir, 'build.sh'), ...o.args], env }
}

/**
 * spawn() options for the pipeline. windowsHide: the editor runs this wrapper without a console,
 * so powershell.exe would otherwise open a console window on every export (a terminal run keeps
 * its console; the output goes through the inherited handles either way).
 */
export function pipelineSpawnOptions(env: Env): SpawnOptions {
  return { stdio: 'inherit', env, windowsHide: true }
}

/** How `--app [args]` starts the editor. `args` excludes `--app`. */
export function appLaunch(o: { args: string[]; env: Env; execPath: string }): AppLaunch {
  const env: Env = { ...o.env }
  delete env.ELECTRON_RUN_AS_NODE
  const log = env.MDO_LAUNCH_LOG || undefined
  delete env.MDO_LAUNCH_LOG
  const wait = o.args.some((a) => ['--version', '-V', '--help', '-h'].includes(a))
  return { file: o.execPath, args: o.args, env, wait, log }
}
