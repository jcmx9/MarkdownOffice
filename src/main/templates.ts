import { constants } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { headerHint, headerProfile, minimalHeader, SET_NAME_RE } from '../core/sets'
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
 * The user's templates folder: MDO_TEMPLATES (a relative value counts from main's working
 * directory) or `<documents>/Markdown Office/Vorlagen` (Electron's documents folder, localised on
 * Linux via XDG). Deliberately not derived from the settings. The export receives this absolute
 * folder as MDO_TEMPLATES (`exportPdf` → `runPipeline`), so the pipeline finds exactly the sets
 * and profiles the editor offered.
 */
export function userTemplatesDir(env: NodeJS.ProcessEnv, documentsDir: string): string {
  const v = env.MDO_TEMPLATES
  if (v) return resolve(process.cwd(), v)
  return join(documentsDir, 'Markdown Office', 'Vorlagen')
}

export async function isFile(p: string): Promise<boolean> {
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
export async function resolveSet(
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
 * The bytes of a regular file of at most `maxBytes`; null when missing, not a regular file or
 * larger. Shared by the text reader below and the signature image of the preview, which has its
 * own (larger) limit.
 */
export async function readCapped(p: string, maxBytes: number): Promise<Buffer | null> {
  try {
    // Only regular files (symlinks followed): opening a FIFO would block a libuv thread for good.
    if (!(await stat(p)).isFile()) return null
    const fh = await open(p, OPEN_FLAGS)
    try {
      if (!(await fh.stat()).isFile()) return null
      const chunk = Buffer.alloc(maxBytes + 1)
      const { bytesRead } = await fh.read(chunk, 0, maxBytes + 1, 0)
      if (bytesRead > maxBytes) return null
      return chunk.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
  } catch (err) {
    if (!quiet(err)) console.warn('Markdown Office: set file skipped', p, err)
    return null
  }
}

/**
 * A small text file (a set's header, a profile) as text without BOM; null when missing, not a
 * regular file, larger than 64 KiB or not UTF-8 (then a set counts as having no header file).
 */
export async function readSmallText(p: string): Promise<string | null> {
  const buf = await readCapped(p, MAX_BYTES)
  if (buf === null) return null
  try {
    const text = utf8.decode(buf)
    return text.startsWith(BOM) ? text.slice(1) : text
  } catch (err) {
    console.warn('Markdown Office: set file skipped', p, err)
    return null
  }
}

/**
 * The example profile a set ships: the profile its header names (`profile:`), looked up in the
 * winning set's own `profiles/` folder (pipeline step 4; for a flat user set that is the shared
 * `<user>/profiles/`). null when the set does not exist, its header names no valid profile, or
 * that file is not a regular file. „Profil anlegen …“ copies it (src/main/profiles.ts).
 */
export async function setExampleProfile(
  setsDir: string,
  userDir: string,
  name: string,
): Promise<{ dir: string; example: string } | null> {
  const set = await resolveSet(setsDir, userDir, name)
  if (!set) return null
  const header = await readSmallText(headerPath(set, name))
  const example = header === null ? null : headerProfile(header)
  if (!example || !SET_NAME_RE.test(example)) return null
  const dir = join(dirname(set.typ), 'profiles')
  return (await isFile(join(dir, `${example}${PROFILE_EXT}`))) ? { dir, example } : null
}

/**
 * The set's `<name>.schema.yaml` next to the winning `<name>.typ` (front matter checks of the
 * set's own keys). null when the set or the file is missing, or it is not a small UTF-8 file.
 */
export async function readSetSchema(
  setsDir: string,
  userDir: string,
  name: string,
): Promise<string | null> {
  const set = await resolveSet(setsDir, userDir, name)
  return set ? readSmallText(join(dirname(set.typ), `${name}.schema.yaml`)) : null
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
    const header = await readSmallText(headerPath(set, name))
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
  return (await readSmallText(headerPath(set, name))) ?? minimalHeader(name)
}

/**
 * Profile names for a set: `*.yaml` in `<user>/<set>/profiles/` (the set's profiles on the user
 * side, also for a bundled set; such a folder without `<set>.typ` does not shadow the set, see
 * `resolveSet`), then in the shared `<user>/profiles/` (fallback for existing users), then in
 * the winning set's own `profiles/` (its example profiles); deduplicated and sorted. The
 * pipeline searches the same folders in this order (after the note's own folder, which a new
 * note does not have yet), so every offered name resolves on export. `.yml` is not listed
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
  const dirs = [
    join(userDir, name, 'profiles'),
    join(userDir, 'profiles'),
    join(dirname(set.typ), 'profiles'),
  ]
  for (const dir of dirs) {
    for (const entry of await names(dir)) {
      if (!entry.endsWith(PROFILE_EXT)) continue
      const profile = entry.slice(0, -PROFILE_EXT.length)
      if (!SET_NAME_RE.test(profile) || found.has(profile)) continue
      if (await isFile(join(dir, entry))) found.add(profile)
    }
  }
  return [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
