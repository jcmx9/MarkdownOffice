import { undo } from '@codemirror/commands'
import type { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { frontmatterRange } from '../../../src/renderer/editor/frontmatter'
import { dateFixSpec, headerNote, insertTemplate } from '../../../src/renderer/editor/insert-header'
import { createState, serializeDoc } from '../../../src/renderer/editor/setup'
import type { Eol } from '../../../src/shared/types'

const TEMPLATE = '---\n# Kommentar\ntemplate: memo\ntitle: ""\nlang: de\n---\n'
const memo = { template: 'memo', profile: null }

function run(text: string, template = TEMPLATE, eol: Eol = '\n') {
  const state = createState(text, eol, 'code')
  const res = insertTemplate(state, template, memo)
  if (res.kind !== 'changed') return { res, state }
  return { res, state: state.update(res.spec).state }
}

function undone(state: EditorState): EditorState {
  let out = state
  undo({
    state,
    dispatch: (tr) => {
      out = tr.state
    },
  })
  return out
}

describe('insertTemplate', () => {
  it('fills an empty note with the header and puts the cursor into title ""', () => {
    const { state } = run('')
    expect(state.doc.toString()).toBe(TEMPLATE)
    expect(state.selection.main.head).toBe(state.doc.toString().indexOf('title: "') + 8)
    expect(frontmatterRange(state.doc)).not.toBeNull()
  })

  it('goes above existing text, separated by one blank line', () => {
    expect(run('# Termin\n\nText').state.doc.toString()).toBe(`${TEMPLATE}\n# Termin\n\nText`)
  })

  it('merges into an existing header, keeping the cursor where it was', () => {
    const state0 = createState('---\nlang: en\n---\n\nText', '\n', 'code')
    const at = state0.doc.length
    const res = insertTemplate(state0.update({ selection: { anchor: at } }).state, TEMPLATE, memo)
    expect(res.kind).toBe('changed')
    if (res.kind !== 'changed') return
    expect(res.added).toEqual(['template', 'title'])
    const state = state0.update({ selection: { anchor: at } }).state.update(res.spec).state
    expect(state.doc.toString()).toBe('---\nlang: en\ntemplate: memo\ntitle: ""\n---\n\nText')
    expect(state.doc.sliceString(state.selection.main.head - 4, state.selection.main.head)).toBe(
      'Text',
    )
  })

  it('reports an unchanged header', () => {
    expect(run(`${TEMPLATE}\nText`).res).toEqual({ kind: 'unchanged' })
  })

  it('refuses an unclosed header', () => {
    expect(run('---\ntitle: a\nText').res).toEqual({ kind: 'unclosed' })
  })

  it('keeps a CRLF note CRLF on save, also the appended lines', () => {
    const { state } = run('---\r\nlang: en\r\n---\r\n\r\nA\r\n', TEMPLATE, '\r\n')
    expect(serializeDoc(state.doc, '\r\n')).toBe(
      '---\r\nlang: en\r\ntemplate: memo\r\ntitle: ""\r\n---\r\n\r\nA\r\n',
    )
  })

  it('keeps a mixed note byte-exact outside the merged lines', () => {
    const { state } = run('---\r\nlang: en\n---\r\nA\rB', TEMPLATE, 'mixed')
    expect(serializeDoc(state.doc, 'mixed')).toBe(
      '---\r\nlang: en\ntemplate: memo\r\ntitle: ""\r\n---\r\nA\rB',
    )
  })

  it('is one undo step, never joined with typing right before it', () => {
    // Typed at the end of `lang: en`, right next to where the merge appends.
    const typed = createState('---\nlang: en\n---\n', '\n', 'code').update({
      changes: { from: 12, insert: 'x' },
      userEvent: 'input.type',
    }).state
    const res = insertTemplate(typed, TEMPLATE, memo)
    expect(res.kind).toBe('changed')
    if (res.kind !== 'changed') return
    const after = typed.update(res.spec).state
    expect(undone(after).doc.toString()).toBe('---\nlang: enx\n---\n')
  })
})

describe('dateFixSpec', () => {
  it('writes the date as its own undo step', () => {
    const { state } = run('---\ndate: 20/10/2026   # Datum\n---\n')
    const spec = dateFixSpec(state, '2026-10-20')
    expect(spec).not.toBeNull()
    if (!spec) return
    const fixed = state.update(spec).state
    expect(fixed.doc.toString()).toMatch(/^date: 2026-10-20 +# Datum$/m)
    // Undo takes back only the date fix, the merge stays.
    expect(undone(fixed).doc.toString()).toBe(state.doc.toString())
  })

  it('is null when there is no date to change', () => {
    expect(dateFixSpec(createState('Text', '\n', 'code'), '2026-10-20')).toBeNull()
  })
})

describe('headerNote', () => {
  it('is the template with one final line break and the cursor inside title ""', () => {
    const note = headerNote('---\n# Kommentar\ntitle: ""   # Titel\n---\n\n\n')
    expect(note.text).toBe('---\n# Kommentar\ntitle: ""   # Titel\n---\n')
    expect(note.anchor).toBe(note.text.indexOf('title: "') + 8)
  })

  it("normalises CRLF templates to the new note's LF", () => {
    expect(headerNote(TEMPLATE.replace(/\n/g, '\r\n')).text).toBe(TEMPLATE)
  })

  it('puts the cursor at the end when the template has no empty title', () => {
    const note = headerNote('---\ntemplate: brief\n---')
    expect(note).toEqual({ text: '---\ntemplate: brief\n---\n', anchor: 24 })
  })

  it('matches what insertTemplate makes of an empty note', () => {
    const { state } = run('')
    const note = headerNote(TEMPLATE)
    expect(note.text).toBe(state.doc.toString())
    expect(note.anchor).toBe(state.selection.main.head)
  })
})
