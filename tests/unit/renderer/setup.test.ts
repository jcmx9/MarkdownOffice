// @vitest-environment happy-dom
import { foldedRanges } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { headerHidden } from '../../../src/renderer/editor/header'
import { presentMode } from '../../../src/renderer/editor/mode'
import {
  createState,
  foldBindings,
  freezeSpec,
  isFrozen,
  serializeDoc,
  viewCompartment,
  viewExtensions,
} from '../../../src/renderer/editor/setup'

describe('createState / serializeDoc', () => {
  it.each([
    ['LF', 'a\nb\n', '\n'],
    ['CRLF', 'a\r\nb\r\n', '\r\n'],
    ['mixed', 'a\r\nb\nc\rd', 'mixed'],
    ['empty', '', '\n'],
  ] as const)('%s round-trips byte-exact', (_name, text, eol) => {
    expect(serializeDoc(createState(text, eol, 'code').doc, eol)).toBe(text)
  })

  it('a new line in a CRLF file is saved as CRLF', () => {
    const state = createState('a\r\nb', '\r\n', 'code')
    const next = state.update({ changes: { from: 1, insert: '\n' } }).state
    expect(serializeDoc(next.doc, '\r\n')).toBe('a\r\n\r\nb')
  })

  it('switching the view keeps the text identical', () => {
    const state = createState('# T\r\n\r\nx', '\r\n', 'code')
    const next = state.update({
      effects: viewCompartment.reconfigure(viewExtensions('preview')),
    }).state
    expect(serializeDoc(next.doc, '\r\n')).toBe('# T\r\n\r\nx')
  })
})

describe('createState wiring', () => {
  it('starts with the given header flag and keeps it across view switches', () => {
    const s = createState('---\na: 1\n---\nx', '\n', 'preview', true)
    expect(s.field(headerHidden)).toBe(true)
    const code = s.update({ effects: viewCompartment.reconfigure(viewExtensions('code')) }).state
    expect(code.field(headerHidden)).toBe(true)
    expect(serializeDoc(code.doc, '\n')).toBe('---\na: 1\n---\nx')
  })

  it('puts the cursor after the collapsed header when it starts hidden', () => {
    expect(createState('---\na: 1\n---\nx', '\n', 'preview', true).selection.main.head).toBe(13)
    expect(createState('---\na: 1\n---\nx', '\n', 'preview', false).selection.main.head).toBe(0)
    expect(createState('x', '\n', 'preview', true).selection.main.head).toBe(0)
  })
})

describe('foldBindings', () => {
  const keys = (mac: boolean) => foldBindings(mac).map((b) => b.key)

  it('keeps CodeMirror fold keys on macOS', () => {
    expect(keys(true)).toEqual(['Ctrl-Shift-[', 'Ctrl-Shift-]', 'Ctrl-Alt-[', 'Ctrl-Alt-]'])
  })

  it('frees Ctrl-Alt (AltGr) on Windows/Linux and uses Alt-0 / Alt-Shift-0', () => {
    expect(keys(false)).toEqual(['Ctrl-Shift-[', 'Ctrl-Shift-]', 'Alt-0', 'Alt-Shift-0'])
  })

  it('Alt-0 folds every section and Alt-Shift-0 unfolds them', () => {
    const parent = document.createElement('div')
    const view = new EditorView({
      state: createState('# A\n\nx\n\n# B\n\ny', '\n', 'code'),
      parent,
    })
    const run = (key: string) =>
      foldBindings(false)
        .find((b) => b.key === key)
        ?.run?.(view)
    expect(run('Alt-0')).toBe(true)
    expect(foldedRanges(view.state).size).toBe(2)
    expect(run('Alt-Shift-0')).toBe(true)
    expect(foldedRanges(view.state).size).toBe(0)
    view.destroy()
  })
})

describe('createState mode', () => {
  it('Present starts with the cursor after the header and the facet set', () => {
    const doc = '---\na: 1\n---\nx'
    const s = createState(doc, '\n', 'preview', false, 'present')
    expect(s.facet(presentMode)).toBe(true)
    expect(s.selection.main.head).toBe(13)
  })
  it('Edit keeps the old default', () => {
    expect(createState('---\na: 1\n---\nx', '\n', 'preview').selection.main.head).toBe(0)
  })
})

describe('freezeSpec (closing)', () => {
  it('a frozen state is read-only, not editable and drops every document change', () => {
    const s = createState('abc', '\n', 'preview').update(freezeSpec(true)).state
    expect(isFrozen(s)).toBe(true)
    expect(s.readOnly).toBe(true)
    expect(s.facet(EditorView.editable)).toBe(false)
    // Programmatic inserts (snippet completion, checkbox toggle) are dropped too.
    const after = s.update({ changes: { from: 3, insert: 'x' } }).state
    expect(after.doc.toString()).toBe('abc')
  })

  it('unfreezing restores input', () => {
    const s = createState('abc', '\n', 'code')
      .update(freezeSpec(true))
      .state.update(freezeSpec(false)).state
    expect(isFrozen(s)).toBe(false)
    expect(s.readOnly).toBe(false)
    expect(s.facet(EditorView.editable)).toBe(true)
    expect(s.update({ changes: { from: 3, insert: 'x' } }).state.doc.toString()).toBe('abcx')
  })

  it('a new state is not frozen', () => {
    const s = createState('abc', '\n', 'code')
    expect(isFrozen(s)).toBe(false)
    expect(s.readOnly).toBe(false)
  })
})
