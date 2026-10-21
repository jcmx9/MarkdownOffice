import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { ProfileLookup } from '../core/frontmatter-validate'
import { SET_NAME_RE } from '../core/sets'
import type { ValidationInputs } from '../core/validation-context'
import { isFile, listSets, readSetHeader, readSetSchema, resolveSet } from './templates'

// No `electron` import: the CLI bundles this file with Node built-ins only.

const DEFAULT_SET = 'memo'

/**
 * Folder of a `template: x.typ` value, resolved like `resolve_template` in build.sh (`~`
 * expanded, relative to the note's folder); build.sh searches `<that folder>/profiles` too.
 * null when it cannot be resolved here (relative without a note folder, or variables).
 */
function typFolder(value: string, noteDir: string | null): string | null {
  if (/[$%]/.test(value)) return null
  let p = value
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = homedir() + p.slice(1)
  if (!isAbsolute(p)) {
    if (noteDir === null) return null
    p = resolve(noteDir, p)
  }
  return dirname(p)
}

/**
 * Looks up the note's `profile:` exactly like `pipeline/build.sh` does (the authority; its
 * search order is also what `listProfiles` in templates.ts offers):
 * - a name (`^[a-z0-9_-]+$`) is searched as `<name>.yaml` in `<note>/profiles`,
 *   `<user>/<set>/profiles`, `<user>/profiles`, then the set folder's `profiles` (skipped when
 *   the set folder is `<user>/<set>`, it was searched already); first hit wins;
 * - a value ending in `.yaml`/`.yml` is a path, `~` expanded, relative to the note's folder;
 * - anything else is invalid. Values with `$`/`%` (variables) are not checked: null.
 */
async function lookupProfile(
  value: string,
  o: { userDir: string; noteDir: string | null; set: string; setDir: string | null },
): Promise<ProfileLookup | null> {
  if (value === '') return null
  if (SET_NAME_RE.test(value)) {
    const dirs: string[] = []
    if (o.noteDir !== null) dirs.push(join(o.noteDir, 'profiles'))
    if (o.set !== '') dirs.push(join(o.userDir, o.set, 'profiles'))
    dirs.push(join(o.userDir, 'profiles'))
    if (o.setDir !== null && (o.set === '' || o.setDir !== join(o.userDir, o.set))) {
      dirs.push(join(o.setDir, 'profiles'))
    }
    const files = dirs.map((d) => join(d, `${value}.yaml`))
    for (const f of files) if (await isFile(f)) return { status: 'found' }
    return { status: 'missing', searched: dirs }
  }
  if (/\.ya?ml$/i.test(value)) {
    if (/[$%]/.test(value)) return null
    let p = value
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = homedir() + p.slice(1)
    if (!isAbsolute(p)) {
      // Without a note folder (unsaved note) a relative path cannot be resolved: not checked.
      if (o.noteDir === null) return null
      p = resolve(o.noteDir, p)
    }
    return (await isFile(p)) ? { status: 'found' } : { status: 'missing', searched: [p] }
  }
  return { status: 'invalid' }
}

/**
 * Everything the validator needs from disk for one note: the installed sets, the used set's
 * header and `<name>.schema.yaml`, and the `profile:` lookup. `template` is the note's raw
 * `template:` value ('' = the default set memo, a `.typ` path = no set files).
 */
export async function validationInputs(o: {
  setsDir: string
  userDir: string
  noteDir: string | null
  template: string
  profile: string
}): Promise<ValidationInputs> {
  const isPath = o.template.toLowerCase().endsWith('.typ')
  const set = isPath ? '' : o.template === '' ? DEFAULT_SET : o.template
  const sets = (await listSets(o.setsDir, o.userDir)).map((s) => s.name)
  const resolved = isPath ? null : await resolveSet(o.setsDir, o.userDir, set)
  const header = resolved ? await readSetHeader(o.setsDir, o.userDir, set) : null
  const schemaText = resolved ? await readSetSchema(o.setsDir, o.userDir, set) : null
  // A single .typ has no set name, but its own folder is still a search location. If that
  // folder is unknown, a profile *name* cannot be judged: not checked, never a false missing.
  const typDir = isPath ? typFolder(o.template, o.noteDir) : null
  const profile =
    isPath && typDir === null && SET_NAME_RE.test(o.profile)
      ? null
      : await lookupProfile(o.profile, {
          userDir: o.userDir,
          noteDir: o.noteDir,
          set,
          setDir: resolved ? dirname(resolved.typ) : typDir,
        })
  return { set, sets, header, schemaText, profile }
}
