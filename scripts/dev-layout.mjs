// Runs pipeline/tests/dev-layout.sh after `npm run assets`, so `npm run dev` and the e2e tests
// find the pipeline at build/pipeline-dev (the packaged layout). On Windows npm runs scripts
// through cmd.exe, where `bash` may be WSL's: Git for Windows' bash is preferred there. Under
// Git Bash, `ln -s` copies instead of linking (see dev-layout.sh).
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The bash to run dev-layout.sh with.
 * @param {string} platform
 * @param {Record<string, string | undefined>} env
 * @param {(p: string) => boolean} exists
 * @returns {string}
 */
export function bashFor(platform, env, exists) {
  if (platform !== 'win32') return 'bash'
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432]) {
    const candidate = base && join(base, 'Git', 'bin', 'bash.exe')
    if (candidate && exists(candidate)) return candidate
  }
  return 'bash'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    execFileSync(
      bashFor(process.platform, process.env, existsSync),
      [join(root, 'pipeline', 'tests', 'dev-layout.sh')],
      { stdio: 'inherit' },
    )
  } catch {
    console.error(
      'Dev-Layout der Pipeline konnte nicht angelegt werden (pipeline/tests/dev-layout.sh).',
    )
    process.exit(1)
  }
}
