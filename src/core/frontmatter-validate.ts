/**
 * Front matter validator: checks a note's header against a `Schema` (pipeline layer + the set's
 * own layer) and returns findings, each with the text changes of its fix.
 *
 * Pure string logic, shared by the editor ("YAML prüfen"), the export banner and the CLI
 * (`markdown-office validate`). It never throws on bad input and never rewrites the note: a fix
 * is a list of `TextChange`s that replace one whole line (its `\r` and `# comment` column are
 * kept by `rewriteValue`), so every byte outside the touched lines stays as it was.
 *
 * Severity: `error` = the pipeline or the set would ignore, misread or fail on the value;
 * `warning` = works but is not canonical; `hint` = key typo. Empty values are never a finding
 * (the pipeline ignores them). Only column-0 keys count; nested lines are only looked at to
 * count the items of a block list.
 */
import { CORE_SCHEMA, load, YAMLException } from 'js-yaml'
import { type FieldRule, PIPELINE_SCHEMA, ruleOf, type Schema } from './frontmatter-schema'
import {
  closingFence,
  isValidDate,
  KEY,
  lineStarts,
  mergeHeader,
  stripCr,
  type TextChange,
} from './header-merge'
import { DEFAULT_SET, rewriteValue, SET_NAME_RE, splitValue } from './sets'

export { rewriteValue } from './sets'

export type Severity = 'error' | 'warning' | 'hint'

/**
 * Every finding kind. `params` per code (all values are strings; `value` = the value as
 * written, `key` is the finding's own field):
 * - validate.syntax: `reason` (js-yaml's wording)
 * - validate.duplicate: `first` (line of the first occurrence)
 * - validate.bool: `value`
 * - validate.enum: `value`, `allowed` (comma-separated)
 * - validate.date.invalid: `value`
 * - validate.date.impossible: `value`
 * - validate.length: `value`
 * - validate.length.max: `value`, `max`
 * - validate.length.min: `value`, `min`
 * - validate.list: `value`
 * - validate.lines.max: `count`, `max`
 * - validate.text.quote: `value`, `as` (bool | null | number)
 * - validate.file.ext: `value`, `allowed` (comma-separated)
 * - validate.name: `value`
 * - validate.lang: `value`
 * - validate.template.unknown: `value`
 * - validate.profile.missing: `value`, `searched` (newline-separated paths)
 * - validate.profile.invalid: `value`
 * - validate.key.typo: `similar` (the key it probably means)
 */
export type FindingCode =
  | 'validate.syntax'
  | 'validate.duplicate'
  | 'validate.bool'
  | 'validate.enum'
  | 'validate.date.invalid'
  | 'validate.date.impossible'
  | 'validate.length'
  | 'validate.length.max'
  | 'validate.length.min'
  | 'validate.list'
  | 'validate.lines.max'
  | 'validate.text.quote'
  | 'validate.file.ext'
  | 'validate.name'
  | 'validate.lang'
  | 'validate.template.unknown'
  | 'validate.profile.missing'
  | 'validate.profile.invalid'
  | 'validate.key.typo'

export interface Finding {
  /** `${code}:${line}:${key}`, stable for the same text. */
  id: string
  code: FindingCode
  severity: Severity
  /** 1-based line in the text passed in (the opening `---` is line 1). */
  line: number
  key: string
  params: Record<string, string>
  /** The value (or key) the fix writes, for display. */
  suggestion: string | null
  /** Empty = no automatic fix. */
  changes: TextChange[]
  /** False for hints and for findings without changes. */
  preselected: boolean
}

/** What Node found for the note's `profile:` (the core has no file access). */
export type ProfileLookup =
  | { status: 'found' }
  | { status: 'missing'; searched: string[] }
  | { status: 'invalid' }

export interface ValidationContext {
  /** Pipeline layer combined with the set's layer. */
  schema: Schema
  /** Names of the installed sets; null = not known (no unknown-set check). */
  sets: readonly string[] | null
  /** The set's header file text (source of the missing keys); null = none. */
  header: string | null
  /** Result of the profile lookup; null = not checked. */
  profile: ProfileLookup | null
}

export type ValidationResult =
  | { kind: 'none' }
  | { kind: 'unclosed' }
  | { kind: 'checked'; findings: Finding[]; missing: string[]; missingChanges: TextChange[] }

// --- Reading the front matter ---------------------------------------------------------

const BOM = '﻿'

interface FrontMatter {
  lines: string[]
  starts: number[]
  /** Index of the closing fence. */
  close: number
}

/** The note's closed front matter, or why there is none. */
function readFrontMatter(note: string): FrontMatter | 'none' | 'unclosed' {
  const lines = note.split('\n')
  // A BOM in front of the opening fence is part of the file, not of the fence (the CLI sees raw
  // text); only the fence test ignores it, all offsets stay those of the original text.
  const probe = [(lines[0] ?? '').replace(BOM, ''), ...lines.slice(1)]
  const close = closingFence(probe)
  if (close === null) return 'none'
  if (close < 0) return 'unclosed'
  return { lines, starts: lineStarts(lines), close }
}

interface Entry {
  key: string
  /** Index into `FrontMatter.lines`. */
  index: number
  /** The line with its `\r`. */
  text: string
  /** Offset of the line in the note. */
  start: number
  /** Text after `<key>:` without `\r`. */
  raw: string
  /** Continuation lines (indented lines, `- ` items) below the key, without `\r`. */
  block: string[]
  /** Index of the line after the key's last continuation line (the key's own end). */
  end: number
}

const CONTINUATION = /^([ \t]|- |-$)/

/** Every column-0 key of the header in order, duplicates included. */
function topLevelEntries(fm: FrontMatter): Entry[] {
  const out: Entry[] = []
  for (let i = 1; i < fm.close; i++) {
    const text = fm.lines[i] ?? ''
    const m = KEY.exec(stripCr(text))
    if (!m?.[1]) continue
    const block: string[] = []
    let end = i + 1
    for (let j = i + 1; j < fm.close; j++) {
      const l = stripCr(fm.lines[j] ?? '')
      if (KEY.test(l)) break
      if (/^\s*(#.*)?$/.test(l)) continue
      if (!CONTINUATION.test(l)) break
      block.push(l)
      end = j + 1
    }
    out.push({
      key: m[1],
      index: i,
      text,
      start: fm.starts[i] ?? 0,
      raw: stripCr(text).slice(m[1].length + 1),
      block,
      end,
    })
  }
  return out
}

/** The entries the pipeline sees: the last of duplicate keys wins. */
function lastEntries(entries: readonly Entry[]): Entry[] {
  const byKey = new Map<string, Entry>()
  for (const e of entries) byKey.set(e.key, e)
  return [...byKey.values()].sort((a, b) => a.index - b.index)
}

/**
 * The last column-0 `<key>:` value of the front matter, unquoted and without its comment;
 * '' for a key without value, null when the key (or the front matter) is missing.
 */
export function topLevelValue(note: string, key: string): string | null {
  const fm = readFrontMatter(note)
  if (typeof fm === 'string') return null
  const last = lastEntries(topLevelEntries(fm)).find((e) => e.key === key)
  return last ? splitValue(last.raw).value.trim() : null
}

// build.sh and the main process test the extension case-insensitively (`Brief.TYP` is a path).
const isTypPath = (value: string): boolean => /\.typ$/i.test(value)

/**
 * The set a note selects: `template:` or the pipeline's default when empty or missing; '' when
 * `template:` is a path to a `.typ` file (no set, so no set files to look up).
 */
export function noteSet(note: string): string {
  const value = topLevelValue(note, 'template')
  if (!value) return DEFAULT_SET
  return isTypPath(value) ? '' : value
}

/** A double-quoted YAML scalar; only `\` and `"` need escaping for the plain text we write. */
export function quoteYaml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// --- Value checks ---------------------------------------------------------------------

/** What a value check sees of one key. */
interface Subject {
  entry: Entry
  rule: FieldRule
  /** The value without quotes and comment, trimmed. */
  value: string
  /** The value was written in quotes. */
  quoted: boolean
  /**
   * The rule is the pipeline's own (the set does not override it): build.sh reads the value as
   * raw text with its own bool words. A set's key is read by Typst's yaml() (YAML 1.2) instead.
   */
  pipeline: boolean
}

/** A check's verdict; `write` is the new value as written into the line (null = no fix). */
interface Verdict {
  code: FindingCode
  severity: Severity
  params: Record<string, string>
  suggestion: string | null
  write?: string
}

const verdict = (
  code: FindingCode,
  severity: Severity,
  params: Record<string, string>,
  suggestion: string | null = null,
  write: string | undefined = suggestion ?? undefined,
): Verdict => ({ code, severity, params, suggestion, write })

/** `map[key]` only for the map's own entries (a value may be `constructor`). */
const own = <T>(map: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(map, key) ? map[key] : undefined

// The words the pipeline reads as a boolean (build.sh), any case.
const BOOL_ALIASES: Record<string, 'true' | 'false'> = {
  true: 'true',
  false: 'false',
  yes: 'true',
  no: 'false',
  on: 'true',
  off: 'false',
  y: 'true',
  n: 'false',
}
// Words the pipeline does not read but whose meaning is plain.
const BOOL_GUESSES: Record<string, 'true' | 'false'> = {
  ja: 'true',
  nein: 'false',
  '1': 'true',
  '0': 'false',
}

/** Boolean spelling: lower-case true/false is canonical, pipeline aliases warn, guesses err. */
function boolVerdict(code: 'validate.bool' | 'validate.enum', s: Subject): Verdict | 'ok' {
  const lower = s.value.toLowerCase()
  if (s.value === 'true' || s.value === 'false') return 'ok'
  const params = { value: s.value }
  const alias = own(BOOL_ALIASES, lower)
  // Typst's yaml() keeps y/n as text, so a set reading its own key would not see a bool.
  const setMisreads = !s.pipeline && (lower === 'y' || lower === 'n')
  if (alias) return verdict(code, setMisreads ? 'error' : 'warning', params, alias)
  const guess = own(BOOL_GUESSES, lower)
  if (guess) return verdict(code, 'error', params, guess)
  return verdict(code, 'error', params)
}

function checkBool(s: Subject): Verdict | null {
  const v = boolVerdict('validate.bool', s)
  return v === 'ok' ? null : v
}

function checkEnum(s: Subject): Verdict | null {
  const values = s.rule.values ?? []
  if (values.includes(s.value)) return null
  const params = { value: s.value, allowed: values.join(', ') }
  if (values.includes('true') && values.includes('false')) {
    const v = boolVerdict('validate.enum', s)
    // The enum may also list other words (auto); a bool spelling only counts when it maps.
    if (v !== 'ok' && v.suggestion) return { ...v, params }
  }
  const same = values.find((x) => x.toLowerCase() === s.value.toLowerCase())
  // build.sh lower-cases toc/h1_break before it matches `auto`, so `Auto` works: not canonical
  // (a warning), unlike a case slip in any other enum, which the set would not read.
  if (same) {
    const pipelineAccepts = same === 'auto' && (s.entry.key === 'toc' || s.entry.key === 'h1_break')
    return verdict('validate.enum', pipelineAccepts ? 'warning' : 'error', params, same)
  }
  return verdict('validate.enum', 'error', params)
}

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  mär: 3,
  maerz: 3,
  mrz: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

function checkDate(s: Subject): Verdict | null {
  const v = s.value
  const params = { value: v }
  const invalid = verdict('validate.date.invalid', 'error', params)
  let y: number
  let m: number
  let d: number
  let canonical = false
  const iso1 = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v)
  const de4 = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v)
  const de2 = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/.exec(v)
  const word = /^(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)\.?\s+(\d{4})$/.exec(v)
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)
  if (iso1) {
    ;[y, m, d] = [Number(iso1[1]), Number(iso1[2]), Number(iso1[3])]
    canonical = iso1[2]?.length === 2 && iso1[3]?.length === 2
  } else if (de4) {
    // D.M.YYYY is accepted as written; only an impossible day is a finding.
    ;[d, m, y] = [Number(de4[1]), Number(de4[2]), Number(de4[3])]
    return isValidDate(`${pad2(d)}.${pad2(m)}.${y}`)
      ? null
      : verdict('validate.date.impossible', 'error', params)
  } else if (de2) {
    ;[d, m, y] = [Number(de2[1]), Number(de2[2]), 2000 + Number(de2[3])]
  } else if (word) {
    const month = own(MONTHS, (word[2] ?? '').toLowerCase())
    if (!month) return invalid
    ;[d, m, y] = [Number(word[1]), month, Number(word[3])]
  } else if (slash) {
    // 05/04/2026 reads as May or April; only a first number above 12 is certainly the day.
    if (Number(slash[1]) <= 12) return invalid
    ;[d, m, y] = [Number(slash[1]), Number(slash[2]), Number(slash[3])]
  } else return invalid

  const iso = `${y}-${pad2(m)}-${pad2(d)}`
  if (!isValidDate(iso)) return verdict('validate.date.impossible', 'error', params)
  if (canonical) return null
  // A one-digit ISO date works in the pipeline: warning only; every other notation does not.
  return verdict('validate.date.invalid', iso1 ? 'warning' : 'error', params, iso)
}

const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 } as const
const LENGTH_RE = /^(\d+(?:[.,]\d+)?)\s*(mm|cm|pt|in)?$/i

/** Millimetres of a length written with a unit (a schema bound), or null. */
function toMm(text: string): number | null {
  const m = LENGTH_RE.exec(text)
  if (!m) return null
  const unit = (m[2] ?? 'mm').toLowerCase() as keyof typeof UNIT_MM
  return Number((m[1] ?? '').replace(',', '.')) * UNIT_MM[unit]
}

function checkLength(s: Subject): Verdict | null {
  const params = { value: s.value }
  const m = LENGTH_RE.exec(s.value)
  if (!m) return verdict('validate.length', 'error', params)
  const unit = (m[2] ?? 'mm').toLowerCase()
  const canonical = `${(m[1] ?? '').replace(',', '.')}${unit}`
  // The notation first: after its fix the next check sees the canonical value. Only a space
  // (`15 mm`) is read by the sets as well (memo's own pattern allows it), so that is a warning;
  // a missing unit, an upper-case unit or a decimal comma is not read.
  if (canonical !== s.value) {
    const spaced = s.value.replace(/\s+/g, '') === canonical
    return verdict('validate.length', spaced ? 'warning' : 'error', params, canonical)
  }
  const mm = toMm(canonical)
  if (mm === null) return null
  const max = typeof s.rule.max === 'string' ? s.rule.max : null
  const maxMm = max ? toMm(max) : null
  if (max && maxMm !== null && mm > maxMm + 1e-9) {
    return verdict('validate.length.max', 'warning', { value: s.value, max }, max)
  }
  const min = s.rule.min ?? null
  const minMm = min ? toMm(min) : null
  if (min && minMm !== null && mm < minMm - 1e-9) {
    return verdict('validate.length.min', 'warning', { value: s.value, min }, min)
  }
  return null
}

/** Items of an inline list `[a, b]`, or null when the text is not one. */
function inlineItems(value: string): number | null {
  if (!value.startsWith('[')) return null
  try {
    const v = load(value)
    return Array.isArray(v) ? v.length : null
  } catch {
    return null
  }
}

/** Number of items of a block list: the `- ` lines at the shallowest indent. */
function blockItems(block: readonly string[]): number {
  const indents = block
    .filter((l) => /^[ \t]*-(\s|$)/.test(l))
    .map((l) => l.length - l.trimStart().length)
  if (indents.length === 0) return 0
  const min = Math.min(...indents)
  return indents.filter((i) => i === min).length
}

function checkList(s: Subject): Verdict | null {
  // A block list has an empty value and `- ` lines; an inline list starts with `[`.
  if (s.value === '' || s.value.startsWith('[')) return null
  const needsQuote = /[,[\]{}#:]/.test(s.value) || s.quoted
  const item = needsQuote ? quoteYaml(s.value) : s.value
  const wrapped = `[${item}]`
  return verdict('validate.list', 'error', { value: s.value }, wrapped)
}

function checkLines(s: Subject): Verdict | null {
  const max = typeof s.rule.max === 'number' ? s.rule.max : null
  if (max === null) return null
  const count = s.value === '' ? blockItems(s.entry.block) : (inlineItems(s.value) ?? 1)
  if (count <= max) return null
  return verdict('validate.lines.max', 'error', { count: String(count), max: String(max) })
}

/**
 * Plain scalars YAML reads as something else than text. The readers are build.sh (raw text) and
 * Typst's yaml() (YAML 1.2 core, where `no`, `on`, `12:30` stay text), so the check uses the
 * 1.2 core schema. A set's key is then misread (error); a pipeline key never is, as build.sh
 * passes it on as text, so quoting it is only canonical (warning).
 */
function checkText(s: Subject): Verdict | null {
  if (s.quoted || s.value === '' || /^[[{|>]/.test(s.value)) return null
  let parsed: unknown
  try {
    parsed = load(s.value, { schema: CORE_SCHEMA })
  } catch {
    return null // a syntax matter, not a type matter
  }
  let as: string | null = null
  if (typeof parsed === 'boolean') as = 'bool'
  else if (parsed === null) as = 'null'
  else if (typeof parsed === 'number' && String(parsed) !== s.value) as = 'number'
  if (!as) return null
  const severity = s.pipeline ? 'warning' : 'error'
  return verdict('validate.text.quote', severity, { value: s.value, as }, quoteYaml(s.value))
}

function checkFile(s: Subject): Verdict | null {
  const ext = s.rule.ext
  if (!ext || ext.length === 0) return null
  const lower = s.value.toLowerCase()
  if (ext.some((e) => lower.endsWith(e.toLowerCase()))) return null
  return verdict('validate.file.ext', 'warning', { value: s.value, allowed: ext.join(', ') })
}

function checkName(s: Subject): Verdict | null {
  if (SET_NAME_RE.test(s.value)) return null
  const lower = s.value.toLowerCase()
  return verdict(
    'validate.name',
    'error',
    { value: s.value },
    SET_NAME_RE.test(lower) ? lower : null,
  )
}

const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

function checkLang(s: Subject): Verdict | null {
  if (LANG_RE.test(s.value)) return null
  const [primary = '', ...rest] = s.value.split('-')
  const fixed = [primary.toLowerCase(), ...rest].join('-')
  const suggestion = LANG_RE.test(fixed) ? fixed : null
  return verdict('validate.lang', 'error', { value: s.value }, suggestion)
}

const CHECKS: Record<FieldRule['type'], (s: Subject) => Verdict | null> = {
  text: checkText,
  bool: checkBool,
  enum: checkEnum,
  date: checkDate,
  length: checkLength,
  list: checkList,
  lines: checkLines,
  file: checkFile,
  name: checkName,
  lang: checkLang,
}

function makeFinding(
  code: FindingCode,
  severity: Severity,
  line: number,
  key: string,
  params: Record<string, string>,
  suggestion: string | null,
  changes: TextChange[],
): Finding {
  return {
    id: `${code}:${line}:${key}`,
    code,
    severity,
    line,
    key,
    params,
    suggestion,
    changes,
    preselected: changes.length > 0 && severity !== 'hint',
  }
}

/** The change that replaces a whole key line with `value` written in (comment and `\r` kept). */
function rewriteChange(entry: Entry, value: string): TextChange {
  return {
    from: entry.start,
    to: entry.start + entry.text.length,
    insert: rewriteValue(entry.text, entry.key, value),
  }
}

/** Builds the finding of a verdict: the fix replaces the whole line, comment and `\r` kept. */
function toFinding(entry: Entry, v: Verdict): Finding {
  const changes = v.write === undefined ? [] : [rewriteChange(entry, v.write)]
  return makeFinding(
    v.code,
    v.severity,
    entry.index + 1,
    entry.key,
    v.params,
    v.suggestion,
    changes,
  )
}

/** The value checks of every key the schema knows (the last of duplicates, nested keys skipped). */
function valueFindings(entries: readonly Entry[], schema: Schema): Finding[] {
  const out: Finding[] = []
  for (const entry of lastEntries(entries)) {
    const rule = ruleOf(schema, entry.key)
    if (!rule) continue
    const pipeline = rule === ruleOf(PIPELINE_SCHEMA, entry.key)
    const { lead, value } = splitValue(entry.raw)
    const plain = value.trim()
    const quoted = /^["']/.test(entry.raw.slice(lead.length))
    // Empty values are ignored by the pipeline; a `|`/`>` block scalar is a shape we do not judge.
    if (plain === '' && !(rule.type === 'lines' && entry.block.length > 0)) continue
    if (!quoted && /^[|>]/.test(plain)) continue
    const v = CHECKS[rule.type]({ entry, rule, value: plain, quoted, pipeline })
    if (v) out.push(toFinding(entry, v))
  }
  return out
}

// --- Structure ------------------------------------------------------------------------

/** The header's lines between the fences, `\r` stripped, joined for the YAML parser. */
function headerBody(fm: FrontMatter): string {
  return fm.lines.slice(1, fm.close).map(stripCr).join('\n')
}

/** js-yaml's complaint about `body`, or null. `json: true` keeps duplicates from being one. */
function yamlError(body: string): { line: number; reason: string } | null {
  try {
    load(body, { json: true })
    return null
  } catch (e) {
    if (!(e instanceof YAMLException)) return null
    return { line: (e.mark?.line ?? 0) + 2, reason: e.reason }
  }
}

/**
 * The header is not valid YAML. The usual cause is an unquoted `: ` in a value; when quoting the
 * value of that key line removes the error, that is the fix, otherwise there is none.
 */
function syntaxFindings(fm: FrontMatter, entries: readonly Entry[]): Finding[] {
  const err = yamlError(headerBody(fm))
  if (!err) return []
  // An error at the very end (an unclosed list) points past the last line: clamp into the header.
  const line = Math.min(err.line, fm.close)
  const entry = entries.find((e) => e.index + 1 === line)
  let suggestion: string | null = null
  const changes: TextChange[] = []
  if (entry) {
    const { value } = splitValue(entry.raw)
    const plain = value.trim()
    if (plain !== '' && !/^["'[{|>&*!]/.test(plain)) {
      const fixed = rewriteValue(entry.text, entry.key, quoteYaml(plain))
      const lines = fm.lines.slice(1, fm.close).map(stripCr)
      lines[entry.index - 1] = stripCr(fixed)
      const after = yamlError(lines.join('\n'))
      if (!after || after.line !== err.line) {
        suggestion = quoteYaml(plain)
        changes.push(rewriteChange(entry, suggestion))
      }
    }
  }
  return [
    makeFinding(
      'validate.syntax',
      'error',
      line,
      entry?.key ?? '',
      { reason: err.reason },
      suggestion,
      changes,
    ),
  ]
}

/** A repeated key: every occurrence but the last is dead; the fix deletes it with its block. */
function duplicateFindings(fm: FrontMatter, entries: readonly Entry[]): Finding[] {
  const last = new Map<string, Entry>()
  const first = new Map<string, Entry>()
  for (const e of entries) {
    last.set(e.key, e)
    if (!first.has(e.key)) first.set(e.key, e)
  }
  const out: Finding[] = []
  for (const e of entries) {
    if (last.get(e.key) === e) continue
    const to = fm.starts[e.end] ?? e.start + e.text.length
    out.push(
      makeFinding(
        'validate.duplicate',
        'error',
        e.index + 1,
        e.key,
        { first: String((first.get(e.key)?.index ?? e.index) + 1) },
        null,
        [{ from: e.start, to, insert: '' }],
      ),
    )
  }
  return out
}

/** Damerau-Levenshtein distance (adjacent swaps count once), case-insensitive. */
function distance(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [
    i,
    ...Array<number>(y.length).fill(0),
  ])
  for (let j = 0; j <= y.length; j++) (d[0] as number[])[j] = j
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      const row = d[i] as number[]
      row[j] = Math.min(
        ((d[i - 1] as number[])[j] as number) + 1,
        (row[j - 1] as number) + 1,
        ((d[i - 1] as number[])[j - 1] as number) + cost,
      )
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        row[j] = Math.min(row[j] as number, ((d[i - 2] as number[])[j - 2] as number) + 1)
      }
    }
  }
  return (d[x.length] as number[])[y.length] as number
}

/** The nearest of `candidates` within `max` edits, or null; the first of equals wins. */
function nearest(word: string, candidates: readonly string[], max: number): string | null {
  let best: string | null = null
  let bestDistance = max + 1
  for (const c of candidates) {
    const dist = distance(word, c)
    if (dist < bestDistance) [best, bestDistance] = [c, dist]
  }
  return best
}

/**
 * Keys that look like a misspelt schema key (hint). `x-` keys and distant keys are the user's;
 * so is a schema key with a number appended (`title2`). No hint when the similar key is already
 * in the header: renaming would only make a duplicate.
 */
function typoFindings(entries: readonly Entry[], schema: Schema): Finding[] {
  const known = Object.keys(schema.keys)
  const present = new Set(entries.map((e) => e.key))
  const out: Finding[] = []
  for (const e of lastEntries(entries)) {
    if (e.key.length < 4 || e.key.startsWith('x-') || ruleOf(schema, e.key)) continue
    const stem = e.key.replace(/\d+$/, '')
    if (stem !== e.key && ruleOf(schema, stem)) continue
    const similar = nearest(e.key, known, 2)
    if (!similar || present.has(similar)) continue
    const to = e.start + e.key.length
    out.push(
      makeFinding('validate.key.typo', 'hint', e.index + 1, e.key, { similar }, similar, [
        { from: e.start, to, insert: similar },
      ]),
    )
  }
  return out
}

/** The set the note names must be installed; a near miss is the suggestion. */
function templateFindings(entries: readonly Entry[], sets: readonly string[] | null): Finding[] {
  if (sets === null) return []
  const e = lastEntries(entries).find((x) => x.key === 'template')
  if (!e) return []
  const value = splitValue(e.raw).value.trim()
  if (value === '' || isTypPath(value) || sets.includes(value)) return []
  const similar = nearest(value, sets, 2)
  const changes = similar ? [rewriteChange(e, similar)] : []
  return [
    makeFinding(
      'validate.template.unknown',
      'error',
      e.index + 1,
      'template',
      { value },
      similar,
      changes,
    ),
  ]
}

/** An unresolved `profile:` is an error: the export would stop on it. No automatic fix. */
function profileFindings(entries: readonly Entry[], profile: ProfileLookup | null): Finding[] {
  if (!profile || profile.status === 'found') return []
  const e = lastEntries(entries).find((x) => x.key === 'profile')
  if (!e) return []
  const value = splitValue(e.raw).value.trim()
  if (value === '') return []
  const params: Record<string, string> =
    profile.status === 'missing' ? { value, searched: profile.searched.join('\n') } : { value }
  const code =
    profile.status === 'missing' ? 'validate.profile.missing' : 'validate.profile.invalid'
  return [makeFinding(code, 'error', e.index + 1, 'profile', params, null, [])]
}

/**
 * Two fixes must never touch the same bytes (one transaction applies them all). The first
 * finding in the list keeps its fix; a later one that overlaps loses it and is reported
 * without one, so the user sees it after the first is applied and the note re-checked.
 */
function dropOverlaps(findings: Finding[]): Finding[] {
  const taken: TextChange[] = []
  return findings.map((f) => {
    const clash = f.changes.some((c) => taken.some((t) => c.from < t.to && t.from < c.to))
    if (clash) return { ...f, changes: [], suggestion: null, preselected: false }
    taken.push(...f.changes)
    return f
  })
}

/**
 * The set's header keys the note lacks, appended at the closing fence by `mergeHeader`. Only
 * its insertion is used: `template:` is never rewritten here (a wrong one is its own finding).
 */
function missingKeys(
  note: string,
  header: string | null,
): { missing: string[]; missingChanges: TextChange[] } {
  const none = { missing: [], missingChanges: [] }
  if (header === null) return none
  // mergeHeader's fence test does not know a BOM: hand it the text without and shift back.
  const shift = note.startsWith(BOM) ? BOM.length : 0
  const merged = mergeHeader(note.slice(shift), header, { template: noteSet(note), profile: null })
  if (merged.kind !== 'merged') return none
  const inserts = merged.changes.filter((c) => c.from === c.to)
  return {
    missing: inserts.length > 0 ? merged.added : [],
    missingChanges: inserts.map((c) => ({ ...c, from: c.from + shift, to: c.to + shift })),
  }
}

/** Validates the note's front matter against `ctx.schema`; see the module comment. */
export function validateFrontmatter(note: string, ctx: ValidationContext): ValidationResult {
  const fm = readFrontMatter(note)
  if (fm === 'none') return { kind: 'none' }
  if (fm === 'unclosed') return { kind: 'unclosed' }
  const entries = topLevelEntries(fm)
  // Order = priority when two fixes touch the same line (see dropOverlaps).
  const all = [
    ...duplicateFindings(fm, entries),
    ...valueFindings(entries, ctx.schema),
    ...templateFindings(entries, ctx.sets),
    ...profileFindings(entries, ctx.profile),
    ...typoFindings(entries, ctx.schema),
    ...syntaxFindings(fm, entries),
  ]
  const findings = dropOverlaps(all).sort((a, b) => a.line - b.line)
  return { kind: 'checked', findings, ...missingKeys(note, ctx.header) }
}

/**
 * The text changes of the chosen findings (by id) and, when `addMissing`, the missing-key
 * insertion. Findings never overlap (`dropOverlaps`), so the changes apply in any order.
 */
export function selectedChanges(
  result: ValidationResult,
  ids: ReadonlySet<string>,
  addMissing: boolean,
): TextChange[] {
  if (result.kind !== 'checked') return []
  const out = result.findings.filter((f) => ids.has(f.id)).flatMap((f) => f.changes)
  if (addMissing) out.push(...result.missingChanges)
  return out
}

/** Findings that make the pipeline ignore, misread or fail on the note (not warnings, hints). */
export function errorCount(result: ValidationResult): number {
  if (result.kind !== 'checked') return 0
  return result.findings.filter((f) => f.severity === 'error').length
}
