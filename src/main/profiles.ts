import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SET_NAME_RE } from '../shared/sets'
import type { CreateProfileResult } from '../shared/types'
import { canonicalPath, errorCode } from './files'
import { readSmallText, setExampleProfile } from './templates'

const PROFILE_EXT = '.yaml'

/** Thrown when a target file appeared between the free-check and the write (`wx`/EXCL). */
class Taken extends Error {}

const taken = (name: string): string => `Profil ${name} gibt es schon.`

/** Nothing is at `p` (not even a dangling link); any other lstat error counts as taken. */
async function isFree(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return false
  } catch (err) {
    return errorCode(err) === 'ENOENT'
  }
}

/**
 * The example's companion files: every regular file next to `<ex>.yaml` whose name starts with
 * `<ex>-` or `<ex>.` (din5008a: `beispiel-unterschrift.svg`). A profile refers to such files by
 * bare name next to itself (the pipeline only resolves `signature:` there), so they must travel
 * with the copy or the new profile would point at nothing.
 */
async function companions(dir: string, example: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir)) {
    if (entry === `${example}${PROFILE_EXT}`) continue
    if (!entry.startsWith(`${example}-`) && !entry.startsWith(`${example}.`)) continue
    // Regular files only (symlinks followed, as everywhere in the set lookup): copying a FIFO
    // would block, a folder is not a profile file.
    if ((await stat(join(dir, entry))).isFile()) out.push(entry)
  }
  return out.sort()
}

/**
 * Replaces every `key: value` whose value is exactly an old companion file name by the new
 * name, keeping quotes, padding, comments and line endings. Only whole values count, so a
 * comment or a longer value that merely contains the name stays as written.
 */
export function renameCompanionValues(text: string, renamed: ReadonlyMap<string, string>): string {
  if (renamed.size === 0) return text
  return text
    .split('\n')
    .map((line) => {
      const cr = line.endsWith('\r') ? '\r' : ''
      const body = cr ? line.slice(0, -1) : line
      const m = /^([ \t]*[A-Za-z0-9_-]+:[ \t]*)(.*)$/.exec(body)
      if (!m) return line
      const head = m[1] ?? ''
      const rest = m[2] ?? ''
      const q = rest[0]
      if (q === '"' || q === "'") {
        const end = rest.indexOf(q, 1)
        const to = end > 0 ? renamed.get(rest.slice(1, end)) : undefined
        return to === undefined ? line : `${head}${q}${to}${rest.slice(end)}${cr}`
      }
      // A plain value ends at whitespace followed by `#` (as the pipeline's yaml_str reads it).
      const c = rest.search(/[ \t]#/)
      const value = (c < 0 ? rest : rest.slice(0, c)).replace(/[ \t]+$/, '')
      const to = renamed.get(value)
      return to === undefined ? line : `${head}${to}${rest.slice(value.length)}${cr}`
    })
    .join('\n')
}

/**
 * „Profil anlegen …“: copies the set's example profile to `<user>/<set>/profiles/<name>.yaml`
 * (pipeline lookup step 2, so the new profile wins over the shared folder and the example),
 * with its companion files renamed `<ex>…` → `<name>…` and the YAML's references to them
 * updated. Nothing is ever overwritten: an existing target → error, and a target that appears
 * during the copy (`wx` / COPYFILE_EXCL) rolls back the files this call created. The YAML is
 * written last, so a failed copy never leaves a listed profile without its companions.
 * Returns the canonical path of the new YAML; the caller allows it for the renderer.
 */
export async function createProfile(
  setsDir: string,
  userDir: string,
  set: string,
  name: string,
): Promise<CreateProfileResult> {
  if (!SET_NAME_RE.test(set)) return { ok: false, error: `Ungültiger Set-Name „${set}“.` }
  if (!SET_NAME_RE.test(name) || name.length > 64)
    return {
      ok: false,
      error: `„${name}“ ist kein gültiger Profilname: nur a–z, 0–9, - und _.`,
    }
  const source = await setExampleProfile(setsDir, userDir, set)
  if (!source) return { ok: false, error: `Vorlage ${set} bringt kein Beispielprofil mit.` }
  const { dir, example } = source
  const yaml = await readSmallText(join(dir, `${example}${PROFILE_EXT}`))
  if (yaml === null)
    return { ok: false, error: `Beispielprofil ${example} von ${set} ist nicht lesbar.` }

  const targetDir = join(userDir, set, 'profiles')
  const files = await companions(dir, example)
  const renamed = new Map(files.map((f) => [f, `${name}${f.slice(example.length)}`]))
  const target = join(targetDir, `${name}${PROFILE_EXT}`)
  for (const p of [target, ...[...renamed.values()].map((f) => join(targetDir, f))]) {
    if (!(await isFree(p))) return { ok: false, error: taken(name) }
  }

  await mkdir(targetDir, { recursive: true })
  const created: string[] = []
  try {
    for (const [from, to] of renamed) {
      const dest = join(targetDir, to)
      // Binary copy: a companion may be an image; EXCL never replaces an existing file.
      await copyFile(join(dir, from), dest, constants.COPYFILE_EXCL).catch((err: unknown) => {
        throw errorCode(err) === 'EEXIST' ? new Taken() : err
      })
      created.push(dest)
    }
    const fh = await open(target, 'wx').catch((err: unknown) => {
      throw errorCode(err) === 'EEXIST' ? new Taken() : err
    })
    // Once the exclusive open succeeded the YAML is ours: a failed write (ENOSPC, EIO …) must
    // remove it too, or a truncated profile would stay listed without its companions.
    created.push(target)
    try {
      await fh.writeFile(renameCompanionValues(yaml, renamed))
    } finally {
      await fh.close()
    }
  } catch (err) {
    // Only what this call created; a file that was there before is never touched.
    for (const p of created) await rm(p, { force: true }).catch(() => undefined)
    if (err instanceof Taken) return { ok: false, error: taken(name) }
    return {
      ok: false,
      error: `Profil ${name} konnte nicht angelegt werden: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return { ok: true, path: await canonicalPath(target) }
}
