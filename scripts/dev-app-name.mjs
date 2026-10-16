#!/usr/bin/env node
// Development only: macOS takes the menu bar / Dock / Cmd-Tab name from the Info.plist of the
// Electron binary, which says "Electron". Patch it to the productName. The bundle and the binary
// are not renamed, so electron's path.txt stays valid. The Info.plist hash is bound into the
// bundle's code signature, so the bundle is re-signed ad hoc afterwards (keychain/TCC-bound
// features and `codesign --verify` then see a valid, if ad-hoc, signature). Never fails the
// install.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, utimesSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUTIL = '/usr/bin/plutil'
const CODESIGN = '/usr/bin/codesign'
const KEYS = ['CFBundleName', 'CFBundleDisplayName']

/**
 * Argument lists for plutil, one per plist key.
 * @param {string} name
 * @param {string} plistPath
 * @returns {string[][]}
 */
export function plutilArgs(name, plistPath) {
  return KEYS.map((key) => ['-replace', key, '-string', name, plistPath])
}

/**
 * Argument list for an ad-hoc re-sign of the patched bundle.
 * @param {string} bundlePath
 * @returns {string[]}
 */
export function codesignArgs(bundlePath) {
  return ['--force', '--sign', '-', bundlePath]
}

/**
 * Patch the app name into an Info.plist, re-sign the bundle ad hoc (a failure is ignored: the
 * unsigned-looking dev bundle still launches locally) and touch it so LaunchServices refreshes.
 * @param {string} name
 * @param {string} plistPath
 * @param {string} bundlePath
 */
export function applyAppName(name, plistPath, bundlePath) {
  for (const args of plutilArgs(name, plistPath)) execFileSync(PLUTIL, args, { stdio: 'ignore' })
  try {
    execFileSync(CODESIGN, codesignArgs(bundlePath), { stdio: 'ignore' })
  } catch {
    console.log('dev-app-name: ad-hoc re-sign failed, the dev app still starts locally')
  }
  const now = new Date()
  utimesSync(bundlePath, now, now)
}

function main() {
  if (process.platform !== 'darwin') return
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const bundle = join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
  const plist = join(bundle, 'Contents', 'Info.plist')
  if (!existsSync(plist)) {
    console.log('dev-app-name: Electron.app not found, skipping')
    return
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const name = typeof pkg.productName === 'string' && pkg.productName ? pkg.productName : pkg.name
  applyAppName(name, plist, bundle)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    // A cosmetic dev nicety must never break npm install / npm ci.
    console.log(`dev-app-name: skipped (${error instanceof Error ? error.message : error})`)
  }
}
