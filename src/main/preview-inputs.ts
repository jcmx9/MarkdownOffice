import { lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { flattenProfile, readFlatYaml } from '../core/flat-yaml'
import { MEMO_PREVIEW, parsePreviewSpec, profileKeys } from '../core/preview-spec'
import { sanitizeSetCss } from '../core/set-css'
import { DEFAULT_SET } from '../core/sets'
import type { PreviewInputs } from '../shared/types'
import { readCapped, readSmallText, resolveSet } from './templates'
import { findProfile } from './validation-inputs'

/** A signature is an image in a letter, not artwork: larger files are refused, not shrunk. */
const MAX_SIGNATURE = 256 * 1024
/**
 * A bare `.svg` file name: no folder part, so the only file read is one directly next to the
 * profile the note names (no `..`, no absolute path, nothing the renderer could aim elsewhere).
 */
const SIGNATURE_RE = /^[^/\\]+\.svg$/i

// After an optional UTF-8 BOM and whitespace: an SVG document, not some other file named `.svg`.
const SVG_START_RE = /^(\uFEFF)?\s*(<svg|<\?xml)/

const NONE: PreviewInputs = { set: '', css: [], preview: null, profile: {}, signature: null }

/** The profile's `signature` as a data URL; null unless it is a bare small SVG next to it. */
async function readSignature(
  profilePath: string,
  profile: Record<string, string>,
): Promise<string | null> {
  const name = profile.signature ?? ''
  // Hidden files are refused too: `.svg` alone would otherwise match, and dotfiles are never
  // something a set author ships deliberately.
  if (!SIGNATURE_RE.test(name) || name.startsWith('.')) return null
  const path = join(dirname(profilePath), name)
  try {
    // A symlink could point anywhere; only a real file next to the profile is read.
    if ((await lstat(path)).isSymbolicLink()) return null
  } catch {
    return null // missing: no signature, as for any absent optional file
  }
  const buf = await readCapped(path, MAX_SIGNATURE)
  if (buf === null) return null
  // Only the head is decoded; a non-UTF-8 byte there just fails the check.
  if (!SVG_START_RE.test(buf.subarray(0, 256).toString('utf8'))) return null
  return `data:image/svg+xml;base64,${buf.toString('base64')}`
}

/**
 * Everything the editor preview needs from disk for one note: the set's sanitised
 * `<name>.css`, its `<name>.preview.yaml`, the sender profile and its signature. Same set and
 * profile lookup as `validationInputs` (and so as the export), but a separate answer: the
 * preview also needs notes without `template:` (memo) and the profile's values, not just its
 * existence. A `.typ` path or a set that is not installed gets the built-in look (`set: ''`).
 */
export async function previewInputs(o: {
  setsDir: string
  userDir: string
  noteDir: string | null
  template: string
  profile: string
}): Promise<PreviewInputs> {
  if (o.template.toLowerCase().endsWith('.typ')) return { ...NONE }
  const set = o.template === '' ? DEFAULT_SET : o.template
  const resolved = await resolveSet(o.setsDir, o.userDir, set)
  if (resolved === null) return { ...NONE }
  const setDir = dirname(resolved.typ)

  const cssText = await readSmallText(join(setDir, `${set}.css`))
  let css: PreviewInputs['css'] = []
  if (cssText !== null) {
    const sanitized = sanitizeSetCss(cssText)
    css = sanitized.rules
    if (sanitized.dropped.length > 0) {
      console.warn('Markdown Office: set CSS', set, 'dropped', sanitized.dropped)
    }
  }
  const preview = await readSmallText(join(setDir, `${set}.preview.yaml`))
  // Same fallback as the renderer: a missing or broken description shows memo's blocks.
  const parsed = preview === null ? null : parsePreviewSpec(preview)
  const wanted = profileKeys(parsed?.ok ? parsed.spec : MEMO_PREVIEW)

  const found = await findProfile(o.profile, {
    userDir: o.userDir,
    noteDir: o.noteDir,
    set,
    setDir,
  })
  let profile: Record<string, string> = {}
  let signature: string | null = null
  if (found?.status === 'found') {
    const text = await readSmallText(found.path)
    if (text !== null) {
      // Only the keys the set shows leave main: `profile:` may name any small YAML file by path
      // (`~/.config/…/hosts.yml`), and its other values (tokens) must never reach the renderer.
      const all = flattenProfile(readFlatYaml(text))
      // fromEntries defines own properties, so even a key like `__proto__` stays plain data.
      profile = Object.fromEntries(
        [...wanted].filter((k) => Object.hasOwn(all, k)).map((k) => [k, all[k] as string]),
      )
      if (wanted.has('signature')) signature = await readSignature(found.path, all)
    }
  }
  return { set, css, preview, profile, signature }
}
