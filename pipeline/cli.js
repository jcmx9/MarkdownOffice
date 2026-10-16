// Entry point of the `markdown-office` command and of the editor's export. It runs under the
// app's own Electron binary with ELECTRON_RUN_AS_NODE=1 (plain Node, no dependencies) and hands
// every argument to build.sh (macOS/Linux) or convert.ps1 (Windows). stdout, stderr and the exit
// code pass through unchanged; a pipeline killed by a signal exits with 1.
//
// Layout: MDO_PIPELINE_ROOT defaults to the folder this file was invoked from (packaged:
// <resources>/pipeline; development: build/pipeline-dev/pipeline, where cli.js is a symlink),
// MDO_SETS_DIR to <root>/../sets and MDO_VERSION to `dev` (the app passes its version).
// build.sh / convert.ps1 are taken from next to the real file (symlinks resolved).
//
// `--app [args]` as the first argument starts the editor instead: this process's own binary (the
// app) with the remaining arguments, without ELECTRON_RUN_AS_NODE. The installed shims therefore
// always run cli.js and need no argument handling of their own (cmd's `shift` does not change
// `%*`). --version/--help wait for the app and pass its output on; anything else starts the app
// detached and returns at once, with its output in MDO_LAUNCH_LOG (truncated per start) if set.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Absolute path of the system Windows PowerShell when it exists (no PATH lookup by the child),
 * else the bare name.
 * @param {Record<string, string | undefined>} env
 * @param {(file: string) => boolean} exists
 * @returns {string}
 */
function powershellPath(env, exists) {
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
 * @param {string} root the pipeline folder
 * @param {(file: string) => string} [read]
 * @returns {string}
 */
function appVersion(root, read = (file) => fs.readFileSync(file, 'utf8')) {
  try {
    const { version } = JSON.parse(read(path.join(root, '..', 'app.asar', 'package.json')))
    return typeof version === 'string' && version ? version : 'dev'
  } catch {
    return 'dev'
  }
}

/** realpath, or the path itself when it cannot be resolved. */
function realOrSelf(file) {
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
 * @param {string | undefined} value
 * @param {string} execDir the folder of the app binary
 * @param {(file: string) => string} [real]
 * @returns {string | undefined}
 */
function stripAppLibraryPath(value, execDir, real = realOrSelf) {
  if (!value) return value
  const own = path.posix.join(execDir, 'usr', 'lib')
  const isOwn = (entry) => {
    if (entry === '') return false
    const plain = path.posix.normalize(entry).replace(/\/+$/, '')
    return plain === own || real(plain) === own
  }
  const rest = value.split(':').filter((entry) => !isOwn(entry))
  return rest.length > 0 ? rest.join(':') : undefined
}

/**
 * The command that runs the pipeline script, with the environment it needs.
 * @param {{ platform: string, args: string[], env: Record<string, string | undefined>,
 *   scriptDir: string, invokedDir: string, execDir?: string,
 *   exists?: (file: string) => boolean, version?: (root: string) => string }} o
 * @returns {{ file: string, args: string[], env: Record<string, string | undefined> }}
 */
function invocation(o) {
  const win = o.platform === 'win32'
  const p = win ? path.win32 : path.posix
  const env = { ...o.env }
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
 * @param {Record<string, string | undefined>} env
 */
function pipelineSpawnOptions(env) {
  return { stdio: /** @type {const} */ ('inherit'), env, windowsHide: true }
}

/**
 * How `--app [args]` starts the editor. `args` excludes `--app`.
 * @param {{ args: string[], env: Record<string, string | undefined>, execPath: string }} o
 * @returns {{ file: string, args: string[], env: Record<string, string | undefined>,
 *   wait: boolean, log: string | undefined }}
 */
function appLaunch(o) {
  const env = { ...o.env }
  delete env.ELECTRON_RUN_AS_NODE
  const log = env.MDO_LAUNCH_LOG || undefined
  delete env.MDO_LAUNCH_LOG
  const wait = o.args.some((a) => ['--version', '-V', '--help', '-h'].includes(a))
  return { file: o.execPath, args: o.args, env, wait, log }
}

/** Opens the launch log for writing (folder created), or returns 'ignore' when it cannot. */
function openLog(log) {
  if (!log) return 'ignore'
  try {
    fs.mkdirSync(path.dirname(log), { recursive: true })
    return fs.openSync(log, 'w')
  } catch {
    return 'ignore'
  }
}

function launchApp(args) {
  const l = appLaunch({ args, env: process.env, execPath: process.execPath })
  const failed = (err) => {
    process.stderr.write(
      `markdown-office: ${l.file} konnte nicht gestartet werden: ${err.message}\n`,
    )
    process.exit(1)
  }
  // No windowsHide for the editor: on Windows it would start the app's window hidden.
  if (l.wait) {
    // Piped, not inherited: the Windows app is a GUI program, whose output would not reach an
    // interactive console directly.
    const child = spawn(l.file, l.args, { stdio: ['ignore', 'pipe', 'pipe'], env: l.env })
    child.stdout.pipe(process.stdout)
    child.stderr.pipe(process.stderr)
    child.on('error', failed)
    child.on('close', (code) => process.exit(code ?? 1))
    return
  }
  const out = openLog(l.log)
  const child = spawn(l.file, l.args, { detached: true, stdio: ['ignore', out, out], env: l.env })
  child.on('error', failed)
  child.on('spawn', () => {
    child.unref()
    process.exit(0)
  })
}

function main() {
  if (process.argv[2] === '--app') {
    launchApp(process.argv.slice(3))
    return
  }
  const self = fs.realpathSync(__filename)
  // argv[1] keeps the invoked path (symlinks not resolved), unlike __filename.
  const invokedDir = process.argv[1]
    ? path.dirname(path.resolve(process.argv[1]))
    : path.dirname(self)
  const inv = invocation({
    platform: process.platform,
    args: process.argv.slice(2),
    env: process.env,
    scriptDir: path.dirname(self),
    invokedDir,
    execDir: path.dirname(realOrSelf(process.execPath)),
  })
  const child = spawn(inv.file, inv.args, pipelineSpawnOptions(inv.env))
  // Keep the wrapper alive until the pipeline has ended, and let the pipeline see the signal.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      try {
        child.kill(signal)
      } catch {
        // The pipeline has already ended.
      }
    })
  }
  child.on('error', (err) => {
    process.stderr.write(
      `markdown-office: ${inv.file} konnte nicht gestartet werden: ${err.message}\n`,
    )
    process.exit(1)
  })
  child.on('close', (code) => process.exit(code ?? 1))
}

module.exports = {
  appLaunch,
  appVersion,
  invocation,
  pipelineSpawnOptions,
  powershellPath,
  stripAppLibraryPath,
}

if (require.main === module) main()
