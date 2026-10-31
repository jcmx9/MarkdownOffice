import { describe, expect, it } from 'vitest'
import {
  combineSchemas,
  FIELD_TYPES,
  PIPELINE_SCHEMA,
  parseSchema,
} from '../../../src/core/frontmatter-schema'

const wrap = (rule: string): string => `schema: 1\nkeys:\n  k: ${rule}\n`

describe('parseSchema', () => {
  it('parses a minimal schema', () => {
    expect(parseSchema('schema: 1\nkeys:\n  x-sign: { type: bool }\n')).toEqual({
      ok: true,
      schema: { keys: { 'x-sign': { type: 'bool' } } },
    })
  })

  it('parses every option', () => {
    const r = parseSchema(
      [
        'schema: 1',
        'keys:',
        '  a: { type: enum, values: [x, y] }',
        '  b: { type: date, empty: today }',
        '  c: { type: length, min: 5mm, max: 2.5cm }',
        '  d: { type: lines, max: 6 }',
        '  e: { type: file, ext: [.svg] }',
        '',
      ].join('\n'),
    )
    expect(r).toEqual({
      ok: true,
      schema: {
        keys: {
          a: { type: 'enum', values: ['x', 'y'] },
          b: { type: 'date', empty: 'today' },
          c: { type: 'length', min: '5mm', max: '2.5cm' },
          d: { type: 'lines', max: 6 },
          e: { type: 'file', ext: ['.svg'] },
        },
      },
    })
  })

  it.each(FIELD_TYPES.filter((t) => t !== 'enum'))('accepts type %s', (t) => {
    expect(parseSchema(wrap(`{ type: ${t} }`)).ok).toBe(true)
  })

  it.each([
    ['unknown type', wrap('{ type: colour }'), 'colour'],
    ['enum without values', wrap('{ type: enum }'), "'k'"],
    ['schema 2', 'schema: 2\nkeys: {}\n', '2'],
    ['no keys', 'schema: 1\n', 'keys'],
    ['not YAML', 'schema: [1\nkeys: : :', 'YAML'],
    ['bad key name', 'schema: 1\nkeys:\n  "a b": { type: bool }\n', 'a b'],
    ['length without unit', wrap('{ type: length, max: 25 }'), "'k'"],
    ['lines max as string', wrap("{ type: lines, max: '6' }"), "'k'"],
    ['rule not a map', wrap('bool'), "'k'"],
    ['empty on a non-date', wrap('{ type: bool, empty: none }'), "'k'"],
  ])('rejects %s', (_name, text, mention) => {
    const r = parseSchema(text)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(mention)
  })

  it('rejects a file above 64 KiB', () => {
    expect(parseSchema(`# ${'x'.repeat(70 * 1024)}\nschema: 1\nkeys: {}\n`).ok).toBe(false)
  })
})

describe('combineSchemas', () => {
  it('lets the set rule replace the pipeline rule of the same key', () => {
    const set = parseSchema('schema: 1\nkeys:\n  lang: { type: enum, values: [de, en] }\n')
    if (!set.ok) throw new Error(set.error)
    const c = combineSchemas(PIPELINE_SCHEMA, set.schema)
    expect(c.keys.lang).toEqual({ type: 'enum', values: ['de', 'en'] })
    expect(c.keys.title).toEqual({ type: 'text' })
  })

  it('returns the pipeline keys without a set schema', () => {
    expect(combineSchemas(PIPELINE_SCHEMA, null)).toEqual(PIPELINE_SCHEMA)
  })
})

describe('PIPELINE_SCHEMA', () => {
  it('has exactly the 18 keys of the pipeline with their rules', () => {
    const text = ['template', 'title', 'subtitle', 'toptitle', 'author', 'watermark', 'profile']
    const bool = ['isodate_praefix', 'print_filename', 'embed_source', 'hard_breaks']
    expect(Object.keys(PIPELINE_SCHEMA.keys)).toHaveLength(18)
    for (const k of text) expect(PIPELINE_SCHEMA.keys[k]).toEqual({ type: 'text' })
    expect(PIPELINE_SCHEMA.keys.header).toEqual({ type: 'text', off: true })
    for (const k of bool) expect(PIPELINE_SCHEMA.keys[k]).toEqual({ type: 'bool' })
    expect(PIPELINE_SCHEMA.keys.date).toEqual({ type: 'date', empty: 'none' })
    expect(PIPELINE_SCHEMA.keys.lang).toEqual({ type: 'lang' })
    for (const k of ['toc', 'h1_break']) {
      expect(PIPELINE_SCHEMA.keys[k]).toEqual({ type: 'enum', values: ['auto', 'true', 'false'] })
    }
    expect(PIPELINE_SCHEMA.keys.logo).toEqual({
      type: 'file',
      ext: ['.svg', '.png', '.jpg', '.jpeg'],
    })
    expect(PIPELINE_SCHEMA.keys['logo-height']).toEqual({ type: 'length', max: '25mm' })
  })
})
