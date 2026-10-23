// electron-builder `afterPack` hook (build-time only). electron-builder merely warns when an
// extraResources source folder is missing, so an incomplete asset fetch would ship an app
// without Typst. This hook fails the build instead. It also requires the licence texts of the
// redistributed Typst, fonts, Typst packages and dictionaries (<resources>/pipeline/licenses/),
// every pinned Typst package (store packages in their package-cache layout), and on
// Windows/Linux the bundled Hunspell dictionaries (<resources>/dictionaries/).
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Throws a German error naming the first missing item of the packed resources.
 * @param {{ resourcesDir: string, platform: string, fonts: string[], licenses: string[],
 *   packages: PackPackage[], dictionaries?: string[] }} o
 *   platform is the node platform name (`darwin`, `win32`, `linux`); licenses are paths
 *   relative to pipeline/licenses; dictionaries are .bdic file names, required on Windows/Linux
 *   only (macOS uses the system spellchecker and ships none); packages are the manifest's
 *   package entries
 * @returns {void}
 */
export function checkPackedResources(o) {
  const { resourcesDir, platform } = o
  const win = platform === 'win32'
  /** @param {string} rel */
  const fail = (rel) => {
    throw new Error(`Paket unvollständig: ${join(resourcesDir, rel)} – erst npm run assets`)
  }
  const typst = join('pipeline', 'bin', win ? 'typst.exe' : 'typst')
  if (!existsSync(join(resourcesDir, typst))) fail(typst)
  if (!win) {
    try {
      accessSync(join(resourcesDir, typst), constants.X_OK)
    } catch {
      fail(typst)
    }
  }
  const required = [
    ...o.fonts.map((f) => join('pipeline', 'fonts', f)),
    // Every pinned package must be in the packed app, store packages in their cache layout
    // (build.sh/convert.ps1 pass vendor/packages as --package-cache-path).
    ...o.packages.map((p) =>
      p.store
        ? join('pipeline', 'vendor', 'packages', 'preview', p.name, p.version)
        : join('pipeline', 'vendor', p.name),
    ),
    join('sets', 'memo', 'memo.typ'),
    join('sets', 'din5008a', 'din5008a.typ'),
    join('pipeline', win ? 'convert.ps1' : 'build.sh'),
    join('pipeline', 'cli.js'),
    // The app's own licence text (AGPL-3.0-or-later): it must travel with every copy.
    'LICENSE',
    // Notices for the ported Typst code and the hyphenation patterns of the editor preview.
    'THIRD_PARTY_NOTICES.md',
    ...o.licenses.map((l) => join('pipeline', 'licenses', ...l.split('/'))),
    ...(platform === 'darwin' ? [] : (o.dictionaries ?? []).map((f) => join('dictionaries', f))),
  ]
  for (const rel of required) if (!existsSync(join(resourcesDir, rel))) fail(rel)
}

/**
 * @typedef {{ name: string, version: string, store?: boolean }} PackPackage
 * @typedef {{
 *   typst: { licenses: string[] },
 *   fonts: { file?: string, extract?: string[], license: { file: string } }[],
 *   packages: (PackPackage & { license: string | string[] })[],
 *   dictionaries?: { file: string, license: { file: string } | { file: string }[] }[]
 * }} PackManifest
 */

/** @returns {PackManifest} */
function readManifest() {
  return JSON.parse(readFileSync(join(here, 'pipeline-assets.json'), 'utf8'))
}

/**
 * Font file names the manifest pins.
 * @param {PackManifest} manifest
 * @returns {string[]}
 */
function manifestFonts(manifest) {
  return manifest.fonts.flatMap((f) =>
    f.file ? [f.file] : (f.extract ?? []).map((e) => e.split('/').pop() ?? e),
  )
}

/**
 * Licence files below pipeline/licenses that fetch-pipeline-assets.mjs writes for the manifest.
 * @param {PackManifest} manifest
 * @returns {string[]}
 */
export function manifestLicenses(manifest) {
  return [
    ...manifest.typst.licenses.map((l) => `typst/${l}`),
    ...manifest.fonts.map((f) => `fonts/${f.license.file}`),
    // `license` is one file name or several (LICENSE plus the bundled third-party notices).
    ...manifest.packages.flatMap((p) =>
      (Array.isArray(p.license) ? p.license : [p.license]).map((l) => `packages/${p.name}/${l}`),
    ),
    // Shipped on every OS (the licences folder is common), even where no dictionary ships.
    // `license` is one object or an array of them (e.g. README plus LGPL text).
    ...(manifest.dictionaries ?? []).flatMap((d) =>
      (Array.isArray(d.license) ? d.license : [d.license]).map((l) => `dictionaries/${l.file}`),
    ),
  ]
}

/**
 * @param {{ appOutDir: string, electronPlatformName: string,
 *   packager: { appInfo: { productFilename: string } } }} context
 * @returns {Promise<void>}
 */
export default async function afterPack(context) {
  const platform = context.electronPlatformName
  const resourcesDir =
    platform === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : join(context.appOutDir, 'resources')
  const manifest = readManifest()
  checkPackedResources({
    resourcesDir,
    platform,
    fonts: manifestFonts(manifest),
    licenses: manifestLicenses(manifest),
    packages: manifest.packages,
    dictionaries: (manifest.dictionaries ?? []).map((d) => d.file),
  })
}
