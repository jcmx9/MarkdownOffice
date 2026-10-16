// @vitest-environment happy-dom
import { foldEffect, foldedRanges, unfoldAll } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeEntry,
  type OutlineEntry,
  outlineEntries,
} from '../../../src/renderer/editor/outline'
import {
  foldsChanged,
  jumpToEntry,
  OutlineSync,
  toggleEntryFold,
} from '../../../src/renderer/editor/outline-actions'
import { foldAllSections } from '../../../src/renderer/editor/sections'
import { createState } from '../../../src/renderer/editor/setup'

const DOC = '# A\nalpha text\n## a1\nmore\n# B\nbeta\n'

const views: EditorView[] = []
function mkView(doc = DOC): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({ state: createState(doc, '\n', 'preview'), parent })
  views.push(view)
  return view
}
afterEach(() => {
  for (const v of views.splice(0)) {
    v.dom.parentElement?.remove()
    v.destroy()
  }
})
const folds = (view: EditorView) => {
  const out: [number, number][] = []
  foldedRanges(view.state).between(0, view.state.doc.length, (f, t) => {
    out.push([f, t])
  })
  return out
}
const first = (view: EditorView): OutlineEntry => {
  const e = outlineEntries(view.state)[0]
  if (!e) throw new Error('no entry')
  return e
}

describe('toggleEntryFold', () => {
  it('folds an unfolded section and unfolds a folded one; the document is untouched', () => {
    const view = mkView()
    const a = first(view)
    toggleEntryFold(view, a)
    expect(folds(view)).toEqual([[a.fold?.from, a.fold?.to]])
    expect(first(view).folded).toBe(true)
    toggleEntryFold(view, first(view))
    expect(folds(view)).toEqual([])
    expect(view.state.doc.toString()).toBe(DOC)
  })
  it('moves a cursor strictly inside the folded range to the heading end', () => {
    const view = mkView()
    view.dispatch({ selection: { anchor: DOC.indexOf('more') } })
    const a = first(view)
    toggleEntryFold(view, a)
    expect(first(view).folded).toBe(true)
    expect(view.state.selection.main.head).toBe(a.to)
  })
  it('leaves a cursor outside the range alone', () => {
    const view = mkView()
    const pos = DOC.indexOf('beta')
    view.dispatch({ selection: { anchor: pos } })
    toggleEntryFold(view, first(view))
    expect(view.state.selection.main.head).toBe(pos)
  })
  it('is a no-op without a fold range or for a stale range', () => {
    const view = mkView('# A\n# B\n')
    const a = first(view)
    expect(a.fold).toBeNull()
    const spy = vi.spyOn(view, 'dispatch')
    toggleEntryFold(view, a)
    toggleEntryFold(view, { ...a, fold: { from: 3, to: 999 } })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('toggleEntryFold after the folded section changed', () => {
  const DRIFT = '# A\ntext\n\n# B\nb\n'
  function drifted(): EditorView {
    const view = mkView(DRIFT)
    toggleEntryFold(view, first(view))
    view.dispatch({ changes: { from: DRIFT.indexOf('\n# B'), insert: 'more' } })
    return view
  }
  it('the chevron unfolds the mapped fold in one click', () => {
    const view = drifted()
    expect(folds(view)).toHaveLength(1)
    expect(first(view).folded).toBe(true)
    toggleEntryFold(view, first(view))
    expect(folds(view)).toEqual([])
    expect(first(view).folded).toBe(false)
  })
  it('never stacks a second fold on the same heading', () => {
    const view = drifted()
    toggleEntryFold(view, first(view))
    toggleEntryFold(view, first(view))
    const a = first(view)
    expect(folds(view)).toEqual([[a.fold?.from, a.fold?.to]])
    expect(a.folded).toBe(true)
  })
  it('a stale "unfolded" entry does not add a second fold', () => {
    const view = drifted()
    toggleEntryFold(view, { ...first(view), folded: false })
    expect(folds(view)).toEqual([])
  })
})

describe('jumpToEntry', () => {
  it('puts the cursor at the heading end, focuses the editor and keeps the fold', () => {
    const view = mkView()
    const b = outlineEntries(view.state)[1] as OutlineEntry
    view.dispatch({ effects: foldEffect.of(b.fold as { from: number; to: number }) })
    const focus = vi.spyOn(view, 'focus')
    jumpToEntry(view, outlineEntries(view.state)[1] as OutlineEntry)
    expect(view.state.selection.main.head).toBe(b.to)
    expect(focus).toHaveBeenCalled()
    expect(folds(view)).toEqual([[b.fold?.from, b.fold?.to]])
  })
  it('ignores an entry beyond the document (stale)', () => {
    const view = mkView()
    const spy = vi.spyOn(view, 'dispatch')
    jumpToEntry(view, { ...first(view), from: 500, to: 503 })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('sync via the model', () => {
  it('after foldAllSections every entry with a fold is folded; unfoldAll clears them', () => {
    const view = mkView()
    foldAllSections(view)
    const all = outlineEntries(view.state).flatMap((e) => [e, ...e.children])
    for (const e of all) expect(e.folded).toBe(e.fold !== null)
    unfoldAll(view)
    expect(outlineEntries(view.state).every((e) => !e.folded)).toBe(true)
  })
})

describe('foldsChanged', () => {
  it('is true for fold/unfold effects, false for selection-only transactions', () => {
    const view = mkView()
    const a = first(view)
    const sel = view.state.update({ selection: { anchor: 2 } })
    expect(foldsChanged(sel)).toBe(false)
    const fold = view.state.update({
      effects: foldEffect.of(a.fold as { from: number; to: number }),
    })
    expect(foldsChanged(fold)).toBe(true)
  })
})

describe('OutlineSync', () => {
  function setup(doc = DOC) {
    const view = mkView(doc)
    const render = vi.fn<(entries: OutlineEntry[], active: OutlineEntry | null) => void>()
    const setVisible = vi.fn<(on: boolean) => void>()
    const frames: (() => void)[] = []
    const compute = vi.fn(outlineEntries)
    const sync = new OutlineSync(
      { render, setVisible },
      () => view.state,
      {
        request: (cb) => {
          frames.push(cb)
          return frames.length
        },
        cancel: (id) => {
          frames[id - 1] = () => undefined
        },
      },
      compute,
    )
    const flush = () => {
      for (const f of frames.splice(0)) f()
    }
    const dispatch = (spec: Parameters<EditorView['dispatch']>[0]) => {
      const tr = view.state.update(spec)
      view.dispatch(tr)
      sync.update([tr])
    }
    return { view, render, setVisible, sync, flush, compute, dispatch }
  }

  it('does nothing while hidden', () => {
    const { sync, render, compute, flush, dispatch } = setup()
    dispatch({ changes: { from: 0, insert: 'x' } })
    sync.refresh()
    sync.invalidate()
    flush()
    expect(render).not.toHaveBeenCalled()
    expect(compute).not.toHaveBeenCalled()
  })
  it('renders once per frame after becoming visible', () => {
    const { sync, render, setVisible, flush, compute } = setup()
    sync.setVisible(true)
    expect(setVisible).toHaveBeenCalledWith(true)
    sync.refresh()
    sync.refresh()
    flush()
    expect(render).toHaveBeenCalledTimes(1)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0]?.[0].map((e) => e.text)).toEqual(['A', 'B'])
  })
  it('selection-only transactions reuse the cached entries and move the active entry', () => {
    const { sync, render, flush, compute, dispatch, view } = setup()
    sync.setVisible(true)
    flush()
    dispatch({ selection: { anchor: DOC.indexOf('beta') } })
    flush()
    expect(compute).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledTimes(2)
    const [entries, active] = render.mock.calls[1] ?? []
    expect(active).toBe(activeEntry(entries ?? [], view.state.selection.main.head))
    expect(active?.text).toBe('B')
  })
  it('recomputes after doc changes, fold changes and tab switches', () => {
    const { sync, flush, compute, dispatch, view } = setup()
    sync.setVisible(true)
    flush()
    dispatch({ changes: { from: view.state.doc.length, insert: '# C\n' } })
    flush()
    expect(compute).toHaveBeenCalledTimes(2)
    dispatch({ effects: foldEffect.of(first(view).fold as { from: number; to: number }) })
    flush()
    expect(compute).toHaveBeenCalledTimes(3)
    sync.invalidate()
    flush()
    expect(compute).toHaveBeenCalledTimes(4)
  })
  it('hiding cancels a pending frame', () => {
    const { sync, render, flush, setVisible } = setup()
    sync.setVisible(true)
    sync.setVisible(false)
    expect(setVisible).toHaveBeenLastCalledWith(false)
    flush()
    expect(render).not.toHaveBeenCalled()
  })
})
