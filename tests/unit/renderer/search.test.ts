// @vitest-environment happy-dom
import { getSearchQuery, SearchQuery, searchPanelOpen, setSearchQuery } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { findAgain, openFind, openReplace } from '../../../src/renderer/editor/search'
import { createState } from '../../../src/renderer/editor/setup'

let view: EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
})

const make = (doc: string, mode: 'edit' | 'present' = 'edit') => {
  view = new EditorView({
    state: createState(doc, '\n', 'code', false, mode),
    parent: document.body,
  })
  return view
}

describe('find and replace', () => {
  it('opens the panel on top with German labels; the selection becomes the query', () => {
    const v = make('eins zwei eins')
    v.dispatch({ selection: { anchor: 0, head: 4 } })
    expect(openFind(v)).toBe(true)
    expect(searchPanelOpen(v.state)).toBe(true)
    expect(v.dom.querySelector('.cm-panels-top .cm-search')).not.toBeNull()
    expect(getSearchQuery(v.state).search).toBe('eins')
    const text = v.dom.querySelector('.cm-search')?.textContent ?? ''
    expect(text).toContain('Alle ersetzen')
    expect(text).toContain('Groß/klein')
    expect(text).not.toContain('replace all')
  })

  it('replace focuses the replace field', () => {
    const v = make('a b a')
    expect(openReplace(v)).toBe(true)
    expect(document.activeElement?.getAttribute('name')).toBe('replace')
  })

  it('find again: without a query it opens the panel, then walks the matches both ways', () => {
    const v = make('x a x a x')
    expect(findAgain(v, false)).toBe(true)
    expect(searchPanelOpen(v.state)).toBe(true)
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'a' })) })
    v.dispatch({ selection: { anchor: 0 } })
    findAgain(v, false)
    expect(v.state.selection.main.from).toBe(2)
    findAgain(v, false)
    expect(v.state.selection.main.from).toBe(6)
    findAgain(v, true)
    expect(v.state.selection.main.from).toBe(2)
  })

  it('finds in a YAML profile tab too', () => {
    view = new EditorView({
      state: createState('name: x\n', '\n', 'code', false, 'edit', false, 'yaml'),
      parent: document.body,
    })
    expect(openFind(view)).toBe(true)
  })
})
