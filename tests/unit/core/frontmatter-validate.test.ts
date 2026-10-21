import { describe, expect, it } from 'vitest'
import { combineSchemas, PIPELINE_SCHEMA, parseSchema } from '../../../src/core/frontmatter-schema'
import {
  type Finding,
  type FindingCode,
  noteSet,
  quoteYaml,
  rewriteValue,
  topLevelValue,
  type ValidationContext,
  validateFrontmatter,
} from '../../../src/core/frontmatter-validate'
import { applyChanges } from '../../../src/core/header-merge'
import { findingMessage } from '../../../src/core/validate-messages'

const SET = parseSchema(
  [
    'schema: 1',
    'keys:',
    '  x-sign: { type: bool }',
    '  x-attachments: { type: list }',
    '  x-to: { type: lines, max: 6 }',
    '  zip: { type: text }',
    '  lang: { type: enum, values: [de, en] }',
    '',
  ].join('\n'),
)
if (!SET.ok) throw new Error(SET.error)

const pipelineCtx: ValidationContext = {
  schema: PIPELINE_SCHEMA,
  sets: null,
  header: null,
  profile: null,
}
const setCtx: ValidationContext = {
  ...pipelineCtx,
  schema: combineSchemas(PIPELINE_SCHEMA, SET.schema),
}
// lang is restricted by the set only in its own context
const langSetCtx: ValidationContext = {
  ...pipelineCtx,
  schema: combineSchemas(PIPELINE_SCHEMA, {
    keys: { lang: { type: 'enum', values: ['de', 'en'] } },
  }),
}

const note = (...lines: string[]): string => `---\n${lines.join('\n')}\n---\n\nBody\n`

function check(text: string, ctx: ValidationContext = pipelineCtx): Finding[] {
  const r = validateFrontmatter(text, ctx)
  if (r.kind !== 'checked') throw new Error(`not checked: ${r.kind}`)
  return r.findings
}

function one(line: string, ctx: ValidationContext = pipelineCtx): Finding {
  const found = check(note(line), ctx)
  expect(found, line).toHaveLength(1)
  return found[0] as Finding
}

describe('result kinds', () => {
  it('reports none and unclosed', () => {
    expect(validateFrontmatter('Just text\n', pipelineCtx)).toEqual({ kind: 'none' })
    expect(validateFrontmatter('---\ntoc: ja\n', pipelineCtx)).toEqual({ kind: 'unclosed' })
  })

  it('returns an empty checked result for a clean header', () => {
    expect(validateFrontmatter(note('toc: auto'), pipelineCtx)).toEqual({
      kind: 'checked',
      findings: [],
      missing: [],
      missingChanges: [],
    })
  })
})

describe('bool', () => {
  it.each([
    ['isodate_praefix: ja', pipelineCtx, 'true'],
    ['x-sign: nein', setCtx, 'false'],
    ['embed_source: 1', pipelineCtx, 'true'],
  ])('%s is an error', (line, ctx, suggestion) => {
    const f = one(line, ctx)
    expect(f.code).toBe('validate.bool')
    expect(f.severity).toBe('error')
    expect(f.suggestion).toBe(suggestion)
    expect(f.preselected).toBe(true)
    const key = line.split(':')[0]
    expect(applyChanges(note(line), f.changes)).toBe(note(`${key}: ${suggestion}`))
  })

  it.each([
    ['print_filename: Yes', 'true'],
    ['hard_breaks: OFF', 'false'],
  ])('%s is a warning', (line, suggestion) => {
    const f = one(line)
    expect(f.code).toBe('validate.bool')
    expect(f.severity).toBe('warning')
    expect(f.suggestion).toBe(suggestion)
  })

  it('has no fix for an unknown word', () => {
    const f = one('hard_breaks: maybe')
    expect(f.severity).toBe('error')
    expect(f.suggestion).toBeNull()
    expect(f.changes).toEqual([])
    expect(f.preselected).toBe(false)
  })

  it('accepts true and false', () => {
    expect(check(note('hard_breaks: true', 'embed_source: false'))).toEqual([])
  })
})

describe('enum', () => {
  it('maps ja to true as an error', () => {
    const f = one('toc: ja')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.enum', 'error', 'true'])
  })

  it('lower-cases a wrongly capitalised value', () => {
    const f = one('toc: Auto')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.enum', 'error', 'auto'])
  })

  it('takes yes as a warning', () => {
    const f = one('toc: yes')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.enum', 'warning', 'true'])
  })

  it('has no fix for an unknown value', () => {
    const f = one('toc: sometimes')
    expect([f.severity, f.suggestion, f.changes]).toEqual(['error', null, []])
    expect(f.params.allowed).toBe('auto, true, false')
  })

  it('checks a set enum (lang)', () => {
    const f = one('lang: fr', langSetCtx)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.enum', 'error', null])
  })
})

describe('date', () => {
  it.each([
    ['date: 20.10.26', '2026-10-20'],
    ['date: 20. Oktober 2026', '2026-10-20'],
    ['date: 5. Mrz 2026', '2026-03-05'],
    ['date: 5. März 2026', '2026-03-05'],
    ['date: 13/10/2026', '2026-10-13'],
  ])('%s is an error with a suggestion', (line, iso) => {
    const f = one(line)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.date.invalid', 'error', iso])
    expect(applyChanges(note(line), f.changes)).toBe(note(`date: ${iso}`))
  })

  it('takes a one-digit ISO date as a warning', () => {
    const f = one('date: 2026-1-5')
    expect([f.code, f.severity, f.suggestion]).toEqual([
      'validate.date.invalid',
      'warning',
      '2026-01-05',
    ])
  })

  it('does not guess an ambiguous D/M/YYYY', () => {
    const f = one('date: 05/04/2026')
    expect([f.code, f.severity, f.suggestion, f.changes]).toEqual([
      'validate.date.invalid',
      'error',
      null,
      [],
    ])
  })

  it.each(['date: 31.04.2026', 'date: 2026-02-30'])('%s is impossible', (line) => {
    const f = one(line)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.date.impossible', 'error', null])
  })

  it('reports an impossible day behind a convertible notation', () => {
    expect(one('date: 31.04.26').code).toBe('validate.date.impossible')
  })

  it.each(['date: 13.10.2026', 'date: ""', 'date:', "date: ''", 'date: 2026-10-13'])(
    '%s is fine',
    (line) => {
      expect(check(note(line))).toEqual([])
    },
  )

  it('has no suggestion for free text', () => {
    const f = one('date: tomorrow')
    expect([f.code, f.suggestion]).toEqual(['validate.date.invalid', null])
  })
})

describe('length', () => {
  it.each([
    ['logo-height: 15 mm', '15mm'],
    ['logo-height: 15', '15mm'],
    ['logo-height: 1,5cm', '1.5cm'],
  ])('%s is written canonically', (line, suggestion) => {
    const f = one(line)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.length', 'error', suggestion])
    expect(applyChanges(note(line), f.changes)).toBe(note(`logo-height: ${suggestion}`))
  })

  it('warns when over the maximum', () => {
    const f = one('logo-height: 30mm')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.length.max', 'warning', '25mm'])
  })

  it('compares in millimetres across units', () => {
    expect(check(note('logo-height: 2.5cm'))).toEqual([])
    expect(one('logo-height: 2in').code).toBe('validate.length.max')
  })

  it('has no fix for words', () => {
    const f = one('logo-height: big')
    expect([f.code, f.severity, f.suggestion, f.changes]).toEqual([
      'validate.length',
      'error',
      null,
      [],
    ])
  })

  it('accepts a value in range', () => {
    expect(check(note('logo-height: 15mm'))).toEqual([])
  })
})

describe('list and lines', () => {
  it('wraps a scalar into an inline list', () => {
    const f = one('x-attachments: Angebot', setCtx)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.list', 'error', '[Angebot]'])
    expect(applyChanges(note('x-attachments: Angebot'), f.changes)).toBe(
      note('x-attachments: [Angebot]'),
    )
  })

  it('accepts inline and block lists', () => {
    expect(check(note('x-attachments: [A, B]'), setCtx)).toEqual([])
    expect(check(note('x-attachments:', '  - A', '  - B'), setCtx)).toEqual([])
  })

  it('flags more block items than max', () => {
    const items = Array.from({ length: 7 }, (_, i) => `  - Line ${i + 1}`)
    const f = one(
      note('x-to:', ...items)
        .split('---\n')[1]
        ?.trimEnd() ?? '',
      setCtx,
    )
    expect([f.code, f.severity, f.suggestion, f.changes]).toEqual([
      'validate.lines.max',
      'error',
      null,
      [],
    ])
    expect(f.params).toMatchObject({ count: '7', max: '6' })
  })

  it('accepts exactly max items', () => {
    const items = Array.from({ length: 6 }, (_, i) => `  - Line ${i + 1}`)
    expect(check(note('x-to:', ...items), setCtx)).toEqual([])
  })

  it('counts the items of an inline list', () => {
    expect(check(note('x-to: [1, 2, 3, 4, 5, 6, 7]'), setCtx)[0]?.code).toBe('validate.lines.max')
  })

  it('does not count nested items of an item', () => {
    const lines = ['x-to:', ...['a', 'b'].flatMap((s) => [`  - ${s}`, '    - nested'])]
    expect(check(note(...lines), setCtx)).toEqual([])
  })
})

describe('text', () => {
  it.each([
    ['title: no', pipelineCtx, '"no"'],
    ['zip: 01067', setCtx, '"01067"'],
    ['subtitle: ~', pipelineCtx, '"~"'],
  ])('%s is read as another type', (line, ctx, suggestion) => {
    const f = one(line, ctx)
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.text.quote', 'error', suggestion])
    const key = line.split(':')[0]
    expect(applyChanges(note(line), f.changes)).toBe(note(`${key}: ${suggestion}`))
  })

  it.each(['title: 2026', 'author: [Anna, Ben]', 'title: "no"', "title: 'no'", 'title: Hello'])(
    '%s is fine',
    (line) => {
      expect(check(note(line))).toEqual([])
    },
  )

  it('keeps the comment of a rewritten value', () => {
    const text = note('title: no   # shown on top')
    const f = one('title: no   # shown on top')
    expect(applyChanges(text, f.changes)).toBe(note('title: "no" # shown on top'))
  })
})

describe('file, name, lang', () => {
  it('warns about a wrong logo extension', () => {
    const f = one('logo: firma.gif')
    expect([f.code, f.severity, f.suggestion, f.changes]).toEqual([
      'validate.file.ext',
      'warning',
      null,
      [],
    ])
  })

  it('accepts a logo with an allowed extension in any case', () => {
    expect(check(note('logo: Firma.SVG'))).toEqual([])
  })

  it('suggests the lower-case language', () => {
    const f = one('lang: DE')
    expect([f.code, f.severity, f.suggestion]).toEqual(['validate.lang', 'error', 'de'])
  })

  it('has no fix for de_DE', () => {
    const f = one('lang: de_DE')
    expect([f.code, f.suggestion]).toEqual(['validate.lang', null])
  })

  it('accepts de and de-AT', () => {
    expect(check(note('lang: de'))).toEqual([])
    expect(check(note('lang: de-AT'))).toEqual([])
  })

  it('checks a name key', () => {
    const ctx: ValidationContext = {
      ...pipelineCtx,
      schema: { keys: { 'x-set': { type: 'name' } } },
    }
    expect(one('x-set: Memo', ctx).code).toBe('validate.name')
    expect(check(note('x-set: memo-2'), ctx)).toEqual([])
  })
})

describe('structure of the findings', () => {
  it('numbers lines from the opening fence and builds stable ids', () => {
    const text = note('title: Hi', 'toc: ja')
    const f = check(text)[0] as Finding
    expect(f.line).toBe(3)
    expect(f.key).toBe('toc')
    expect(f.id).toBe('validate.enum:3:toc')
    expect(check(text)[0]?.id).toBe(f.id)
  })

  it('checks only the last of duplicate keys', () => {
    const found = check(note('toc: ja', 'toc: auto'))
    expect(found).toEqual([])
    expect(check(note('toc: auto', 'toc: ja'))[0]?.line).toBe(3)
  })

  it('ignores keys not in the schema and nested keys', () => {
    expect(check(note('x-other: whatever', 'map:', '  toc: ja', '  title: no'))).toEqual([])
  })

  it('ignores an empty value and a block scalar', () => {
    expect(check(note('toc:', 'hard_breaks: ""', 'title: |', '  no'))).toEqual([])
  })

  it('preselects only findings with a fix', () => {
    const [a, b] = check(note('toc: ja', 'toc2: x', 'hard_breaks: maybe'))
    expect(a?.preselected).toBe(true)
    expect(b?.preselected).toBe(false)
  })

  it('keeps CRLF per line and the BOM', () => {
    const text = '﻿---\r\ntitle: Hi\r\ntoc: Auto  # c\r\nlang: DE\n---\r\n\r\nBody\r\n'
    const found = check(text)
    expect(found.map((f) => f.line)).toEqual([3, 4])
    expect(
      applyChanges(
        text,
        found.flatMap((f) => f.changes),
      ),
    ).toBe('﻿---\r\ntitle: Hi\r\ntoc: auto  # c\r\nlang: de\n---\r\n\r\nBody\r\n')
  })

  it('does not touch the bytes around a fix', () => {
    const text = note('title: A', 'toc: ja', 'title2: B')
    const f = check(text)[0] as Finding
    expect(applyChanges(text, f.changes)).toBe(note('title: A', 'toc: true', 'title2: B'))
  })
})

describe('helpers', () => {
  it('rewriteValue keeps the comment column and the CR', () => {
    expect(rewriteValue('toc: Auto   # auto, true, false\r', 'toc', 'auto')).toBe(
      'toc: auto   # auto, true, false\r',
    )
  })

  it('rewriteValue never cuts quoted text and keeps the comment column', () => {
    const line = 'title: "A # B"   # c'
    const out = rewriteValue(line, 'title', '"no"')
    expect(out).toBe('title: "no"      # c')
    expect(out.indexOf('# c')).toBe(line.indexOf('# c'))
  })

  it('rewriteValue leaves other lines alone', () => {
    expect(rewriteValue('subtitle: x', 'title', 'y')).toBe('subtitle: x')
  })

  it('quoteYaml double-quotes and escapes', () => {
    expect(quoteYaml('no')).toBe('"no"')
    expect(quoteYaml('a"b\\c')).toBe('"a\\"b\\\\c"')
  })

  it('topLevelValue returns the last unquoted value without comment', () => {
    const text = note('template: "a"', 'template: memo   # set', 'map:', '  template: no')
    expect(topLevelValue(text, 'template')).toBe('memo')
    expect(topLevelValue(text, 'missing')).toBeNull()
    expect(topLevelValue('no front matter', 'template')).toBeNull()
    expect(topLevelValue(note('template:'), 'template')).toBe('')
  })

  it('noteSet falls back to the default set', () => {
    expect(noteSet(note('template: din5008a'))).toBe('din5008a')
    expect(noteSet(note('template:'))).toBe('memo')
    expect(noteSet(note('title: x'))).toBe('memo')
    expect(noteSet('plain')).toBe('memo')
    expect(noteSet(note('template: ./my.typ'))).toBe('')
  })
})

describe('findingMessage', () => {
  const codes: FindingCode[] = [
    'validate.syntax',
    'validate.duplicate',
    'validate.bool',
    'validate.enum',
    'validate.date.invalid',
    'validate.date.impossible',
    'validate.length',
    'validate.length.max',
    'validate.list',
    'validate.lines.max',
    'validate.text.quote',
    'validate.file.ext',
    'validate.name',
    'validate.lang',
    'validate.template.unknown',
    'validate.profile.missing',
    'validate.profile.invalid',
    'validate.key.typo',
  ]
  it.each(codes)('%s has a German message', (code) => {
    const msg = findingMessage({
      id: 'x',
      code,
      severity: 'error',
      line: 2,
      key: 'k',
      params: {},
      suggestion: null,
      changes: [],
      preselected: false,
    })
    expect(msg.length).toBeGreaterThan(5)
    expect(msg).not.toContain('undefined')
  })
})
