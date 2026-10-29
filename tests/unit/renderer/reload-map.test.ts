import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { carrySelection, textChange } from '../../../src/renderer/editor/reload-map'

describe('textChange', () => {
  it('applies to the new text and keeps the common start and end', () => {
    for (const [a, b] of [
      ['# A\nx\n# B\ny\n', '# A\nx neu\n# B\ny\n'],
      ['abc', ''],
      ['', 'abc'],
      ['aaa', 'aa'],
      ['same', 'same'],
    ] as const) {
      const c = textChange(a, b)
      expect(c.apply(EditorState.create({ doc: a }).doc).toString()).toBe(b)
    }
  })
})

describe('carrySelection', () => {
  const at = (doc: string, text: string) =>
    EditorState.create({ doc, selection: { anchor: doc.indexOf(text) } })
  it('a cursor below an edit moves with its text', () => {
    const old = at('# A\nx\n# B\ny\n', 'y')
    const fresh = EditorState.create({ doc: '# A\nx und mehr\n# B\ny\n' })
    const s = carrySelection(old, fresh)
    expect(s.doc.sliceString(s.selection.main.head, s.selection.main.head + 1)).toBe('y')
  })
  it('a cursor above an edit stays; a selection keeps both ends', () => {
    const doc = '# A\nx\n# B\ny\n'
    const old = EditorState.create({ doc, selection: EditorSelection.single(4, 5) })
    const s = carrySelection(old, EditorState.create({ doc: `${doc}neu\n` }))
    expect([s.selection.main.anchor, s.selection.main.head]).toEqual([4, 5])
  })
  it('a shorter text clamps the cursor into it', () => {
    const old = at('# A\nx\n# B\ny\n', 'y')
    const s = carrySelection(old, EditorState.create({ doc: '# A\n' }))
    expect(s.selection.main.head).toBeLessThanOrEqual(4)
  })
})
