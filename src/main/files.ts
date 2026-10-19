import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Eol, ExternalChange, NoteFile } from '../shared/types'

const BOM = '\uFEFF'
/** Codes that are often transient on Windows (AV scanners, sync clients, delete pending). */
export const RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES'])
const MAX_RETRIES = 5
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export class NotUtf8Error extends Error {
  constructor(path: string) {
    super(
      `„${basename(path)}“ ist kein gültiges UTF-8 und wird nicht geöffnet, damit die Datei unverändert bleibt.`,
    )
    this.name = 'NotUtf8Error'
  }
}

export interface AtomicDeps {
  rename(from: string, to: string): Promise<void>
  sleep(ms: number): Promise<void>
}

const defaultDeps: AtomicDeps = {
  rename: (from, to) => fs.rename(from, to),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/**
 * The one spelling of a path that the allowlist, the watcher, tab identity and the session use.
 * `fs.promises.realpath` is the native realpath: it resolves symlinks and junctions, Windows 8.3
 * names and, on macOS/Windows, the file system's stored case. A symlinked file resolves to its
 * target. For a missing path (a new note, maybe in a folder not created yet) the nearest
 * existing ancestor is canonicalised and the missing rest appended unchanged.
 */
export async function canonicalPath(path: string): Promise<string> {
  const abs = resolve(path)
  const rest: string[] = []
  for (let current = abs; ; ) {
    try {
      return join(await fs.realpath(current), ...rest)
    } catch {
      const parent = dirname(current)
      if (parent === current) return abs
      rest.unshift(basename(current))
      current = parent
    }
  }
}

/** Canonicalises and drops later duplicates, keeping the first occurrence's order. */
export async function canonicalPaths(paths: readonly string[]): Promise<string[]> {
  return [...new Set(await Promise.all(paths.map(canonicalPath)))]
}

export function timestampName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  const time = `${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  return `${date}_${time}.md`
}

export async function newNotePath(
  dir: string,
  now: Date,
  reserved: ReadonlySet<string>,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const name = timestampName(now)
  const stem = name.slice(0, -'.md'.length)
  for (let i = 1; ; i++) {
    const candidate = join(dir, i === 1 ? name : `${stem}_${i}.md`)
    if (!reserved.has(candidate) && !(await exists(candidate))) return candidate
  }
}

export function detectEol(text: string): Eol {
  const cr = text.split('\r').length - 1
  if (cr === 0) return '\n'
  const lf = text.split('\n').length - 1
  const crlf = text.split('\r\n').length - 1
  return crlf === lf && crlf === cr ? '\r\n' : 'mixed'
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function noteBytes(text: string, bom: boolean): Buffer {
  return Buffer.from((bom ? BOM : '') + text, 'utf8')
}

export async function readNote(path: string): Promise<NoteFile> {
  return decodeNote(path, await fs.readFile(path))
}

/** Decodes bytes read from `path`; throws `NotUtf8Error` for invalid UTF-8. */
export function decodeNote(path: string, bytes: Uint8Array): NoteFile {
  let raw: string
  try {
    raw = decoder.decode(bytes)
  } catch {
    throw new NotUtf8Error(path)
  }
  const bom = raw.startsWith(BOM)
  const text = bom ? raw.slice(1) : raw
  return { path, text, bom, eol: detectEol(text), hash: hashBytes(bytes) }
}

/**
 * Writes via temp file + fsync + rename; never leaves a half-written target.
 * `beforeRename` runs after the temp file is complete and right before the rename, so a check
 * of the target there is as close to the replace as possible; if it throws, nothing is replaced.
 */
export async function writeFileAtomic(
  path: string,
  data: Uint8Array,
  deps: AtomicDeps = defaultDeps,
  beforeRename?: () => Promise<void>,
): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  const mode = await fs.stat(path).then(
    (s) => s.mode & 0o777,
    () => undefined,
  )
  const handle = await fs.open(tmp, 'wx', mode)
  try {
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
  } catch (err) {
    await handle.close().catch(() => undefined)
    await fs.rm(tmp, { force: true })
    throw err
  }
  try {
    await beforeRename?.()
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.rename(tmp, path)
        return
      } catch (err) {
        const code = errorCode(err)
        if (attempt >= MAX_RETRIES || code === undefined || !RETRY_CODES.has(code)) throw err
        await deps.sleep(50 * 2 ** attempt)
      }
    }
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

async function realTarget(path: string): Promise<string> {
  try {
    return await fs.realpath(path)
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return path
    throw err
  }
}

export async function writeNoteBytes(
  path: string,
  bytes: Uint8Array,
  beforeRename?: () => Promise<void>,
): Promise<void> {
  await writeFileAtomic(await realTarget(path), bytes, defaultDeps, beforeRename)
}

/** Reads once more after a short pause when a lock (AV scanner, sync client) is likely. */
async function readRetryingOnce(
  path: string,
  read: (path: string) => Promise<Buffer>,
  sleep: AtomicDeps['sleep'],
): Promise<Buffer> {
  try {
    return await read(path)
  } catch (err) {
    const code = errorCode(err)
    if (code === undefined || !RETRY_CODES.has(code)) throw err
    await sleep(100)
    return read(path)
  }
}

/** What is on disk now, if it is not the content a save was based on. */
export interface DiskConflict {
  change: ExternalChange
  /** Hash of the bytes found; absent when the file is missing. */
  hash?: string
}

/**
 * Compares the bytes at `path` with the hash the caller's content is based on (`null`: a new
 * note whose file must not exist yet). Returns null when they match or `isOwn` recognises the
 * bytes as the app's own; else the disk state as an external change. A missing file with a base
 * counts as deleted. Read errors other than ENOENT are thrown: nothing is written over bytes
 * that could not be compared.
 */
export async function diskConflict(
  path: string,
  base: string | null,
  isOwn: (hash: string) => boolean,
  deps: {
    read: (path: string) => Promise<Buffer>
    sleep: AtomicDeps['sleep']
  } = { read: (p) => fs.readFile(p), sleep: defaultDeps.sleep },
): Promise<DiskConflict | null> {
  let bytes: Buffer
  try {
    bytes = await readRetryingOnce(path, deps.read, deps.sleep)
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') throw err
    return base === null ? null : { change: { kind: 'deleted', path } }
  }
  const hash = hashBytes(bytes)
  if (hash === base || isOwn(hash)) return null
  try {
    return { change: { kind: 'changed', note: decodeNote(path, bytes) }, hash }
  } catch (err) {
    if (!(err instanceof NotUtf8Error)) throw err
    return {
      change: { kind: 'unreadable', path, reason: 'encoding', message: err.message },
      hash,
    }
  }
}

export async function writeNote(path: string, text: string, bom: boolean): Promise<string> {
  const bytes = noteBytes(text, bom)
  await writeNoteBytes(path, bytes)
  return hashBytes(bytes)
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in file names
const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'])

export class RenameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenameError'
  }
}

/** A YAML profile opened in a tab („Profil anlegen …“); every other file is a note. */
const YAML_EXT = /\.ya?ml$/i

/**
 * The new file name: `.md` appended unless given. A YAML profile keeps being YAML (its own
 * extension appended unless `.yaml`/`.yml` is given), so renaming it never turns it into a note
 * the pipeline would no longer find as a profile.
 */
export function validateNewName(name: string, from = ''): string {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..' || INVALID_NAME.test(trimmed)) {
    throw new RenameError(`„${name}“ ist kein gültiger Dateiname.`)
  }
  const yaml = YAML_EXT.exec(from)?.[0]
  if (yaml) return YAML_EXT.test(trimmed) ? trimmed : `${trimmed}${yaml}`
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`
}

/** True only when nothing is at `path`; any other lstat error counts as taken. */
async function isFree(path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return false
  } catch (err) {
    return errorCode(err) === 'ENOENT'
  }
}

/** Both paths name the same existing file (same device and inode); false if either is missing. */
export async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fs.stat(a, { bigint: true }), fs.stat(b, { bigint: true })])
    return sa.ino === sb.ino && sa.dev === sb.dev
  } catch {
    return false
  }
}

async function unlinkWithRetry(path: string, sleep: AtomicDeps['sleep']): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.unlink(path)
      return
    } catch (err) {
      const code = errorCode(err)
      if (attempt >= MAX_RETRIES || code === undefined || !RETRY_CODES.has(code)) throw err
      await sleep(50 * 2 ** attempt)
    }
  }
}

/** Renames in the same folder; never replaces another file. */
export async function renameNote(
  from: string,
  newName: string,
  sleep: AtomicDeps['sleep'] = defaultDeps.sleep,
): Promise<string> {
  const name = validateNewName(newName, from)
  const to = join(dirname(from), name)
  if (to === from) return from
  const taken = () => new RenameError(`„${name}“ existiert bereits.`)

  if (to.toLowerCase() === from.toLowerCase()) {
    // Case-only rename: `to` may be the same file on a case-insensitive FS.
    // If sameFile cannot prove identity, refuse.
    if (!(await isFree(to)) && !(await sameFile(from, to))) throw taken()
    await fs.rename(from, to)
    return to
  }
  // A symlink must be renamed as a link. link() would follow it on macOS.
  const isLink = (await fs.lstat(from)).isSymbolicLink()
  if (!isLink) {
    let linked = false
    try {
      // link() fails with EEXIST instead of replacing: an atomic no-clobber rename.
      await fs.link(from, to)
      linked = true
    } catch (err) {
      const code = errorCode(err)
      if (code === 'EEXIST') throw taken()
      if (code === undefined || !LINK_UNSUPPORTED.has(code)) throw err
    }
    if (linked) {
      try {
        await unlinkWithRetry(from, sleep)
      } catch {
        // Roll back so the note does not exist under two names.
        await fs.unlink(to).catch(() => undefined)
        throw new RenameError(
          `„${basename(from)}“ konnte nicht umbenannt werden: Datei ist in Benutzung.`,
        )
      }
      return to
    }
  }
  // Best-effort fallback (check-then-rename, not atomic): used for symlinks and
  // for filesystems without hard links.
  if (!(await isFree(to))) throw taken()
  await fs.rename(from, to)
  return to
}
