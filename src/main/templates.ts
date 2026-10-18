import { constants } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { headerHint, headerProfile, minimalHeader, SET_NAME_RE } from '../shared/sets'
import type { SetInfo } from '../shared/types'

/** A header file larger than this is not a header (protects the renderer), as for snippets. */
const MAX_BYTES = 64 * 1024
const BOM = '﻿'
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
// O_NONBLOCK (POSIX only) keeps a FIFO swapped in after the stat check from blocking open().
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)
const TYP = '.typ'
const PROFILE_EXT = '.yaml'
/** Picker hint of a set that ships no `<name>.header.md`. */
const NO_HEADER_HINT = 'ohne Header-Vorlage'

/** Missing paths are normal here (optional folders and files); only other errors are worth a warning. */
function quiet(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * The user's templates folder, exactly as the pipeline computes it (`build.sh`, `convert.ps1`):
 * MDO_TEMPLATES (a relative value counts from the working directory) or
 * `<documents>/Markdown Office/Vorlagen`. Deliberately not derived from the settings, so the
 * editor offers the same sets the export will find.
 */
export function userTemplatesDir(env: NodeJS.ProcessEnv, documentsDir: string): string {
  const v = env.MDO_TEMPLATES
  if (v) return resolve(process.cwd(), v)
  return join(documentsDir, 'Markdown Office', 'Vorlagen')
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch (err) {
    if (!quiet(err)) console.warn('Markdown Office: template path unreadable', p, err)
    return false
  }
}

interface ResolvedSet {
  typ: string
  source: SetInfo['source']
}

/**
 * Same order as `build.sh resolve_template`: `<user>/<n>.typ`, `<user>/<n>/<n>.typ`,
 * `<sets>/<n>/<n>.typ`; the first regular file wins, so a user set shadows a bundled one.
 */
async function resolveSet(
  setsDir: string,
  userDir: string,
  name: string,
): Promise<ResolvedSet | null> {
  if (!SET_NAME_RE.test(name)) return null
  const candidates: ResolvedSet[] = [
    { typ: join(userDir, `${name}${TYP}`), source: 'user' },
    { typ: join(userDir, name, `${name}${TYP}`), source: 'user' },
    { typ: join(setsDir, name, `${name}${TYP}`), source: 'bundled' },
  ]
  for (const c of candidates) if (await isFile(c.typ)) return c
  return null
}

/**
 * A header file as text without BOM; null when missing, not a regular file, larger than
 * 64 KiB or not UTF-8 (then the set counts as having no header file).
 */
async function readHeaderFile(p: string): Promise<string | null> {
  try {
    // Only regular files (symlinks followed): opening a FIFO would block a libuv thread for good.
    if (!(await stat(p)).isFile()) return null
    const fh = await open(p, OPEN_FLAGS)
    let buf: Buffer
    try {
      if (!(await fh.stat()).isFile()) return null
      const chunk = Buffer.alloc(MAX_BYTES + 1)
      const { bytesRead } = await fh.read(chunk, 0, MAX_BYTES + 1, 0)
      if (bytesRead > MAX_BYTES) return null
      buf = chunk.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
    const text = utf8.decode(buf)
    return text.startsWith(BOM) ? text.slice(1) : text
  } catch (err) {
    if (!quiet(err)) console.warn('Markdown Office: header template skipped', p, err)
    return null
  }
}

/** `<dir of the winning .typ>/<n>.header.md` (a flat user set: `Vorlagen/<n>.header.md`). */
function headerPath(set: ResolvedSet, name: string): string {
  return join(dirname(set.typ), `${name}.header.md`)
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (err) {
    if (!quiet(err)) console.warn('Markdown Office: template folder unreadable', dir, err)
    return []
  }
}

/**
 * Every set the export can resolve by name (memo included), sorted by name. Candidates are
 * taken from the folder listings and then resolved like the pipeline does, so the shown
 * source is the one an export would really use. Folders are never created.
 */
export async function listSets(setsDir: string, userDir: string): Promise<SetInfo[]> {
  const candidates = new Set<string>()
  for (const entry of await names(userDir)) {
    candidates.add(entry.endsWith(TYP) ? entry.slice(0, -TYP.length) : entry)
  }
  for (const entry of await names(setsDir)) candidates.add(entry)
  const out: SetInfo[] = []
  for (const name of candidates) {
    const set = await resolveSet(setsDir, userDir, name)
    if (!set) continue
    const header = await readHeaderFile(headerPath(set, name))
    out.push({
      name,
      source: set.source,
      hint: header === null ? NO_HEADER_HINT : headerHint(header),
      hasProfile: header !== null && headerProfile(header) !== null,
    })
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * The header a new note of this set starts with: the set's `<n>.header.md`, or a minimal
 * `template: <n>` header when it has none. null when the name is invalid or no such set exists.
 */
export async function readSetHeader(
  setsDir: string,
  userDir: string,
  name: string,
): Promise<string | null> {
  const set = await resolveSet(setsDir, userDir, name)
  if (!set) return null
  return (await readHeaderFile(headerPath(set, name))) ?? minimalHeader(name)
}

/**
 * Profile names for a set: `*.yaml` in `<user>/profiles/`, then in the set's own `profiles/`
 * (its example profiles), deduplicated and sorted. The pipeline searches the same folders
 * (after the note's own folder, which a new note does not have yet). `.yml` is not listed
 * because the pipeline only resolves `<name>.yaml` for a profile name.
 */
export async function listProfiles(
  setsDir: string,
  userDir: string,
  name: string,
): Promise<string[]> {
  const set = await resolveSet(setsDir, userDir, name)
  if (!set) return []
  const found = new Set<string>()
  for (const dir of [join(userDir, 'profiles'), join(dirname(set.typ), 'profiles')]) {
    for (const entry of await names(dir)) {
      if (!entry.endsWith(PROFILE_EXT)) continue
      const profile = entry.slice(0, -PROFILE_EXT.length)
      if (!SET_NAME_RE.test(profile) || found.has(profile)) continue
      if (await isFile(join(dir, entry))) found.add(profile)
    }
  }
  return [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
