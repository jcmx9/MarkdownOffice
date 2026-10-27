// @vitest-environment happy-dom
import { undo } from '@codemirror/commands'
import { EditorSelection, EditorState, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { createState } from '../../../src/renderer/editor/setup'
import type { Mode } from '../../../src/shared/types'
import { parsed } from './parsed'

// `«…»` marks the selection (anchor at «, head at »), `‸` a cursor.
const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})

function make(text: string, mode: Mode = 'edit'): EditorView {
  const ranges: { anchor: number; head: number }[] = []
  let doc = ''
  let open = -1
  for (const ch of text) {
    if (ch === '‸') ranges.push({ anchor: doc.length, head: doc.length })
    else if (ch === '«') open = doc.length
    else if (ch === '»') ranges.push({ anchor: open, head: doc.length })
    else doc += ch
  }
  let state = createState(doc, '\n', 'code', false, mode)
  state = state.update({
    effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)),
  }).state
  state = parsed(state)
  const sel = EditorSelection.create(ranges.map((r) => EditorSelection.range(r.anchor, r.head)))
  const view = new EditorView({
    state: state.update({ selection: sel }).state,
    parent: document.body,
  })
  views.push(view)
  return view
}

/** Types `text` like the browser: the input handlers first, else the default insertion. */
function type(v: EditorView, text: string): void {
  const { from, to } = v.state.selection.main
  const insert = () => v.state.update(v.state.replaceSelection(text))
  if (!v.state.facet(EditorView.inputHandler).some((h) => h(v, from, to, text, insert))) {
    v.dispatch(insert())
  }
}

function marked(v: EditorView): string {
  let out = v.state.doc.toString()
  const marks: { pos: number; text: string }[] = []
  for (const r of v.state.selection.ranges) {
    if (r.empty) marks.push({ pos: r.head, text: '‸' })
    else marks.push({ pos: r.from, text: '«' }, { pos: r.to, text: '»' })
  }
  for (const m of marks.sort((a, b) => b.pos - a.pos)) {
    out = out.slice(0, m.pos) + m.text + out.slice(m.pos)
  }
  return out
}

function typed(text: string, keys: string[], mode: Mode = 'edit'): string {
  const v = make(text, mode)
  for (const k of keys) type(v, k)
  return marked(v)
}

describe('wrap on type', () => {
  it.each<[string[], string]>([
    [['*'], 'a *«Text»* b'],
    [['*', '*'], 'a **«Text»** b'],
    [['*', '*', '*'], 'a ***«Text»*** b'],
  ])('%j around a selection', (keys, out) => {
    expect(typed('a «Text» b', keys)).toBe(out)
  })

  it('types a fourth * as usual (replaces the selection)', () => {
    expect(typed('a «Text» b', ['*', '*', '*', '*'])).toBe('a ****‸*** b')
  })

  it.each([
    ['~', 'a ~~«Text»~~ b'],
    ['=', 'a ==«Text»== b'],
  ])('%s needs two presses, like Markdown', (key, out) => {
    const v = make('a «Text» b')
    type(v, key)
    expect(marked(v)).toBe('a «Text» b')
    type(v, key)
    expect(marked(v)).toBe(out)
  })

  it('wraps a pair delivered in one input (dead keys)', () => {
    expect(typed('«x»', ['~~'])).toBe('~~«x»~~')
  })

  it('types both characters when another key follows the first press', () => {
    expect(typed('a «Text» b', ['~', 'x'])).toBe('a ~x‸ b')
  })

  it('forgets the waiting press when the selection moves', () => {
    const v = make('a «Text» b')
    type(v, '=')
    v.dispatch({ selection: EditorSelection.range(0, 1) })
    type(v, '=')
    expect(marked(v)).toBe('«a» Text b')
  })

  it('types as usual without a selection', () => {
    expect(typed('a‸ b', ['*', '~', '='])).toBe('a*~=‸ b')
  })

  it('wraps every line of a multi-line selection on its own', () => {
    expect(typed('«eins\nzwei»', ['*'])).toBe('*«eins*\n*zwei»*')
  })

  it('never wraps inside a code span or in Present (the key goes its usual way)', () => {
    expect(typed('`a «b» c`', ['*'])).toBe('`a *‸ c`')
    expect(typed('a «b» c', ['*'], 'present')).toBe('a *‸ c')
  })

  it('makes every press its own undo step', () => {
    const v = make('a «Text» b')
    type(v, '*')
    type(v, '*')
    undo(v)
    expect(v.state.doc.toString()).toBe('a *Text* b')
    undo(v)
    expect(v.state.doc.toString()).toBe('a Text b')
  })
})
