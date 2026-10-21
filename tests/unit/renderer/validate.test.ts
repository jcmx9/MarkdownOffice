import { undo } from '@codemirror/commands'
import type { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { PIPELINE_SCHEMA } from '../../../src/core/frontmatter-schema'
import { type ValidationContext, validateFrontmatter } from '../../../src/core/frontmatter-validate'
import { createState, serializeDoc } from '../../../src/renderer/editor/setup'
import { choiceSpec, validationSpec } from '../../../src/renderer/editor/validate'

const HEADER = '---\ntemplate: memo   # Set\nlang: de   # Sprache\n---\n'
const ctx: ValidationContext = {
  schema: PIPELINE_SCHEMA,
  sets: ['memo'],
  header: HEADER,
  profile: null,
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

const NOTE = '---\ntemplate: memo\ntoc: ja   # Inhalt\ndate: 20.10.26\n---\n\nText\n'

describe('validationSpec', () => {
  it('is null without changes', () => {
    expect(validationSpec(createState(NOTE, '\n', 'code'), [])).toBeNull()
  })

  it('applies every change in one transaction, undone in one step', () => {
    const state = createState(NOTE, '\n', 'code')
    const r = validateFrontmatter(NOTE, ctx)
    if (r.kind !== 'checked') throw new Error('not checked')
    const changes = [...r.findings.flatMap((f) => f.changes), ...r.missingChanges]
    const spec = validationSpec(state, changes)
    expect(spec).not.toBeNull()
    if (!spec) return
    const after = state.update(spec).state
    expect(after.doc.toString()).toBe(
      '---\ntemplate: memo\ntoc: true # Inhalt\ndate: 2026-10-20\nlang: de   # Sprache\n---\n\nText\n',
    )
    expect(undone(after).doc.toString()).toBe(NOTE)
  })

  it('is never joined with typing right before it', () => {
    const typed = createState(NOTE, '\n', 'code').update({
      changes: { from: NOTE.length, insert: 'x' },
      userEvent: 'input.type',
    }).state
    const r = validateFrontmatter(typed.doc.toString(), ctx)
    if (r.kind !== 'checked') throw new Error('not checked')
    const spec = validationSpec(
      typed,
      r.findings.flatMap((f) => f.changes),
    )
    if (!spec) throw new Error('no spec')
    expect(undone(typed.update(spec).state).doc.toString()).toBe(`${NOTE}x`)
  })

  it('keeps a mixed note byte-exact outside the fixed lines', () => {
    const text = '---\r\ntoc: ja\ndate: 20.10.26\r\n---\r\nA\rB'
    const state = createState(text, 'mixed', 'code')
    const r = validateFrontmatter(state.doc.toString(), ctx)
    if (r.kind !== 'checked') throw new Error('not checked')
    const spec = validationSpec(
      state,
      r.findings.flatMap((f) => f.changes),
    )
    if (!spec) throw new Error('no spec')
    expect(serializeDoc(state.update(spec).state.doc, 'mixed')).toBe(
      '---\r\ntoc: true\ndate: 2026-10-20\r\n---\r\nA\rB',
    )
  })
})

describe('choiceSpec', () => {
  it('applies the chosen findings and, on request, the missing keys', () => {
    const state = createState(NOTE, '\n', 'code')
    const r = validateFrontmatter(NOTE, ctx)
    if (r.kind !== 'checked') throw new Error('not checked')
    const toc = r.findings.find((f) => f.key === 'toc')
    if (!toc) throw new Error('no toc finding')
    const only = choiceSpec(state, ctx, { ids: new Set([toc.id]), addMissing: false })
    if (!only) throw new Error('no spec')
    expect(state.update(only).state.doc.toString()).toBe(
      NOTE.replace('toc: ja   # Inhalt', 'toc: true # Inhalt'),
    )
    const missing = choiceSpec(state, ctx, { ids: new Set(), addMissing: true })
    if (!missing) throw new Error('no spec')
    expect(state.update(missing).state.doc.toString()).toBe(
      NOTE.replace('---\n\n', 'lang: de   # Sprache\n---\n\n'),
    )
  })

  it('is null when nothing is chosen', () => {
    const state = createState(NOTE, '\n', 'code')
    expect(choiceSpec(state, ctx, { ids: new Set(), addMissing: false })).toBeNull()
  })

  it('re-validates the current text: ids gone stale are dropped, never old offsets', () => {
    // The dialog was opened on NOTE; meanwhile the note changed (e.g. an external reload).
    const opened = validateFrontmatter(NOTE, ctx)
    if (opened.kind !== 'checked') throw new Error('not checked')
    const ids = new Set(opened.findings.map((f) => f.id))
    expect(ids.size).toBe(2)
    // A line above shifts both findings; `toc` was corrected by hand.
    const now = '---\n# neu\ntemplate: memo\ntoc: true\ndate: 20.10.26\n---\n\nText\n'
    const state = createState(now, '\n', 'code')
    expect(choiceSpec(state, ctx, { ids, addMissing: false })).toBeNull()
    // The date finding still exists at its old line: only it is applied, at today's offsets.
    const same = '---\ntemplate: memo\ntoc: true\ndate: 20.10.26\n---\n\nNeu\n'
    const s2 = createState(same, '\n', 'code')
    const spec = choiceSpec(s2, ctx, { ids, addMissing: false })
    if (!spec) throw new Error('no spec')
    expect(s2.update(spec).state.doc.toString()).toBe(
      '---\ntemplate: memo\ntoc: true\ndate: 2026-10-20\n---\n\nNeu\n',
    )
  })

  it('adds missing keys from the current text, not from the text the dialog saw', () => {
    const now = '---\ntemplate: memo\nlang: en\n---\n'
    const state = createState(now, '\n', 'code')
    expect(choiceSpec(state, ctx, { ids: new Set(), addMissing: true })).toBeNull()
  })
})

describe('validationSpec bounds', () => {
  it('refuses changes that do not fit the doc', () => {
    const state = createState('---\n---\n', '\n', 'code')
    expect(validationSpec(state, [{ from: 0, to: 99, insert: 'x' }])).toBeNull()
  })
})
