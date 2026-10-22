import { dirname, join } from 'node:path'
import { flattenProfile, readFlatYaml } from '../core/flat-yaml'
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
  const buf = await readCapped(join(dirname(profilePath), name), MAX_SIGNATURE)
  return buf === null ? null : `data:image/svg+xml;base64,${buf.toString('base64')}`
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
      profile = flattenProfile(readFlatYaml(text))
      signature = await readSignature(found.path, profile)
    }
  }
  return { set, css, preview, profile, signature }
}
