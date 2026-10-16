// Build-time electron-builder `mac.sign` hook (not shipped: `files` only packs out/).
// electron-builder looks `identity: "-"` up as a substring of the keychain's code-signing
// identities before falling back to ad hoc, so any local certificate whose name contains a dash
// would sign the release instead. This hook pins the ad-hoc identity for every nested component
// (frameworks, helpers, dylibs) so local and CI builds are signed the same way.
//
// The bundled Typst (Contents/Resources/pipeline/bin/typst) is foreign code inside the bundle: an
// unsigned or stale signature there breaks the bundle's seal and lets AMFI kill typst on Apple
// Silicon. @electron/osx-sign happens to sign every Mach-O it finds while walking the bundle; the
// hook does not rely on that, but lists typst in `binaries` explicitly and verifies its signature
// after signing.
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Path of the bundled Typst inside a macOS app bundle.
 * @param {string} app path of the .app
 * @returns {string}
 */
export function bundledTypst(app) {
  return join(app, 'Contents', 'Resources', 'pipeline', 'bin', 'typst')
}

/**
 * The signing options electron-builder prepared, with the identity forced to ad hoc and the
 * bundled Typst listed in `binaries` (once).
 * @template {Record<string, unknown>} T
 * @param {T} opts
 * @returns {T & { identity: '-', identityValidation: false, binaries?: string[] }}
 */
export function adHocOptions(opts) {
  const signed = { ...opts, identity: '-', identityValidation: false }
  if (typeof opts.app !== 'string') return signed
  const typst = bundledTypst(opts.app)
  const binaries = Array.isArray(opts.binaries) ? opts.binaries : []
  return { ...signed, binaries: binaries.includes(typst) ? binaries : [...binaries, typst] }
}

/**
 * Runs `task` up to `attempts` times (default 3), waiting `delayMs` × attempt in between.
 * codesign on CI runners fails now and then (timeouts, "resource busy"). Rethrows the last
 * error.
 * @template T
 * @param {() => Promise<T>} task
 * @param {{ attempts?: number, delayMs?: number, log?: (message: string) => void }} [o]
 * @returns {Promise<T>}
 */
export async function withRetry(task, o = {}) {
  const attempts = o.attempts ?? 3
  const delayMs = o.delayMs ?? 2000
  const log = o.log ?? ((message) => console.warn(message))
  for (let attempt = 1; ; attempt++) {
    try {
      return await task()
    } catch (err) {
      if (attempt >= attempts) throw err
      const reason = err instanceof Error ? err.message : String(err)
      log(`codesign attempt ${attempt}/${attempts} failed (${reason}); retrying`)
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt))
    }
  }
}

/**
 * @param {Record<string, unknown>} opts
 * @returns {Promise<void>}
 */
export default async function sign(opts) {
  // @electron/osx-sign is what electron-builder signs with (also an explicit devDependency).
  const { signAsync } = createRequire(import.meta.url)('@electron/osx-sign')
  const signed = adHocOptions(opts)
  await withRetry(() => signAsync(signed))
  if (typeof signed.app === 'string') {
    const typst = bundledTypst(signed.app)
    try {
      await promisify(execFile)('codesign', ['--verify', '--strict', typst])
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`Gebündeltes Typst ist nicht gültig signiert: ${typst} (${reason})`)
    }
  }
}
