/**
 * Profiles as default values for a note's header (owner, 2026-11-01): any set's profile may hold
 * values for the keys of that set's header, and a value in the note wins. A key that is missing
 * or empty in the note takes the profile's value, live, so a changed profile reaches every note
 * that names it. Sender data of a letter (`street:` …) are no header keys and stay out of this.
 *
 * Pure string logic, shared by the export (src/cli/stage.ts), the preview (via
 * src/main/preview-inputs.ts) and „Profil anlegen …“.
 */
import { readFlatYaml } from './flat-yaml'
import { closingFence, crOf, headerBlocks, KEY, stripCr } from './header-merge'

/** They say which set and profile a note uses: a profile can never redirect itself. */
const NEVER = new Set(['template', 'profile'])
/** The note's own text per note; a default for it would make no sense. */
const PER_NOTE = new Set(['title', 'subtitle', 'toptitle', 'date'])
/** `header: ""` is a value (rule without text), not an empty field. */
const EMPTY_IS_A_VALUE = new Set(['header'])

function isEmptyValue(lines: readonly string[], key: string): boolean {
  const values = readFlatYaml(lines.join('\n'))
  const value = Object.hasOwn(values, key) ? values[key] : ''
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/** The profile's non-empty entries for keys of the set's header, as YAML lines. */
export function profileDefaults(profile: string, setHeader: string): string {
  const keys = new Set(headerBlocks(setHeader).map((b) => b.key))
  return headerBlocks(profile)
    .filter((b) => keys.has(b.key) && !NEVER.has(b.key) && !isEmptyValue(b.lines, b.key))
    .flatMap((b) => b.lines)
    .join('\n')
}

/** `note` with the defaults filled in: only missing and empty keys change, nothing else. */
export function withProfileDefaults(note: string, defaults: string): string {
  if (defaults === '') return note
  const lines = note.split('\n')
  const close = closingFence(lines)
  if (close === null || close < 0) return note
  const last = new Map<string, number>()
  for (let i = 1; i < close; i++) {
    const key = KEY.exec(stripCr(lines[i] ?? ''))?.[1]
    if (key) last.set(key, i)
  }
  const out = lines.map((l) => [l])
  const cr = crOf(lines[close] ?? '')
  const added: string[] = []
  for (const block of headerBlocks(defaults)) {
    const at = last.get(block.key)
    if (at === undefined) added.push(...block.lines.map((l) => l + cr))
    else if (!EMPTY_IS_A_VALUE.has(block.key) && isEmptyValue(lines.slice(at, close), block.key))
      out[at] = block.lines.map((l) => l + crOf(lines[at] ?? ''))
  }
  out[close] = [...added, lines[close] ?? '']
  return out.flat().join('\n')
}

/**
 * A new note's header with the profile chosen: a key the set gives a default value (`lang: de`)
 * counts as set in the note, so the profile's value is written there. Empty keys stay empty and
 * follow the profile live.
 */
export function headerWithProfileValues(header: string, defaults: string): string {
  const values = new Map(headerBlocks(defaults).map((b) => [b.key, b.lines]))
  if (values.size === 0) return header
  const lines = header.split('\n').map(stripCr)
  for (const block of headerBlocks(header)) {
    const own = values.get(block.key)
    if (!own || isEmptyValue(block.lines, block.key)) continue
    lines.splice(lines.indexOf(block.lines[0] as string), block.lines.length, ...own)
  }
  return lines.join('\n')
}

/** „Profil anlegen …“ for a set without an example profile: its header fields as a start. */
export function generatedProfile(set: string, header: string): string {
  const keep = headerBlocks(header).filter((b) => !NEVER.has(b.key) && !PER_NOTE.has(b.key))
  return [
    `# Profil für ${set}: Vorgabewerte. Fehlt ein Feld in der Notiz oder ist es leer, gilt der Wert`,
    '# von hier; ein Wert in der Notiz gewinnt.',
    ...keep.flatMap((b) => b.lines),
    '',
  ].join('\n')
}
