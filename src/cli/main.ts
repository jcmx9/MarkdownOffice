// Entry point of the `markdown-office` command and of the editor's export. It runs under the
// app's own Electron binary with ELECTRON_RUN_AS_NODE=1 (plain Node, no dependencies) and hands
// every argument to build.sh (macOS/Linux) or convert.ps1 (Windows). stdout, stderr and the exit
// code pass through unchanged; a pipeline killed by a signal exits with 1.
//
// Layout: MDO_PIPELINE_ROOT defaults to the folder this file was invoked from (packaged:
// <resources>/pipeline; development: build/pipeline-dev/pipeline, where the CLI build writes a
// copy of cli.js), MDO_SETS_DIR to <root>/../sets and MDO_VERSION to `dev` (the app passes its
// version). build.sh / convert.ps1 are taken from next to the real file (symlinks resolved).
//
// `--app [args]` as the first argument starts the editor instead: this process's own binary (the
// app) with the remaining arguments, without ELECTRON_RUN_AS_NODE. The installed shims therefore
// always run cli.js and need no argument handling of their own (cmd's `shift` does not change
// `%*`). --version/--help wait for the app and pass its output on; anything else starts the app
// detached and returns at once, with its output in MDO_LAUNCH_LOG (truncated per start) if set.
//
// `validate <note.md> [--fix] [--add-missing] [--json]` as the first argument checks the note's
// YAML front matter with the editor's validator (src/core/frontmatter-validate.ts, the pipeline
// schema is bundled in) instead of running the pipeline: findings as `<file>:<line>: Fehler|
// Warnung|Hinweis: <message>`, exit 0 = no errors, 1 = errors, 2 = usage or file error. --fix
// writes the preselected fixes, --add-missing the set's missing keys (atomic, every other byte
// kept); --json prints one JSON object. Sets come from MDO_SETS_DIR, user sets from MDO_TEMPLATES.
//
// Source: src/cli/ (TypeScript), bundled by vite.cli.config.mts into one CommonJS file cli.js,
// which keeps this comment as its banner.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { appLaunch, type Env, invocation, pipelineSpawnOptions, realOrSelf } from './launch'
import { runValidate } from './validate'

/** Opens the launch log for writing (folder created), or returns 'ignore' when it cannot. */
function openLog(log: string | undefined): number | 'ignore' {
  if (!log) return 'ignore'
  try {
    fs.mkdirSync(path.dirname(log), { recursive: true })
    return fs.openSync(log, 'w')
  } catch {
    return 'ignore'
  }
}

function launchApp(args: string[], env: Env): void {
  const l = appLaunch({ args, env, execPath: process.execPath })
  const failed = (err: Error) => {
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

export function main(argv: string[] = process.argv, env: Env = process.env): void {
  if (argv[2] === '--app') {
    launchApp(argv.slice(3), env)
    return
  }
  if (argv[2] === 'validate') {
    // exitCode, not process.exit: piped output must be flushed first.
    runValidate(
      argv.slice(3),
      env,
      (s) => process.stdout.write(s),
      (s) => process.stderr.write(s),
    ).then(
      (code) => {
        process.exitCode = code
      },
      (e: Error) => {
        process.stderr.write(`markdown-office: ${e.message}\n`)
        process.exitCode = 2
      },
    )
    return
  }
  // __filename is the bundled cli.js itself (the CommonJS wrapper provides it); Node already
  // resolves it, realpath keeps that explicit. build.sh / convert.ps1 sit next to the real file.
  const self = fs.realpathSync(__filename)
  // argv[1] keeps the invoked path (symlinks not resolved), unlike __filename.
  const invokedDir = argv[1] ? path.dirname(path.resolve(argv[1])) : path.dirname(self)
  const inv = invocation({
    platform: process.platform,
    args: argv.slice(2),
    env,
    scriptDir: path.dirname(self),
    invokedDir,
    execDir: path.dirname(realOrSelf(process.execPath)),
  })
  const child = spawn(inv.file, inv.args, pipelineSpawnOptions(inv.env))
  // Keep the wrapper alive until the pipeline has ended, and let the pipeline see the signal.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
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

// Run only as the entry (the bundled cli.js), not when imported.
if (require.main === module) main()
