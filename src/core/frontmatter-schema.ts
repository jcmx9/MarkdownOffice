import { load } from 'js-yaml'
// One source: the file ships in pipeline/lib/ for set authors and a later MCP server, and is
// bundled here as text so the editor, the CLI and the tests all validate against the same rules.
import pipelineSchemaText from '../../pipeline/lib/frontmatter.schema.yaml?raw'

export type FieldType =
  | 'text'
  | 'bool'
  | 'enum'
  | 'date'
  | 'length'
  | 'list'
  | 'lines'
  | 'file'
  | 'name'
  | 'lang'

export const FIELD_TYPES: readonly FieldType[] = [
  'text',
  'bool',
  'enum',
  'date',
  'length',
  'list',
  'lines',
  'file',
  'name',
  'lang',
]

export interface FieldRule {
  type: FieldType
  /** enum: the allowed values */
  values?: string[]
  /** text: a plain `false` is a value of its own (`header: false`: no header), no quoting slip */
  off?: boolean
  /** date: what an empty value means for the set (documentation only, never a finding) */
  empty?: 'today' | 'none'
  /** length: bounds with a unit (mm, cm, pt, in) */
  min?: string
  /** length: bound with a unit; lines: maximum number of lines */
  max?: string | number
  /** file: allowed extensions, with the dot */
  ext?: string[]
}

export interface Schema {
  /** Look rules up with `ruleOf` (or `Object.hasOwn`): a note may name a key `constructor`. */
  keys: Record<string, FieldRule>
}

export type SchemaLoad = { ok: true; schema: Schema } | { ok: false; error: string }

const KEY_RE = /^[A-Za-z0-9_-]+$/
const LENGTH_RE = /^\d+(\.\d+)?(mm|cm|pt|in)$/
// Set schemas come from files the user may have edited; cap them like the header files.
const MAX_SCHEMA_BYTES = 64 * 1024

const fail = (error: string): SchemaLoad => ({ ok: false, error })
// Key maps without a prototype: a key named `__proto__` or `constructor` (in a schema or a
// note) is a plain entry, never Object.prototype's member.
const keyMap = (): Record<string, FieldRule> => Object.create(null) as Record<string, FieldRule>

/** The schema's own rule of `key`, never an inherited member such as `constructor`. */
export function ruleOf(schema: Schema, key: string): FieldRule | undefined {
  return Object.hasOwn(schema.keys, key) ? schema.keys[key] : undefined
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string')
// YAML reads `[auto, true, false]` as a string and two booleans; an enum lists the spellings a
// note may use, so scalars are taken as their text.
const scalarTexts = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((s) => ['string', 'boolean', 'number'].includes(typeof s))
    ? v.map(String)
    : null

function parseRule(key: string, raw: unknown): FieldRule | string {
  if (!isObject(raw)) return `key '${key}': rule must be a map like { type: bool }`
  const type = raw.type
  if (typeof type !== 'string' || !(FIELD_TYPES as readonly string[]).includes(type)) {
    return `key '${key}': unknown type '${String(type)}'`
  }
  const rule: FieldRule = { type: type as FieldType }
  if (type === 'enum') {
    const values = scalarTexts(raw.values)
    if (!values || values.length === 0) {
      return `key '${key}': enum needs a non-empty values list`
    }
    rule.values = values
  }
  if (raw.off !== undefined) {
    if (type !== 'text' || raw.off !== true) {
      return `key '${key}': off must be true and only applies to text`
    }
    rule.off = true
  }
  if (raw.empty !== undefined) {
    if (type !== 'date' || (raw.empty !== 'today' && raw.empty !== 'none')) {
      return `key '${key}': empty must be today or none and only applies to date`
    }
    rule.empty = raw.empty
  }
  if (type === 'length') {
    for (const bound of ['min', 'max'] as const) {
      const v = raw[bound]
      if (v === undefined) continue
      if (typeof v !== 'string' || !LENGTH_RE.test(v)) {
        return `key '${key}': ${bound} needs a unit (mm, cm, pt, in), like 25mm`
      }
      rule[bound] = v
    }
  } else if (type === 'lines') {
    if (raw.max !== undefined) {
      if (typeof raw.max !== 'number' || !Number.isInteger(raw.max) || raw.max < 1) {
        return `key '${key}': max must be a whole number of lines`
      }
      rule.max = raw.max
    }
  }
  if (type === 'file' && raw.ext !== undefined) {
    if (!isStrings(raw.ext)) return `key '${key}': ext must be a list of extensions`
    rule.ext = raw.ext
  }
  return rule
}

/** Parses a schema file (`schema: 1` + `keys:`); never throws, a broken file is an `error`. */
export function parseSchema(text: string): SchemaLoad {
  if (text.length > MAX_SCHEMA_BYTES) return fail('schema file is larger than 64 KiB')
  let doc: unknown
  try {
    doc = load(text)
  } catch (e) {
    return fail(`schema is not valid YAML: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isObject(doc)) return fail('schema must be a YAML map')
  if (doc.schema !== 1) return fail(`unsupported schema version '${String(doc.schema)}'`)
  if (!isObject(doc.keys)) return fail("schema has no 'keys' map")
  const keys = keyMap()
  for (const [key, raw] of Object.entries(doc.keys)) {
    if (!KEY_RE.test(key)) return fail(`invalid key name '${key}'`)
    const rule = parseRule(key, raw)
    if (typeof rule === 'string') return fail(rule)
    keys[key] = rule
  }
  return { ok: true, schema: { keys } }
}

/** The set's rule replaces the pipeline's rule of the same key (a set may restrict a key). */
export function combineSchemas(pipeline: Schema, set: Schema | null): Schema {
  return { keys: Object.assign(keyMap(), pipeline.keys, set?.keys ?? {}) }
}

function loadPipelineSchema(): Schema {
  const r = parseSchema(pipelineSchemaText)
  if (!r.ok) throw new Error(`pipeline/lib/frontmatter.schema.yaml: ${r.error}`)
  return r.schema
}

export const PIPELINE_SCHEMA: Schema = loadPipelineSchema()
