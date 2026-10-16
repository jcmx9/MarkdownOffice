// Fetches the pinned pipeline assets (Typst per target, fonts, Typst packages, template sets)
// into build/pipeline-assets/ and verifies every download against its SHA-256 pin from
// scripts/pipeline-assets.json. electron-builder maps the result into the packaged app
// (electron-builder.yml `extraResources`). Not shipped: `files` only packs out/.
//
// The licence texts of everything redistributed land in build/pipeline-assets/licenses/
// (shipped as <resources>/pipeline/licenses/): typst/ (LICENSE and NOTICE from the release
// archive), fonts/ (from the font archive, or a separately pinned download for fonts without
// one) and packages/<name>/ (from the package archive).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * @typedef {{ url: string, sha256: string, bin: string }} TypstTarget
 * @typedef {{ file: string, extract?: string, url?: string, sha256?: string }} FontLicense
 *   `extract`: path (suffix) inside the font archive; else `url` + `sha256`
 * @typedef {{ url: string, sha256: string, extract?: string[], file?: string,
 *   license: FontLicense }} FontEntry
 * @typedef {{ name: string, version: string, sha256: string, license: string }} PackageEntry
 * @typedef {{ name: string, repo: string, tag: string, sha256: string }} SetEntry
 * @typedef {{
 *   typst: { version: string, licenses: string[], targets: Record<string, TypstTarget> },
 *   fonts: FontEntry[], packages: PackageEntry[], sets: SetEntry[]
 * }} Manifest
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/**
 * Folder name of a target below the output dir. It matches electron-builder's
 * `${os}-${arch}` macros (mac / win / linux, x64 / arm64), see electron-builder.yml.
 * @param {string} target e.g. `darwin-arm64`, `win32-x64`
 * @returns {string}
 */
export function folderName(target) {
  return target.replace(/^darwin-/, 'mac-').replace(/^win32-/, 'win-')
}

/** @returns {string} `<process.platform>-<process.arch>` */
export function hostTarget() {
  return `${process.platform}-${process.arch}`
}

/** @param {string} url @returns {Promise<Uint8Array>} */
async function defaultDownload(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** @param {Uint8Array} bytes @returns {string} */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * Downloads `url` and checks it against `expected`.
 * @param {(url: string) => Promise<Uint8Array>} download
 * @param {string} url
 * @param {string} expected
 * @returns {Promise<Uint8Array>}
 */
async function fetchVerified(download, url, expected) {
  /** @type {Uint8Array} */
  let bytes
  try {
    bytes = await download(url)
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err)
    throw new Error(`Download fehlgeschlagen: ${url} (${cause})`)
  }
  if (sha256(bytes) !== expected) throw new Error(`Prüfsumme falsch: ${url}`)
  return bytes
}

/**
 * Unpacks an archive with the system `tar` (bsdtar reads .zip on macOS and Windows 10+).
 * GNU tar on Linux cannot, so .zip falls back to `unzip`.
 * @param {Uint8Array} bytes
 * @param {string} name file name (decides the format)
 * @param {string} dest existing, empty directory
 * @returns {void}
 */
function extractArchive(bytes, name, dest) {
  const archive = join(dest, '..', `archive-${basename(dest)}${extname(name) || '.bin'}`)
  writeFileSync(archive, bytes)
  try {
    try {
      execFileSync('tar', ['-xf', archive, '-C', dest], { stdio: 'pipe' })
    } catch (err) {
      try {
        if (!name.endsWith('.zip')) throw err
        execFileSync('unzip', ['-q', '-o', archive, '-d', dest], { stdio: 'pipe' })
      } catch (inner) {
        const cause = inner instanceof Error ? inner.message : String(inner)
        throw new Error(`Entpacken fehlgeschlagen: ${name} (${cause.split('\n')[0]})`)
      }
    }
  } finally {
    rmSync(archive, { force: true })
  }
}

/**
 * All files below `dir`, as paths relative to it using `/`.
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {string[]}
 */
function listFiles(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  )
}

/**
 * Copies the licence file `rel` (relative to outDir) from `src`, replacing an older copy.
 * @param {string} src
 * @param {string} outDir
 * @param {string} rel
 * @returns {string} rel
 */
function placeLicense(src, outDir, rel) {
  const dest = join(outDir, rel)
  mkdirSync(dirname(dest), { recursive: true })
  rmSync(dest, { force: true })
  copyFileSync(src, dest)
  return rel
}

/**
 * Replaces `final` with `staged` (rename on the same file system).
 * @param {string} staged
 * @param {string} final
 * @returns {void}
 */
function swapIn(staged, final) {
  mkdirSync(dirname(final), { recursive: true })
  rmSync(final, { recursive: true, force: true })
  renameSync(staged, final)
}

/**
 * Fetches everything the manifest pins for `target` into `outDir`.
 * Skips a component whose stamp matches its pin and whose files still exist.
 * @param {{
 *   manifest: Manifest,
 *   target: string | string[],
 *   outDir: string,
 *   download?: (url: string) => Promise<Uint8Array>,
 *   log?: (message: string) => void,
 *   env?: Record<string, string | undefined>,
 * }} o
 * @returns {Promise<void>}
 */
export async function fetchAssets(o) {
  const { manifest, outDir } = o
  const download = o.download ?? defaultDownload
  const log = o.log ?? ((m) => console.log(m))
  const env = o.env ?? process.env
  const targets = Array.isArray(o.target) ? o.target : [o.target]

  for (const target of targets) {
    if (!manifest.typst.targets[target]) throw new Error(`Kein Typst für ${target}`)
  }

  mkdirSync(outDir, { recursive: true })
  const tmpRoot = mkdtempSync(join(outDir, '.tmp-'))
  const stampDir = join(outDir, '.stamps')
  mkdirSync(stampDir, { recursive: true })

  /**
   * Runs `build` unless the stamp for `id` equals `pin` and all `files` exist.
   * `build` returns the files it produced (relative to outDir).
   * @param {string} id
   * @param {string} pin
   * @param {string[]} files outputs that must exist besides the stamp's own list
   * @param {() => Promise<string[]>} build
   * @param {string} label
   */
  async function component(id, pin, files, build, label) {
    const stampFile = join(stampDir, `${id}.json`)
    if (existsSync(stampFile)) {
      /** @type {{ pin: string, files: string[] }} */
      const stamp = JSON.parse(readFileSync(stampFile, 'utf8'))
      // `files` too: outputs added later (licence texts) refresh an older stamp.
      if (
        stamp.pin === pin &&
        [...stamp.files, ...files].every((f) => existsSync(join(outDir, f)))
      ) {
        log(`✓ ${label} bereits vorhanden`)
        return
      }
    }
    log(`→ ${label}`)
    const produced = await build()
    writeFileSync(stampFile, JSON.stringify({ pin, files: produced.length ? produced : files }))
  }

  /** @returns {string} fresh empty directory inside tmpRoot */
  const scratch = () => mkdtempSync(join(tmpRoot, 'w-'))

  try {
    for (const target of targets) {
      const entry = /** @type {TypstTarget} */ (manifest.typst.targets[target])
      const folder = folderName(target)
      const binName = basename(entry.bin)
      const licenses = manifest.typst.licenses.map((l) => `licenses/typst/${l}`)
      await component(
        `typst-${folder}`,
        entry.sha256,
        licenses,
        async () => {
          const bytes = await fetchVerified(download, entry.url, entry.sha256)
          const dir = scratch()
          extractArchive(bytes, basename(entry.url), dir)
          const staged = scratch()
          copyFileSync(join(dir, entry.bin), join(staged, binName))
          chmodSync(join(staged, binName), 0o755)
          // LICENSE and NOTICE sit next to the binary in every Typst release archive.
          for (const l of manifest.typst.licenses) {
            const src = join(dir, dirname(entry.bin), l)
            if (!existsSync(src)) throw new Error(`Lizenz fehlt im Archiv: ${l} (${entry.url})`)
            placeLicense(src, outDir, `licenses/typst/${l}`)
          }
          swapIn(staged, join(outDir, folder))
          return [`${folder}/${binName}`, ...licenses]
        },
        `Typst ${manifest.typst.version} (${target})`,
      )
    }

    const fontsDir = join(outDir, 'fonts')
    for (const [i, font] of manifest.fonts.entries()) {
      const license = font.license
      if (!license?.file) throw new Error(`Font ohne Lizenz im Manifest: ${font.url}`)
      const licenseRel = `licenses/fonts/${license.file}`
      // A separately downloaded licence is part of the pin: a new licence pin refreshes it.
      const pin = license.sha256 ? `${font.sha256}+${license.sha256}` : font.sha256
      await component(
        `fonts-${i}`,
        pin,
        [licenseRel],
        async () => {
          const bytes = await fetchVerified(download, font.url, font.sha256)
          const staged = scratch()
          /** @type {string[]} */
          const names = []
          /** @type {string[]} */
          let all = []
          let dir = ''
          if (font.file) {
            writeFileSync(join(staged, font.file), bytes)
            names.push(font.file)
          } else {
            dir = scratch()
            extractArchive(bytes, basename(font.url), dir)
            all = listFiles(dir)
            for (const want of font.extract ?? []) {
              const hit = all.find((f) => f === want || f.endsWith(`/${want}`))
              if (!hit) throw new Error(`Font fehlt im Archiv: ${want} (${font.url})`)
              copyFileSync(join(dir, hit), join(staged, basename(want)))
              names.push(basename(want))
            }
          }
          const licenseSrc = join(staged, '.license')
          if (license.extract) {
            const want = license.extract
            const hit = all.find((f) => f === want || f.endsWith(`/${want}`))
            if (!hit) throw new Error(`Lizenz fehlt im Archiv: ${want} (${font.url})`)
            copyFileSync(join(dir, hit), licenseSrc)
          } else {
            if (!license.url || !license.sha256) {
              throw new Error(`Lizenz ohne extract oder url+sha256: ${license.file}`)
            }
            writeFileSync(licenseSrc, await fetchVerified(download, license.url, license.sha256))
          }
          placeLicense(licenseSrc, outDir, licenseRel)
          mkdirSync(fontsDir, { recursive: true })
          for (const n of names) {
            rmSync(join(fontsDir, n), { force: true })
            renameSync(join(staged, n), join(fontsDir, n))
          }
          return [...names.map((n) => `fonts/${n}`), licenseRel]
        },
        `Font ${basename(decodeURIComponent(font.url))}`,
      )
    }

    for (const pkg of manifest.packages) {
      const url = `https://packages.typst.org/preview/${pkg.name}-${pkg.version}.tar.gz`
      if (!pkg.license) throw new Error(`Paket ohne Lizenz im Manifest: ${pkg.name}`)
      const licenseRel = `licenses/packages/${pkg.name}/${pkg.license}`
      await component(
        `pkg-${pkg.name}`,
        pkg.sha256,
        [licenseRel],
        async () => {
          const bytes = await fetchVerified(download, url, pkg.sha256)
          const staged = scratch()
          extractArchive(bytes, `${pkg.name}.tar.gz`, staged)
          const src = join(staged, pkg.license)
          if (!existsSync(src)) throw new Error(`Lizenz fehlt im Paket: ${pkg.license} (${url})`)
          placeLicense(src, outDir, licenseRel)
          swapIn(staged, join(outDir, 'vendor', pkg.name))
          return [`vendor/${pkg.name}/typst.toml`, licenseRel]
        },
        `${pkg.name} ${pkg.version}`,
      )
    }

    for (const set of manifest.sets) {
      const overrideDir = env[`MDO_SET_${set.name.toUpperCase()}_DIR`]
      const final = join(outDir, 'sets', set.name)
      if (overrideDir) {
        // Dev override: tracked files of the pinned tag from a local checkout, always refreshed.
        log(`→ Set ${set.name} ${set.tag} aus ${overrideDir}`)
        const staged = scratch()
        const tar = join(tmpRoot, `${set.name}.tar`)
        try {
          execFileSync('git', ['-C', overrideDir, 'archive', '--format=tar', '-o', tar, set.tag], {
            stdio: 'pipe',
          })
        } catch (err) {
          const cause = err instanceof Error ? err.message : String(err)
          throw new Error(
            `git archive fehlgeschlagen: ${overrideDir} @ ${set.tag} (${cause.split('\n')[0]})`,
          )
        }
        execFileSync('tar', ['-xf', tar, '-C', staged], { stdio: 'pipe' })
        swapIn(staged, final)
        continue
      }
      if (!set.sha256) {
        throw new Error(
          `Set ${set.name}: keine sha256 im Manifest. Das Set ist noch nicht veröffentlicht – ` +
            `lokal mit MDO_SET_${set.name.toUpperCase()}_DIR=<Pfad zum Set-Repo> bauen.`,
        )
      }
      await component(
        `set-${set.name}`,
        set.sha256,
        [],
        async () => {
          const url = `https://github.com/${set.repo}/archive/refs/tags/${set.tag}.tar.gz`
          const bytes = await fetchVerified(download, url, set.sha256)
          const dir = scratch()
          extractArchive(bytes, `${set.name}.tar.gz`, dir)
          // GitHub archives carry one top-level folder; use its content.
          const top = readdirSync(dir)
          const first = top[0]
          const src =
            top.length === 1 && first && statSync(join(dir, first)).isDirectory()
              ? join(dir, first)
              : dir
          swapIn(src, final)
          return [`sets/${set.name}`]
        },
        `Set ${set.name} ${set.tag}`,
      )
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
}

/**
 * Targets to fetch when none is given: the host, and both Mac architectures on macOS because
 * `npm run dist` builds arm64 and x64 there.
 * @returns {string[]}
 */
function defaultTargets() {
  return process.platform === 'darwin' ? ['darwin-arm64', 'darwin-x64'] : [hostTarget()]
}

/** @param {string[]} argv @returns {string[]} */
function targetsFromArgs(argv) {
  const found = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target' && argv[i + 1]) found.push(/** @type {string} */ (argv[++i]))
  }
  return found.length ? found : defaultTargets()
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  /** @type {Manifest} */
  const manifest = JSON.parse(readFileSync(join(here, 'pipeline-assets.json'), 'utf8'))
  fetchAssets({
    manifest,
    target: targetsFromArgs(process.argv.slice(2)),
    outDir: join(root, 'build', 'pipeline-assets'),
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
