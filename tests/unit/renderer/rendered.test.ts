// @vitest-environment happy-dom
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { lineIsRendered } from '../../../src/renderer/editor/rendered'
import { viewExtensions } from '../../../src/renderer/editor/setup'

function state(view: 'code' | 'preview', selection: EditorSelection): EditorState {
  return EditorState.create({
    doc: 'eins\nzwei\ndrei\nvier',
    selection,
    extensions: [viewExtensions(view)],
  })
}
const rendered = (s: EditorState) => [1, 2, 3, 4].map((n) => lineIsRendered(s, s.doc.line(n)))

describe('lineIsRendered', () => {
  it('renders every line but the cursor line in the Preview', () => {
    expect(rendered(state('preview', EditorSelection.single(6)))).toEqual([true, false, true, true])
  })
  it('keeps every line a selection touches raw, ends included', () => {
    // 4..10: from the end of "eins" to the start of "drei"
    const sel = EditorSelection.single(4, 10)
    expect(rendered(state('preview', sel))).toEqual([false, false, false, true])
  })
  it('renders nothing in the Code view', () => {
    expect(rendered(state('code', EditorSelection.single(19)))).toEqual([
      false,
      false,
      false,
      false,
    ])
  })
})
