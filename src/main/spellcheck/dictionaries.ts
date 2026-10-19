import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { BUILTIN_DICTIONARIES, CODE_RE, type DictionaryInfo, mergeTables } from './languages'

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

/** A fresh empty state per call: callers mutate `files`, so it must never be shared. */
const empty = (): DictionaryState => ({ version: null, files: {}, lastCheck: 0, declined: [] })

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
    return empty()
  }
}

/** Per-folder queue tail: state operations (read-modify-write) run strictly one after another. */
const locks = new Map<string, Promise<unknown>>()

/**
 * Serializes every operation that reads and then writes the dictionary folder or its state
 * (update check, download, decline, bundled install). Without it a slow check would write
 * back a stale state and drop a decline or a download recorded in the meantime.
 */
export function withStateLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(dir) ?? Promise.resolve()).then(fn, fn)
  const tail = run.catch(() => undefined)
  locks.set(dir, tail)
  void tail.then(() => {
    if (locks.get(dir) === tail) locks.delete(dir)
  })
  return run
}

/** Unique temp name per operation, so parallel writers never share (and rename away) a file. */
export const tempName = (name: string): string => `${name}.${randomBytes(6).toString('hex')}.tmp`

/** Reads, changes and writes the state under the lock (for small edits like „declined“). */
export function updateState(
  dir: string,
  change: (s: DictionaryState) => DictionaryState,
): Promise<void> {
  return withStateLock(dir, async () => writeState(dir, change(await readState(dir))))
}

/** Writes the state atomically (temp file + rename), so a crash never leaves half a file. */
export async function writeState(dir: string, s: DictionaryState): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, tempName(STATE_FILE))
  await fs.writeFile(tmp, JSON.stringify(s, null, 2))
  await fs.rename(tmp, join(dir, STATE_FILE))
}

/** Electron asks for lowercase names (`de-de-3-0.bdic`): every name comparison ignores case. */
const isBdic = (file: string): boolean => /\.bdic$/i.test(file)

/**
 * The only way a dictionary file name from the network (SHA256SUMS, release assets,
 * dictionaries.json) becomes a path: a plain `*.bdic` base name, never a separator or `..`, so
 * a crafted name can never write outside the dictionary folder. Throws on anything else.
 */
export function dictionaryPath(dir: string, name: string): string {
  if (
    basename(name) !== name ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    !isBdic(name)
  )
    throw new Error(`Unzulässiger Wörterbuch-Dateiname: ${name}`)
  return join(dir, name)
}

/** Whether `name` passes dictionaryPath (for filtering instead of throwing). */
export const isSafeDictionaryName = (name: string): boolean => {
  try {
    dictionaryPath('.', name)
    return true
  } catch {
    return false
  }
}

/** The release's dictionaries.json, cached next to the state for offline starts. */
export const TABLE_FILE = 'mdo-dictionary-table.json'

/**
 * Validates a dictionaries.json (`{ code, file, name }[]`): entries with an unusable code or an
 * unsafe file name are dropped, so a broken release can never break checking or escape the
 * folder. The code pattern matches what the renderer may send for a download.
 */
export function parseTable(json: unknown): DictionaryInfo[] {
  if (!Array.isArray(json)) return []
  const out: DictionaryInfo[] = []
  for (const e of json as Partial<Record<keyof DictionaryInfo, unknown>>[]) {
    if (!e || typeof e !== 'object') continue
    const { code, file, name } = e
    if (typeof code !== 'string' || !CODE_RE.test(code)) continue
    if (typeof file !== 'string' || !isSafeDictionaryName(file)) continue
    out.push({ code, file, name: typeof name === 'string' ? name : code })
  }
  return out
}

/** Writes the release table atomically (temp file + rename). */
export async function writeTable(dir: string, table: readonly DictionaryInfo[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, tempName(TABLE_FILE))
  await fs.writeFile(tmp, JSON.stringify(table, null, 2))
  await fs.rename(tmp, join(dir, TABLE_FILE))
}

/** The cached release table merged with the built-in one; no cache → the built-in table. */
export async function offeredTable(dir: string): Promise<DictionaryInfo[]> {
  const raw = await fs.readFile(join(dir, TABLE_FILE), 'utf8').catch(() => null)
  let release: DictionaryInfo[] | null = null
  try {
    release = raw === null ? null : parseTable(JSON.parse(raw))
  } catch {
    release = null // corrupt cache: fall back to the verified built-in table
  }
  return mergeTables(release)
}

/**
 * Every dictionary whose file Markdown Office recognises: the offered ones plus the built-in
 * ones (the bundled de-DE/en-US stay known even if a release stopped offering them).
 */
export async function knownTable(dir: string): Promise<DictionaryInfo[]> {
  const offered = await offeredTable(dir)
  return [
    ...offered,
    ...BUILTIN_DICTIONARIES.filter((b) => !offered.some((o) => o.code === b.code)),
  ]
}

/**
 * The code of a dictionary file via the table, case-insensitively (`nl-NL-3-0.bdic` → `nl`,
 * `de-de-3-0.bdic` → `de-DE`); null for a file the table does not know.
 */
export const codeOf = (file: string, table: readonly DictionaryInfo[]): string | null =>
  table.find((d) => d.file.toLowerCase() === file.toLowerCase())?.code ?? null

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/** Sorted, de-duplicated codes of the known .bdic files in `dir`; a missing folder has none. */
export async function installedCodes(dir: string): Promise<string[]> {
  const table = await knownTable(dir)
  try {
    const codes = (await fs.readdir(dir))
      .filter(isBdic)
      .map((f) => codeOf(f, table))
      .filter((c): c is string => c !== null)
    return [...new Set(codes)].sort()
  } catch {
    return []
  }
}

/** Suffix of a verified dictionary waiting for the next start (see activatePending). */
export const PENDING = '.pending'

/**
 * Moves verified `<file>.pending` dictionaries into place. Chromium keeps an active .bdic open
 * (Windows refuses a rename over it, EPERM/EACCES) and does not reload a language whose list
 * is unchanged, so updates are staged and activated here, at start, before any window loads.
 * A pending file must match the hash the update recorded in the state; anything else is
 * deleted. A failed rename keeps the pending file for the next start.
 */
async function activatePending(dir: string): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const pending = names.filter((n) => n.toLowerCase().endsWith(`.bdic${PENDING}`))
  if (pending.length === 0) return
  const state = await readState(dir)
  const hashOf = (file: string) =>
    Object.entries(state.files).find(([f]) => f.toLowerCase() === file.toLowerCase())?.[1]
  for (const name of pending) {
    const src = join(dir, name)
    const file = name.slice(0, -PENDING.length)
    try {
      const dest = dictionaryPath(dir, file)
      const bytes = await fs.readFile(src)
      if (hashOf(file) !== sha256(bytes)) {
        await fs.unlink(src)
        continue
      }
      await fs.rename(src, dest)
    } catch (err) {
      console.warn(`spellcheck: ${name} could not be activated`, err)
    }
  }
}

/**
 * Runs at start, before a window loads (under the state lock): first activates staged updates
 * (activatePending), then copies every bundled .bdic into `targetDir` (under its canonical name)
 * when it is missing or differs in size or SHA-256; files the update check installed are left
 * alone. Writes go through a temp file and a rename, so Electron never reads a half-written
 * dictionary. `bundledDir` null (macOS, dev without assets) only activates. Returns the codes
 * installed in `targetDir` afterwards.
 */
export function installBundledDictionaries(
  bundledDir: string | null,
  targetDir: string,
): Promise<string[]> {
  return withStateLock(targetDir, async () => {
    await activatePending(targetDir)
    return bundledDir ? installBundled(bundledDir, targetDir) : installedCodes(targetDir)
  })
}

async function installBundled(bundledDir: string, targetDir: string): Promise<string[]> {
  await fs.mkdir(targetDir, { recursive: true })
  const state = await readState(targetDir)
  const updated = new Set(Object.keys(state.files).map((f) => f.toLowerCase()))
  for (const file of (await fs.readdir(bundledDir)).filter(isBdic)) {
    if (updated.has(file.toLowerCase())) continue // installed by an update: newer than bundled
    const src = await fs.readFile(join(bundledDir, file))
    const dest = join(targetDir, file)
    const current = await fs.readFile(dest).catch(() => null)
    if (current && current.length === src.length && sha256(current) === sha256(src)) continue
    const tmp = join(targetDir, tempName(file))
    await fs.writeFile(tmp, src)
    await fs.rename(tmp, dest)
  }
  return installedCodes(targetDir)
}
