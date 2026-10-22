// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { MEMO_PREVIEW, parsePreviewSpec } from '../../../src/core/preview-spec'
import {
  noteBlocks,
  previewSource,
  previewSourceFrom,
  setPreviewSource,
} from '../../../src/renderer/editor/preview-source'
import { createState } from '../../../src/renderer/editor/setup'
import type { PreviewInputs } from '../../../src/shared/types'

// The din5008a example of the spec's contract section.
const LETTER = `preview: 1
head:
  - class: sender
    parts: ["{profile.name}", "{profile.street}", "{profile.zip} {profile.city}"]
    sep: " · "
  - class: address
    lines: "{x-to}"
  - class: date
    text: "{date}"
    today: true
  - class: subject
    text: "{x-subject}"
foot:
  - class: closing
    text: "{x-closing}"
  - class: signature
    image: "{profile.signature}"
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
const SIG = 'data:image/svg+xml;base64,PHN2Zy8+'

const inputs = (over: Partial<PreviewInputs> = {}): PreviewInputs => ({
  set: 'brief',
  css: [],
  preview: null,
  profile: {},
  signature: null,
  ...over,
})

describe('previewSourceFrom', () => {
  it('built-in for null inputs and set ""', () => {
    expect(previewSourceFrom(null)).toEqual({ source: null, problem: null })
    expect(previewSourceFrom(inputs({ set: '', preview: LETTER }))).toEqual({
      source: null,
      problem: null,
    })
  })
  it('memo blocks for a set without or with a broken description, with a problem only when broken', () => {
    const without = previewSourceFrom(inputs({ profile: { name: 'A' }, signature: SIG }))
    expect(without).toEqual({
      source: { set: 'brief', spec: MEMO_PREVIEW, profile: { name: 'A' }, signature: SIG },
      problem: null,
    })
    const broken = previewSourceFrom(inputs({ preview: 'preview: 2\n' }))
    expect(broken.source?.spec).toBe(MEMO_PREVIEW)
    expect(broken.problem).toMatch(
      /^Die Vorschau-Beschreibung des Sets brief ist fehlerhaft \(.+\); die Vorschau zeigt den Standard-Titelblock\.$/,
    )
    const ok = previewSourceFrom(inputs({ preview: LETTER }))
    expect(ok.problem).toBeNull()
    expect(ok.source?.spec.foot).toHaveLength(4)
  })
})

describe('noteBlocks', () => {
  it('CRLF note: x-to list, x-attachments [] omitted', () => {
    const note = [
      '---',
      'template: brief',
      'x-to:',
      '  - Muster GmbH',
      '  - Hauptstr. 1',
      'date: 2026-10-22',
      'x-subject: "Angebot Nr. 42"',
      'x-closing: Mit freundlichen Grüßen',
      'x-sign: true',
      'x-attachments: []',
      '---',
      '',
      'Text',
    ].join('\r\n')
    const spec = parsePreviewSpec(LETTER)
    if (!spec.ok) throw new Error(spec.error)
    const state = createState(note, '\r\n', 'preview', true).update({
      effects: setPreviewSource.of({
        set: 'brief',
        spec: spec.spec,
        profile: { name: 'Anna Muster', street: 'Weg 2', zip: '01067', city: 'Dresden' },
        signature: SIG,
      }),
    }).state
    expect(state.field(previewSource)?.set).toBe('brief')
    expect(noteBlocks(state, 'head')).toEqual([
      {
        cls: 'sender',
        kind: 'text',
        text: 'Anna Muster · Weg 2 · 01067 Dresden',
        label: null,
      },
      { cls: 'address', kind: 'lines', lines: ['Muster GmbH', 'Hauptstr. 1'], label: null },
      { cls: 'date', kind: 'text', text: '22. Oktober 2026', label: null },
      { cls: 'subject', kind: 'text', text: 'Angebot Nr. 42', label: null },
    ])
    expect(noteBlocks(state, 'foot')).toEqual([
      { cls: 'closing', kind: 'text', text: 'Mit freundlichen Grüßen', label: null },
      { cls: 'signature', kind: 'image', width: '40mm' },
      { cls: 'signer', kind: 'text', text: 'Anna Muster', label: null },
    ])
  })
  it('no signature image when the signature is not an SVG data URL', () => {
    const spec = parsePreviewSpec(LETTER)
    if (!spec.ok) throw new Error(spec.error)
    const note = '---\nx-closing: Gruß\nx-sign: true\n---\nText'
    const state = createState(note, '\n', 'preview', true).update({
      effects: setPreviewSource.of({
        set: 'brief',
        spec: spec.spec,
        profile: {},
        signature: 'http://x/a.svg',
      }),
    }).state
    expect(noteBlocks(state, 'foot').map((b) => b.cls)).toEqual(['closing'])
  })
})
