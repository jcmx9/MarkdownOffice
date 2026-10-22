import { describe, expect, it } from 'vitest'
import { type FlatValue, readFlatYaml } from '../../../src/core/flat-yaml'
import {
  MEMO_PREVIEW,
  type PreviewElement,
  type PreviewSpec,
  parsePreviewSpec,
  resolveBlocks,
} from '../../../src/core/preview-spec'

// The din5008a description from the spec's contract section, verbatim.
const SPEC_EXAMPLE = `preview: 1
head:                       # replaces the front matter in preview (header hidden) and Present
  - class: sender           # rendered as .mdo-tb-sender
    parts: ["{profile.name}", "{profile.street}", "{profile.zip} {profile.city}"]
    sep: " · "
  - class: address
    lines: "{x-to}"         # a list value → one line each; a string → split at newlines
  - class: date
    text: "{date}"          # ISO or D.M.YYYY → long form by lang
    today: true             # empty → today (din5008a like its PDF; memo leaves it out)
  - class: subject
    text: "{x-subject}"
foot:                       # fixed after the last line of the body
  - class: closing
    text: "{x-closing}"
  - class: signature
    image: "{profile.signature}"   # a file name next to the profile (SVG only)
    width: "{profile.signature-width|40mm}"
    when: ["{x-closing}", "{x-sign}"]
  - class: signer
    text: "{profile.name}"
    when: "{x-closing}"
  - class: attachments
    label: { de: "Anlagen:", en: "Enclosures:" }
    lines: "{x-attachments}"
    when: "{x-closing}"
`

const today = new Date(2026, 9, 22)
const v = (
  fm: Record<string, FlatValue>,
  profile: Record<string, string> = {},
  signature = false,
) => ({
  fm,
  profile,
  today,
  signature,
})
const el = (e: Partial<PreviewElement>): PreviewElement => ({
  class: 'x',
  today: false,
  when: [],
  ...e,
})

function example(): PreviewSpec {
  const r = parsePreviewSpec(SPEC_EXAMPLE)
  if (!r.ok) throw new Error(r.error)
  return r.spec
}

describe('resolveBlocks', () => {
  it('memo built-in reproduces the old title block', () => {
    expect(
      resolveBlocks(
        MEMO_PREVIEW.head,
        v({
          toptitle: 'Muster GmbH',
          title: 'Kickoff',
          subtitle: 'Protokoll',
          author: ['Anna', 'Ben'],
          date: '2026-10-14',
        }),
      ),
    ).toEqual([
      { cls: 'toptitle', kind: 'text', text: 'Muster GmbH', label: null },
      { cls: 'title', kind: 'text', text: 'Kickoff', label: null },
      { cls: 'subtitle', kind: 'text', text: 'Protokoll', label: null },
      { cls: 'meta', kind: 'text', text: '14. Oktober 2026 · Anna, Ben', label: null },
    ])
    expect(resolveBlocks(MEMO_PREVIEW.head, v({ title: 'X', date: '2026-10-14' }))).toEqual([
      { cls: 'title', kind: 'text', text: 'X', label: null },
    ])
    expect(resolveBlocks(MEMO_PREVIEW.head, v({ date: '2026-10-14' }))).toEqual([])
    expect(MEMO_PREVIEW.foot).toEqual([])
  })

  it('drops empty parts without dangling separators', () => {
    const [sender] = example().head
    const profile = { name: 'A', street: '', zip: '01067', city: 'Dresden' }
    expect(resolveBlocks([sender as PreviewElement], v({}, profile))).toEqual([
      { cls: 'sender', kind: 'text', text: 'A · 01067 Dresden', label: null },
    ])
    expect(resolveBlocks([sender as PreviewElement], v({}, {}))).toEqual([])
  })

  it('lines: a list value gives one line each, a string splits at newlines', () => {
    const address = example().head[1] as PreviewElement
    expect(
      resolveBlocks([address], v({ 'x-to': ['Firma X', 'Straße 1', '01067 Dresden'] })),
    ).toEqual([
      {
        cls: 'address',
        kind: 'lines',
        lines: ['Firma X', 'Straße 1', '01067 Dresden'],
        label: null,
      },
    ])
    expect(resolveBlocks([address], v({ 'x-to': 'Firma X\n\nStraße 1\n' }))).toEqual([
      { cls: 'address', kind: 'lines', lines: ['Firma X', 'Straße 1'], label: null },
    ])
    expect(resolveBlocks([address], v({ 'x-to': '' }))).toEqual([])
    // Inside a longer line a list is stringified like everywhere else.
    expect(resolveBlocks([el({ lines: 'An: {x-to}' })], v({ 'x-to': ['A', 'B'] }))).toEqual([
      { cls: 'x', kind: 'lines', lines: ['An: A, B'], label: null },
    ])
  })

  it('date: empty stays empty unless today: true', () => {
    const date = example().head[2] as PreviewElement
    expect(resolveBlocks([date], v({}))).toEqual([
      { cls: 'date', kind: 'text', text: '22. Oktober 2026', label: null },
    ])
    expect(resolveBlocks([date], v({ lang: 'en-GB' }))).toEqual([
      { cls: 'date', kind: 'text', text: 'October 22, 2026', label: null },
    ])
    expect(resolveBlocks([date], v({ date: '3.1.2026' }))).toEqual([
      { cls: 'date', kind: 'text', text: '3. Januar 2026', label: null },
    ])
    expect(resolveBlocks([{ ...date, today: false }], v({}))).toEqual([])
  })

  it('profile values are overridden by x-profile-<key>, never signature', () => {
    const [sender] = example().head
    const profile = {
      name: 'A',
      street: 'S 1',
      zip: '01067',
      city: 'Dresden',
      signature: 'sig.svg',
    }
    expect(
      resolveBlocks([sender as PreviewElement], v({ 'x-profile-city': 'Leipzig' }, profile)),
    ).toEqual([{ cls: 'sender', kind: 'text', text: 'A · S 1 · 01067 Leipzig', label: null }])
    expect(
      resolveBlocks(
        [el({ text: '{profile.signature}' })],
        v({ 'x-profile-signature': 'evil.svg' }, profile),
      ),
    ).toEqual([{ cls: 'x', kind: 'text', text: 'sig.svg', label: null }])
    // An empty override does not hide the profile value.
    expect(
      resolveBlocks([el({ text: '{profile.city}' })], v({ 'x-profile-city': '' }, profile)),
    ).toEqual([{ cls: 'x', kind: 'text', text: 'Dresden', label: null }])
  })

  it('when: false-words and empty values do not hold', () => {
    const { foot } = example()
    const profile = { name: 'Anna' }
    const signed = (sign: string) =>
      resolveBlocks(
        foot,
        v({ 'x-closing': 'Mit freundlichen Grüßen', 'x-sign': sign }, profile, true),
      )
    expect(signed('true').map((b) => b.cls)).toEqual(['closing', 'signature', 'signer'])
    for (const no of ['false', 'FALSE', 'False', ''])
      expect(signed(no).map((b) => b.cls)).toEqual(['closing', 'signer'])
    expect(
      resolveBlocks(
        foot,
        v({ 'x-closing': '', 'x-sign': 'true', 'x-attachments': ['A'] }, profile, true),
      ),
    ).toEqual([])
    // A pure literal is always shown; a list holds when non-empty.
    expect(resolveBlocks([el({ text: 'fix' })], v({}))).toEqual([
      { cls: 'x', kind: 'text', text: 'fix', label: null },
    ])
    expect(resolveBlocks([el({ text: 'fix', when: ['{a}'] })], v({ a: [] }))).toEqual([])
    expect(resolveBlocks([el({ text: 'fix', when: ['{a}'] })], v({ a: ['1'] }))).toHaveLength(1)
  })

  it('image only with a signature; width validated with default', () => {
    const sig = example().foot[1] as PreviewElement
    const fm = { 'x-closing': 'Gruß', 'x-sign': 'true' }
    expect(resolveBlocks([sig], v(fm, {}, false))).toEqual([])
    expect(resolveBlocks([sig], v(fm, {}, true))).toEqual([
      { cls: 'signature', kind: 'image', width: '40mm' },
    ])
    expect(resolveBlocks([sig], v(fm, { 'signature-width': '35.5mm' }, true))).toEqual([
      { cls: 'signature', kind: 'image', width: '35.5mm' },
    ])
    expect(resolveBlocks([sig], v(fm, { 'signature-width': 'abc' }, true))).toEqual([
      { cls: 'signature', kind: 'image', width: null },
    ])
    expect(resolveBlocks([{ ...sig, width: undefined }], v(fm, {}, true))).toEqual([
      { cls: 'signature', kind: 'image', width: null },
    ])
  })

  it('label by lang with de and first-entry fallback', () => {
    const att = example().foot[3] as PreviewElement
    const fm = (lang?: string) => ({
      'x-closing': 'Gruß',
      'x-attachments': ['Rechnung'],
      ...(lang ? { lang } : {}),
    })
    const label = (lang?: string) => {
      const [b] = resolveBlocks([att], v(fm(lang)))
      return b && b.kind === 'lines' ? b.label : undefined
    }
    expect(label()).toBe('Anlagen:')
    expect(label('en-US')).toBe('Enclosures:')
    expect(label('fr')).toBe('Anlagen:')
    const noDe = { ...att, label: { en: 'Enclosures:', fr: 'Pièces jointes :' } }
    expect(resolveBlocks([noDe], v(fm('it')))).toEqual([
      { cls: 'attachments', kind: 'lines', lines: ['Rechnung'], label: 'Enclosures:' },
    ])
    expect(resolveBlocks([{ ...att, label: 'Anl.' }], v(fm('en')))).toEqual([
      { cls: 'attachments', kind: 'lines', lines: ['Rechnung'], label: 'Anl.' },
    ])
  })

  it.each([
    '{constructor}',
    '{profile.toString}',
    '{__proto__}',
    '{profile.__proto__}',
    '{hasOwnProperty}',
  ])('prototype-named placeholder %s resolves empty instead of throwing', (ph) => {
    const fm = readFlatYaml('title: X\n')
    expect(resolveBlocks([el({ text: ph })], v(fm, { name: 'A' }))).toEqual([])
    expect(resolveBlocks([el({ lines: ph })], v(fm))).toEqual([])
    expect(resolveBlocks([el({ parts: [ph, '{title}'] })], v(fm))).toEqual([
      { cls: 'x', kind: 'text', text: 'X', label: null },
    ])
    expect(resolveBlocks([el({ text: 'fix', when: [ph] })], v(fm))).toEqual([])
  })

  it('a prototype-named lang falls back to the de label', () => {
    const att = example().foot[3] as PreviewElement
    for (const lang of ['constructor', 'toString', '__proto__'])
      expect(
        resolveBlocks([att], v({ lang, 'x-closing': 'Gruß', 'x-attachments': ['R'] })),
      ).toEqual([{ cls: 'attachments', kind: 'lines', lines: ['R'], label: 'Anlagen:' }])
  })

  it('lines: literals alone do not keep an element whose placeholders are all empty', () => {
    expect(resolveBlocks([el({ lines: 'An: {x-to}' })], v({ 'x-to': '' }))).toEqual([])
    expect(resolveBlocks([el({ lines: 'An: {x-to}' })], v({}))).toEqual([])
    expect(resolveBlocks([el({ lines: 'An:\nfix' })], v({}))).toEqual([
      { cls: 'x', kind: 'lines', lines: ['An:', 'fix'], label: null },
    ])
  })

  it('applies |default and keeps placeholder-like text out of the value', () => {
    expect(resolveBlocks([el({ text: '{x-who|Niemand}' })], v({}))).toEqual([
      { cls: 'x', kind: 'text', text: 'Niemand', label: null },
    ])
    // Values are not re-scanned: a front-matter value that looks like a placeholder stays literal.
    expect(resolveBlocks([el({ text: '{a}' })], v({ a: '{b}', b: 'B' }))).toEqual([
      { cls: 'x', kind: 'text', text: '{b}', label: null },
    ])
  })
})

describe('parsePreviewSpec', () => {
  it.each([
    ['preview: 2\nhead: []'],
    ['preview: 1\nfoo: 1'],
    ['preview: 1\nhead: [{ class: X, text: a }]'],
    ['preview: 1\nhead: [{ class: a, text: a, lines: b }]'],
    ['preview: 1\nhead: [{ class: a, image: "{profile.logo}" }]'],
    ['preview: 1\nhead: [{ class: a, text: a, color: red }]'],
    [': : :'],
    ['- 1'],
    ['head: []'],
    ['preview: 1\nhead: { class: a, text: a }'],
    ['preview: 1\nhead: [{ class: a }]'],
    ['preview: 1\nhead: [{ class: a, parts: [a, [b]] }]'],
    ['preview: 1\nhead: [{ class: a, text: a, today: yes }]'],
    ['preview: 1\nhead: [{ class: a, text: a, when: [1] }]'],
    ['preview: 1\nhead: [{ class: a, text: a, label: { de: [x] } }]'],
  ])('refuses %j', (t) => {
    const r = parsePreviewSpec(t)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).not.toBe('')
  })

  it('parses the spec example (din5008a description) verbatim', () => {
    const r = parsePreviewSpec(SPEC_EXAMPLE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.spec.head).toHaveLength(4)
    expect(r.spec.foot).toHaveLength(4)
    expect(r.spec.head[2]).toEqual({ class: 'date', text: '{date}', today: true, when: [] })
    expect(r.spec.foot[1]).toEqual({
      class: 'signature',
      image: '{profile.signature}',
      width: '{profile.signature-width|40mm}',
      today: false,
      when: ['{x-closing}', '{x-sign}'],
    })
    expect(r.spec.foot[2]?.when).toEqual(['{x-closing}'])
  })

  it('treats a missing head or foot as empty', () => {
    expect(parsePreviewSpec('preview: 1')).toEqual({ ok: true, spec: { head: [], foot: [] } })
  })
})
