import { CORE_SCHEMA, load } from 'js-yaml'
import type { FlatValue } from './flat-yaml'
import { formatDate, isoDate } from './format-date'

/**
 * A set's `<name>.preview.yaml`: which head and foot blocks the editor preview shows, filled from
 * the note's front matter and the sender profile. Parsed strictly (a broken file falls back to the
 * built-in memo blocks with one notice), resolved into plain-text blocks the renderer inserts as
 * text, never as HTML.
 */

export const PREVIEW_ELEMENT_KEYS = [
  'class',
  'text',
  'parts',
  'sep',
  'lines',
  'image',
  'width',
  'label',
  'today',
  'when',
] as const

export interface PreviewElement {
  class: string
  text?: string
  parts?: string[]
  sep?: string
  lines?: string
  image?: string
  width?: string
  label?: string | Record<string, string>
  today: boolean
  when: string[]
}

export interface PreviewSpec {
  head: PreviewElement[]
  foot: PreviewElement[]
}

/** memo's title block as it was hard-wired before sets could describe it ("date · author"). */
export const MEMO_PREVIEW: PreviewSpec = {
  head: [
    { class: 'toptitle', text: '{toptitle}', today: false, when: [] },
    { class: 'title', text: '{title}', today: false, when: [] },
    { class: 'subtitle', text: '{subtitle}', today: false, when: [] },
    { class: 'meta', parts: ['{date}', '{author}'], sep: ' · ', today: false, when: ['{author}'] },
  ],
  foot: [],
}

const CONTENT_KEYS = ['text', 'parts', 'lines', 'image'] as const
// The only image main reads (and checks: bare .svg next to the profile, size limit).
const SIGNATURE = '{profile.signature}'
const CLASS_RE = /^[a-z0-9-]+$/

type Parsed = { ok: true; spec: PreviewSpec } | { ok: false; error: string }

const isMap = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const isStrings = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((s) => typeof s === 'string')

/** Checks one element; returns it normalised or a German error (shown in the notice). */
function parseElement(raw: unknown, at: string): PreviewElement | string {
  if (!isMap(raw)) return `${at}: Eintrag muss eine Zuordnung (key: value) sein`
  for (const k of Object.keys(raw))
    if (!(PREVIEW_ELEMENT_KEYS as readonly string[]).includes(k))
      return `${at}: unbekannter Schlüssel „${k}"`
  const cls = raw.class
  if (typeof cls !== 'string' || !CLASS_RE.test(cls))
    return `${at}: „class" muss aus a–z, 0–9 und - bestehen`
  const content = CONTENT_KEYS.filter((k) => k in raw)
  if (content.length !== 1) return `${at}: genau eins von „text", „parts", „lines", „image" angeben`
  const el: PreviewElement = { class: cls, today: false, when: [] }
  for (const k of ['text', 'lines', 'sep', 'width'] as const) {
    if (!(k in raw)) continue
    const val = raw[k]
    if (typeof val !== 'string')
      return `${at}: „${k}" muss ein Text sein (ggf. in Anführungszeichen)`
    el[k] = val
  }
  if ('image' in raw) {
    if (raw.image !== SIGNATURE) return `${at}: „image" erlaubt nur "${SIGNATURE}"`
    el.image = SIGNATURE
  }
  if ('parts' in raw) {
    if (!isStrings(raw.parts)) return `${at}: „parts" muss eine Liste von Texten sein`
    el.parts = raw.parts
  }
  if ('label' in raw) {
    const label = raw.label
    if (typeof label === 'string') el.label = label
    else if (
      isMap(label) &&
      Object.keys(label).length > 0 &&
      Object.values(label).every((s) => typeof s === 'string')
    )
      el.label = label as Record<string, string>
    else return `${at}: „label" muss ein Text oder eine Zuordnung Sprache → Text sein`
  }
  if ('today' in raw) {
    if (typeof raw.today !== 'boolean') return `${at}: „today" muss true oder false sein`
    el.today = raw.today
  }
  if ('when' in raw) {
    const when = raw.when
    if (typeof when === 'string') el.when = [when]
    else if (isStrings(when)) el.when = when
    else return `${at}: „when" muss ein Text oder eine Liste von Texten sein`
  }
  return el
}

/** Parses a `<name>.preview.yaml`; any deviation from the grammar refuses the whole file. */
export function parsePreviewSpec(text: string): Parsed {
  let doc: unknown
  try {
    // CORE_SCHEMA: YAML 1.2 core types only, like the YAML check (no `yes`/`no` booleans).
    doc = load(text, { schema: CORE_SCHEMA })
  } catch (e) {
    return {
      ok: false,
      error: `kein gültiges YAML: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
    }
  }
  if (!isMap(doc)) return { ok: false, error: 'oberste Ebene muss eine Zuordnung sein' }
  for (const k of Object.keys(doc))
    if (k !== 'preview' && k !== 'head' && k !== 'foot')
      return { ok: false, error: `unbekannter Schlüssel „${k}" (erlaubt: preview, head, foot)` }
  if (doc.preview !== 1)
    return { ok: false, error: '„preview: 1" fehlt oder hat eine unbekannte Version' }
  const spec: PreviewSpec = { head: [], foot: [] }
  for (const part of ['head', 'foot'] as const) {
    const list = doc[part]
    if (list === undefined || list === null) continue
    if (!Array.isArray(list)) return { ok: false, error: `„${part}" muss eine Liste sein` }
    for (const [i, raw] of list.entries()) {
      const el = parseElement(raw, `${part}[${i + 1}]`)
      if (typeof el === 'string') return { ok: false, error: el }
      spec[part].push(el)
    }
  }
  return { ok: true, spec }
}

export interface PreviewValues {
  fm: Record<string, FlatValue>
  profile: Record<string, string>
  today: Date
  signature: boolean
}

export type PreviewBlock =
  | { cls: string; kind: 'text'; text: string; label: string | null }
  | { cls: string; kind: 'lines'; lines: string[]; label: string | null }
  | { cls: string; kind: 'image'; width: string | null }

const PLACEHOLDER_RE = /\{(profile\.)?([A-Za-z0-9_-]+)(?:\|([^}]*))?\}/g
const WIDTH_RE = /^\d+(\.\d+)?(mm|pt|cm|in)$/
// `when:` reads booleans from source text (front matter is flat source text, not typed YAML).
const FALSE_RE = /^(false|False|FALSE)$/

const isEmpty = (x: FlatValue) =>
  Array.isArray(x) ? x.every((s) => s.trim() === '') : x.trim() === ''
const asText = (x: FlatValue) =>
  Array.isArray(x) ? x.filter((s) => s.trim() !== '').join(', ') : x

interface Ctx {
  v: PreviewValues
  lang: string
  today: boolean
}

/** One placeholder's value; lists stay lists so `lines:` can use them item by item. */
function lookup(profile: boolean, key: string, def: string | undefined, c: Ctx): FlatValue {
  const { fm } = c.v
  let val: FlatValue
  if (profile) {
    // Generic note override `x-profile-<key>` (din5008a's convention); never for the signature,
    // which main resolves to a file next to the profile.
    const over = key === 'signature' ? undefined : fm[`x-profile-${key}`]
    val = over !== undefined && !isEmpty(over) ? asText(over) : (c.v.profile[key] ?? '')
  } else if (key === 'date') {
    val = formatDate(asText(fm.date ?? ''), c.lang)
    if (val.trim() === '' && c.today) val = formatDate(isoDate(c.v.today), c.lang)
  } else val = fm[key] ?? ''
  return isEmpty(val) && def !== undefined ? def : val
}

/** Replaces every placeholder; `found`/`filled` say whether any existed and any had a value. */
function fill(template: string, c: Ctx): { text: string; found: boolean; filled: boolean } {
  let found = false
  let filled = false
  const text = template.replace(
    PLACEHOLDER_RE,
    (_m, p: string | undefined, key: string, def?: string) => {
      found = true
      const val = lookup(p !== undefined, key, def, c)
      if (!isEmpty(val)) filled = true
      return asText(val)
    },
  )
  return { text, found, filled }
}

function holds(cond: string, c: Ctx): boolean {
  for (const m of cond.matchAll(PLACEHOLDER_RE)) {
    const val = lookup(m[1] !== undefined, m[2] as string, m[3], c)
    if (isEmpty(val)) return false
    if (!Array.isArray(val) && FALSE_RE.test(val.trim())) return false
  }
  return true
}

function pickLabel(label: PreviewElement['label'], lang: string): string | null {
  if (label === undefined) return null
  if (typeof label === 'string') return label
  return label[lang] ?? label.de ?? Object.values(label)[0] ?? null
}

function resolveOne(el: PreviewElement, c: Ctx): PreviewBlock | null {
  if (!el.when.every((w) => holds(w, c))) return null
  const label = pickLabel(el.label, c.lang)
  if (el.image !== undefined) {
    if (!c.v.signature) return null
    const width = el.width === undefined ? null : fill(el.width, c).text.trim()
    return { cls: el.class, kind: 'image', width: width && WIDTH_RE.test(width) ? width : null }
  }
  if (el.lines !== undefined) {
    // A list value that makes up the whole `lines:` gives one line per item.
    const whole = /^\{(profile\.)?([A-Za-z0-9_-]+)(?:\|([^}]*))?\}$/.exec(el.lines.trim())
    const val = whole ? lookup(whole[1] !== undefined, whole[2] as string, whole[3], c) : null
    const lines = (Array.isArray(val) ? val : fill(el.lines, c).text.split('\n'))
      .map((l) => l.trim())
      .filter((l) => l !== '')
    return lines.length ? { cls: el.class, kind: 'lines', lines, label } : null
  }
  if (el.parts !== undefined) {
    const filled = el.parts.map((p) => fill(p, c))
    if (filled.some((f) => f.found) && !filled.some((f) => f.filled)) return null
    const text = filled
      .map((f) => f.text.trim())
      .filter((t) => t !== '')
      .join(el.sep ?? ' ')
    return text ? { cls: el.class, kind: 'text', text, label } : null
  }
  const f = fill(el.text ?? '', c)
  if (f.found && !f.filled) return null
  const text = f.text.trim()
  return text ? { cls: el.class, kind: 'text', text, label } : null
}

/** Resolves a head or foot description against one note; omitted elements leave no trace. */
export function resolveBlocks(
  elements: readonly PreviewElement[],
  v: PreviewValues,
): PreviewBlock[] {
  const rawLang = v.fm.lang
  const lang =
    (typeof rawLang === 'string' ? rawLang : '').split('-')[0]?.trim().toLowerCase() || 'de'
  const out: PreviewBlock[] = []
  for (const el of elements) {
    const b = resolveOne(el, { v, lang, today: el.today })
    if (b) out.push(b)
  }
  return out
}
