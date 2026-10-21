/**
 * Einfügen → „Vorlage …“: merges a template set's header into a note that came from elsewhere.
 *
 * Pure string logic (no DOM, no Electron, no CodeMirror), so a later shared core for the CLI or
 * an MCP server can reuse it unchanged. The input is the note's text as the editor holds it
 * (lines joined by `\n`; a line may keep its own `\r` in a mixed note) or as raw file text
 * (CRLF); the result is a list of non-overlapping changes, so the editor applies the whole merge
 * as one transaction (one undo step) and every byte outside the changed spots stays as it was.
 *
 * Rules agreed with the owner:
 * 1. No front matter → the set's header goes on top (one blank line before existing text).
 * 2. Existing front matter → existing keys keep their values; keys of the set's header that are
 *    missing are appended at the bottom of the note's header with the set's default value and
 *    comment, in the set's order; no duplicates; existing comments and order untouched.
 * 3. `template:` is set to the chosen set: in place if present (every column-0 occurrence, so
 *    whichever one a reader takes is right), else appended.
 * 4. `date:` is checked by the YAML validator (src/core/frontmatter-validate.ts), not here.
 * 5. A chosen profile sets `profile:` like rule 3.
 */
import { SET_NAME_RE, type ValueKey, withValue } from './sets'

export interface TextChange {
  from: number
  to: number
  insert: string
}

export interface TemplateChoiceInput {
  /** The chosen set (written to `template:`); ignored when it is not a valid set name. */
  template: string
  /** The chosen profile, or null to keep whatever the note or the set says. */
  profile: string | null
}

export type MergeResult =
  /** The note had no front matter: the header was put on top. */
  | { kind: 'inserted'; changes: TextChange[] }
  /** The note's header was completed; `added` lists the appended keys (set order). */
  | { kind: 'merged'; changes: TextChange[]; added: string[] }
  /** An opening `---` without a closing fence: merging would swallow the note, so refused. */
  | { kind: 'unclosed' }

// Same fences as the editor (src/renderer/editor/frontmatter.ts) and the pipeline.
const OPEN = /^---\s*$/
const CLOSE = /^(---|\.\.\.)\s*$/
/** A top-level key: column 0, like the pipeline's front-matter reader; indented keys are nested. */
export const KEY = /^([A-Za-z0-9_-]+):/

export const stripCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line)
const crOf = (line: string): string => (line.endsWith('\r') ? '\r' : '')

/** Index of the closing fence, -1 when the text has an unclosed header, null without one. */
export function closingFence(lines: readonly string[]): number | null {
  if (lines.length < 2 || !OPEN.test(lines[0] ?? '')) return null
  for (let i = 1; i < lines.length; i++) if (CLOSE.test(lines[i] ?? '')) return i
  return -1
}

/** Start offset of every line in `text` split by `\n`. */
export function lineStarts(lines: readonly string[]): number[] {
  const out: number[] = []
  let pos = 0
  for (const l of lines) {
    out.push(pos)
    pos += l.length + 1
  }
  return out
}

interface Block {
  key: string
  /** The key line and its continuation lines (indented lines, `- ` list items), without `\r`. */
  lines: string[]
}

/**
 * The set header's top-level entries in order. A continuation line (indented, or a column-0
 * `- ` item of a block list) belongs to the key above it; comment lines and blank lines between
 * the keys belong to no key and are not copied. A repeated key counts once (the first).
 */
function headerBlocks(header: string): Block[] {
  const lines = header.split('\n').map(stripCr)
  const close = closingFence(lines)
  const body = close === null ? lines : close < 0 ? lines.slice(1) : lines.slice(1, close)
  const blocks: Block[] = []
  const seen = new Set<string>()
  let current: Block | null = null
  for (const line of body) {
    const m = KEY.exec(line)
    if (m?.[1]) {
      current = seen.has(m[1]) ? null : { key: m[1], lines: [line] }
      if (current) {
        seen.add(m[1])
        blocks.push(current)
      }
    } else if (current && /^([ \t]|- |-$)/.test(line)) current.lines.push(line)
    else current = null
  }
  return blocks
}

/** `<key>: value` for a validated value, as the set header's line (with comment) or a new one. */
function setLine(line: string, key: ValueKey, value: string): string {
  return withValue(line, key, value)
}

/** The values the choice writes, only the valid ones (a name could otherwise carry YAML). */
function forcedValues(choice: TemplateChoiceInput): [ValueKey, string][] {
  const out: [ValueKey, string][] = []
  if (SET_NAME_RE.test(choice.template)) out.push(['template', choice.template])
  if (choice.profile !== null && SET_NAME_RE.test(choice.profile)) {
    out.push(['profile', choice.profile])
  }
  return out
}

/** Rule 1: the set's header (choice applied), trailing blank lines dropped, in the note's EOL. */
function insertWholeHeader(
  note: string,
  lines: readonly string[],
  header: string,
  choice: TemplateChoiceInput,
): TextChange[] {
  let headerLines = header.replace(/\s+$/, '').split('\n').map(stripCr)
  if (closingFence(headerLines) === null) headerLines = ['---', ...headerLines, '---']
  const close = closingFence(headerLines) ?? -1
  for (const [key, value] of forcedValues(choice)) {
    const at = headerLines.findIndex((l, i) => i > 0 && i < close && l.startsWith(`${key}:`))
    if (at > 0) headerLines[at] = setLine(headerLines[at] ?? '', key, value)
    else headerLines.splice(close, 0, `${key}: ${value}`)
  }
  // The note's own line break: a raw CRLF note keeps CRLF; the editor's doc has none (it adds
  // CRLF on save), so its `\n` is right there too.
  const nl = `${crOf(lines[0] ?? '')}\n`
  const first = stripCr(lines[0] ?? '')
  const gap = note.length === 0 || /^\s*$/.test(first) ? '' : nl
  return [{ from: 0, to: 0, insert: headerLines.join(nl) + nl + gap }]
}

/** Merges the set's `header` into `note` by the rules above; see `MergeResult`. */
export function mergeHeader(
  note: string,
  header: string,
  choice: TemplateChoiceInput,
): MergeResult {
  const lines = note.split('\n')
  const close = closingFence(lines)
  if (close === null)
    return { kind: 'inserted', changes: insertWholeHeader(note, lines, header, choice) }
  if (close < 0) return { kind: 'unclosed' }

  const starts = lineStarts(lines)
  const changes: TextChange[] = []
  const present = new Set<string>()
  for (let i = 1; i < close; i++) {
    const key = KEY.exec(stripCr(lines[i] ?? ''))?.[1]
    if (key) present.add(key)
  }

  // Rules 3 and 5, in place: every column-0 line of the key, its `\r` and comment column kept.
  const forced = forcedValues(choice)
  for (const [key, value] of forced) {
    for (let i = 1; i < close; i++) {
      const line = lines[i] ?? ''
      if (!stripCr(line).startsWith(`${key}:`)) continue
      const next = setLine(line, key, value)
      const from = starts[i] ?? 0
      if (next !== line) changes.push({ from, to: from + line.length, insert: next })
    }
  }

  // Rule 2: the missing keys, in the set's order, with the set's default value and comment;
  // the chosen template/profile replaces the default of its own line.
  const appended: string[] = []
  const added: string[] = []
  for (const block of headerBlocks(header)) {
    if (present.has(block.key)) continue
    const out = [...block.lines]
    const own = forced.find(([key]) => key === block.key)
    if (own) out[0] = setLine(out[0] ?? '', own[0], own[1])
    appended.push(...out)
    added.push(block.key)
    present.add(block.key)
  }
  for (const [key, value] of forced) {
    if (present.has(key)) continue
    appended.push(`${key}: ${value}`)
    added.push(key)
  }
  if (appended.length > 0) {
    // New lines end like the closing fence (a mixed note's `\r`, a raw CRLF note's CRLF).
    const fence = lines[close] ?? ''
    const nl = `${crOf(fence)}\n`
    const from = starts[close] ?? 0
    changes.push({ from, to: from, insert: appended.map((l) => l + nl).join('') })
  }
  return { kind: 'merged', changes, added }
}

/** Applies non-overlapping changes (any order) to `text`. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  }
  return out
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const GERMAN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/

/**
 * A date the owner accepts in `date:`: empty, `YYYY-MM-DD` or `D.M.YYYY`/`DD.MM.YYYY`, and a
 * real calendar day (31.04. is a wrong notation, too). Stricter than the pipeline (which also
 * takes `2026-1-5`), so a note that leaves the editor reads the same everywhere.
 */
export function isValidDate(value: string): boolean {
  if (value === '') return true
  let y: number
  let m: number
  let d: number
  const iso = ISO.exec(value)
  const de = GERMAN.exec(value)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (de) [y, m, d] = [Number(de[3]), Number(de[2]), Number(de[1])]
  else return false
  const day = new Date(Date.UTC(y, m - 1, d))
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d
}
