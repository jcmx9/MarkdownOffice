// @vitest-environment happy-dom
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { createState } from '../../../src/renderer/editor/setup'

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})

/** Enter with the cursor at `at` (index of that text); returns the document and the cursor. */
function enter(doc: string, at: string, view: 'preview' | 'code' = 'preview') {
  const parent = document.createElement('div')
  document.body.append(parent)
  const v = new EditorView({ state: createState(doc, '\n', view), parent })
  views.push(v)
  v.dispatch({ selection: { anchor: doc.indexOf(at) } })
  runScopeHandlers(v, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
  return { doc: v.state.doc.toString(), head: v.state.selection.main.head }
}

describe('Enter at a paragraph start under a heading (Preview)', () => {
  it('opens a new paragraph above; typing writes it', () => {
    const r = enter('# H\nText\n', 'Text')
    expect(r.doc).toBe('# H\n\n\nText\n')
    expect(r.head).toBe(4)
  })
  it('also across blank lines under the heading, and under a Setext heading', () => {
    expect(enter('## H\n\nText\n', 'Text')).toEqual({ doc: '## H\n\n\n\nText\n', head: 6 })
    expect(enter('H\n===\nText\n', 'Text').doc).toBe('H\n===\n\n\nText\n')
  })
  it('leaves other places to the plain newline', () => {
    expect(enter('Eins\n\nText\n', 'Text').doc).toBe('Eins\n\n\nText\n')
    expect(enter('# H\nText\n', 'ext').doc).toBe('# H\nT\next\n')
    expect(enter('# H\n## U\n', '## U').doc).toBe('# H\n\n## U\n')
  })
  it('Code keeps the plain newline', () => {
    expect(enter('# H\nText\n', 'Text', 'code').doc).toBe('# H\n\nText\n')
  })
})
