// electron-builder `afterPack` hook (build-time only). electron-builder merely warns when an
// extraResources source folder is missing, so an incomplete asset fetch would ship an app
// without Typst. This hook fails the build instead. It also requires the licence texts of the
// redistributed Typst, fonts and Typst packages (<resources>/pipeline/licenses/).
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Throws a German error naming the first missing item of the packed resources.
 * @param {{ resourcesDir: string, platform: string, fonts: string[], licenses: string[] }} o
 *   platform is the node platform name (`darwin`, `win32`, `linux`); licenses are paths
 *   relative to pipeline/licenses
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
    ...['cmarker', 'mitex', 'mmdr'].map((p) => join('pipeline', 'vendor', p)),
    join('sets', 'memo', 'memo.typ'),
    join('pipeline', win ? 'convert.ps1' : 'build.sh'),
    join('pipeline', 'cli.js'),
    ...o.licenses.map((l) => join('pipeline', 'licenses', ...l.split('/'))),
  ]
  for (const rel of required) if (!existsSync(join(resourcesDir, rel))) fail(rel)
}

/**
 * @typedef {{
 *   typst: { licenses: string[] },
 *   fonts: { file?: string, extract?: string[], license: { file: string } }[],
 *   packages: { name: string, license: string }[]
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
    ...manifest.packages.map((p) => `packages/${p.name}/${p.license}`),
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
  })
}
