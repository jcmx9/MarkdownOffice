import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/**
 * Electron's Hunspell dictionaries (Windows/Linux) live in <userData>/Dictionaries/ under the
 * file names Chromium expects. Markdown Office puts its bundled files there before checking
 * starts, so Electron never downloads them (offline, and never from Google's CDN). A file the
 * update check installed (listed in mdo-dictionaries.json) is newer and is kept.
 */
export const STATE_FILE = 'mdo-dictionaries.json'

export interface DictionaryState {
  /** Version of the MarkdownOffice-dictionaries release the listed files came from. */
  version: string | null
  /** File name → SHA-256 of files installed by the update check. */
  files: Record<string, string>
  /** Epoch ms of the last update check. */
  lastCheck: number
  /** Language codes whose „fehlt – laden?“ notice the user declined. */
  declined: string[]
}

const EMPTY: DictionaryState = { version: null, files: {}, lastCheck: 0, declined: [] }

/** Missing or corrupt state file → empty state (bundled files may then be installed). */
export async function readState(dir: string): Promise<DictionaryState> {
  try {
    const o = JSON.parse(
      await fs.readFile(join(dir, STATE_FILE), 'utf8'),
    ) as Partial<DictionaryState>
    return {
      version: typeof o.version === 'string' ? o.version : null,
      files: o.files && typeof o.files === 'object' ? (o.files as Record<string, string>) : {},
      lastCheck: typeof o.lastCheck === 'number' ? o.lastCheck : 0,
      declined: Array.isArray(o.declined)
        ? o.declined.filter((c): c is string => typeof c === 'string')
        : [],
    }
  } catch {
    return { ...EMPTY }
  }
}

/** Writes the state atomically (temp file + rename), so a crash never leaves half a file. */
export async function writeState(dir: string, s: DictionaryState): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, `${STATE_FILE}.tmp`)
  await fs.writeFile(tmp, JSON.stringify(s, null, 2))
  await fs.rename(tmp, join(dir, STATE_FILE))
}

/** Electron asks for lowercase names (`de-de-3-0.bdic`): every name comparison ignores case. */
const isBdic = (file: string): boolean => /\.bdic$/i.test(file)

/**
 * `de-DE-3-0.bdic` → `de-DE`; `nl-3-0.bdic` → `nl`. The code is normalised (language lower,
 * region upper), so a lowercase file name yields the same code as the canonical one.
 */
export const codeOf = (file: string): string => {
  const [lang = '', ...rest] = file
    .replace(/\.bdic$/i, '')
    .replace(/-\d+(-\d+)*$/, '')
    .split('-')
  return [lang.toLowerCase(), ...rest.map((r) => r.toUpperCase())].join('-')
}

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/** Sorted, de-duplicated codes of the .bdic files in `dir`; a missing folder has none. */
export async function installedCodes(dir: string): Promise<string[]> {
  try {
    return [...new Set((await fs.readdir(dir)).filter(isBdic).map(codeOf))].sort()
  } catch {
    return []
  }
}

/**
 * Copies every bundled .bdic into `targetDir` (under its canonical name) when it is missing
 * or differs in size or SHA-256; files the update check installed are left alone. Writes go
 * through a temp file and a rename, so Electron never reads a half-written dictionary.
 * Returns the codes installed in `targetDir` afterwards.
 */
export async function installBundledDictionaries(
  bundledDir: string,
  targetDir: string,
): Promise<string[]> {
  await fs.mkdir(targetDir, { recursive: true })
  const state = await readState(targetDir)
  const updated = new Set(Object.keys(state.files).map((f) => f.toLowerCase()))
  for (const file of (await fs.readdir(bundledDir)).filter(isBdic)) {
    if (updated.has(file.toLowerCase())) continue // installed by an update: newer than bundled
    const src = await fs.readFile(join(bundledDir, file))
    const dest = join(targetDir, file)
    const current = await fs.readFile(dest).catch(() => null)
    if (current && current.length === src.length && sha256(current) === sha256(src)) continue
    const tmp = `${dest}.tmp`
    await fs.writeFile(tmp, src)
    await fs.rename(tmp, dest)
  }
  return installedCodes(targetDir)
}
