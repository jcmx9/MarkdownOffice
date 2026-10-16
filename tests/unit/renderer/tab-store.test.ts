import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { TabStore } from '../../../src/renderer/tabs/tab-store'

const add = (store: TabStore, path: string, text = '', onDisk = true) =>
  store.add({ path, state: EditorState.create({ doc: text }), bom: false, eol: '\n', onDisk })

describe('TabStore', () => {
  it('activates new tabs and reuses an open path', () => {
    const s = new TabStore()
    const a = add(s, '/a.md')
    add(s, '/b.md')
    expect(s.activeIndex).toBe(1)
    expect(add(s, '/a.md')).toBe(a)
    expect(s.all).toHaveLength(2)
    expect(s.activeIndex).toBe(0)
  })

  it('wraps next/prev and ignores invalid indexes', () => {
    const s = new TabStore()
    add(s, '/a.md')
    add(s, '/b.md')
    expect(s.next()?.path).toBe('/a.md')
    expect(s.prev()?.path).toBe('/b.md')
    expect(s.activate(9)?.path).toBe('/b.md')
  })

  it.each([
    ['closing the active middle tab activates its right neighbour', 1, 1, '/c.md'],
    ['closing the active last tab activates the new last', 2, 2, '/b.md'],
    ['closing a tab left of the active keeps the active tab', 2, 0, '/c.md'],
    ['closing a tab right of the active keeps the active tab', 0, 2, '/a.md'],
  ])('%s', (_name, activeIdx, closeIdx, expected) => {
    const s = new TabStore()
    const tabs = [add(s, '/a.md'), add(s, '/b.md'), add(s, '/c.md')]
    s.activate(activeIdx)
    const closing = tabs[closeIdx]
    if (!closing) throw new Error(`no tab at index ${closeIdx}`)
    s.close(closing.id)
    expect(s.active?.path).toBe(expected)
  })

  it('has no active tab after closing the last one', () => {
    const s = new TabStore()
    s.close(add(s, '/a.md').id)
    expect(s.active).toBeNull()
    expect(s.next()).toBeNull()
  })

  it('tracks dirty state against the saved doc', () => {
    const s = new TabStore()
    const t = add(s, '/a.md', 'x')
    expect(s.isDirty(t)).toBe(false)
    s.updateState(t.id, t.state.update({ changes: { from: 1, insert: 'y' } }).state)
    expect(s.isDirty(t)).toBe(true)
    s.markSaved(t.id, t.state.doc)
    expect(s.isDirty(t)).toBe(false)
  })

  it('stays dirty when typing continued during a save', () => {
    const s = new TabStore()
    const t = add(s, '/a.md', 'a')
    const v1 = t.state.update({ changes: { from: 1, insert: 'b' } }).state
    s.updateState(t.id, v1)
    const snapshot = v1.doc // save starts with this doc
    s.updateState(t.id, v1.update({ changes: { from: 2, insert: 'c' } }).state)
    s.markSaved(t.id, snapshot) // save finishes
    expect(s.isDirty(t)).toBe(true)
  })

  it('new empty tabs are clean and not in the session', () => {
    const s = new TabStore()
    const t = add(s, '/neu.md', '', false)
    add(s, '/a.md')
    expect(s.isDirty(t)).toBe(false)
    expect(s.toSession()).toEqual([{ path: '/a.md', headerHidden: false }])
    s.markSaved(t.id, t.state.doc)
    expect(s.toSession().map((x) => x.path)).toEqual(['/neu.md', '/a.md'])
  })

  it('updates the path on rename', () => {
    const s = new TabStore()
    const t = add(s, '/a.md')
    s.setPath(t.id, '/b.md')
    expect(s.findByPath('/b.md')).toBe(t)
    expect(s.findByPath('/a.md')).toBeUndefined()
  })
})
