// @vitest-environment happy-dom
import {
  cursorCharLeft,
  cursorDocStart,
  deleteCharBackward,
  selectAll,
  undo,
} from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import {
  headerFold,
  headerHidden,
  headerToggleSpec,
  moveOutOfHeader,
} from '../../../src/renderer/editor/header'
import { modeCompartment, modeExtensions } from '../../../src/renderer/editor/mode'
import { createState, viewCompartment, viewExtensions } from '../../../src/renderer/editor/setup'

const DOC = '---\ntitle: "Kickoff"\n---\n\n# Body'
const END = DOC.indexOf('\n\n') // end of the closing ---

function make(doc: string, hidden: boolean, cursor = 0) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [headerHidden.init(() => hidden), headerFold],
  })
}

function collapsed(state: EditorState): string[] {
  const out: string[] = []
  state.field(headerFold).between(0, state.doc.length, (from, to, d) => {
    out.push(`${(d.spec as { rf: string }).rf}@${from}-${to}`)
  })
  return out
}

describe('headerFold', () => {
  it('collapses the whole front matter when hidden', () => {
    expect(collapsed(make(DOC, true, DOC.length))).toEqual([`header-fold@0-${END}`])
  })
  it('shows nothing when not hidden or without front matter', () => {
    expect(collapsed(make(DOC, false))).toEqual([])
    expect(collapsed(make('# Nur Text', true))).toEqual([])
  })
  it('follows unfiltered edits (e.g. undo) that change the header length', () => {
    const s = make(DOC, true, DOC.length)
    const next = s.update({ changes: { from: 4, insert: 'client: A\n' }, filter: false }).state
    expect(collapsed(next)).toEqual([`header-fold@0-${END + 10}`])
  })
})

describe('headerToggleSpec', () => {
  it('hiding with the cursor inside moves it after the header, text unchanged', () => {
    const s = make(DOC, false, 6)
    const next = s.update(headerToggleSpec(s, true)).state
    expect(next.field(headerHidden)).toBe(true)
    expect(next.selection.main.head).toBe(END + 1)
    expect(next.doc.toString()).toBe(DOC)
  })
  it('hiding with the cursor outside keeps it', () => {
    const s = make(DOC, false, DOC.length)
    const next = s.update(headerToggleSpec(s, true)).state
    expect(next.selection.main.head).toBe(DOC.length)
  })
  it('showing again only flips the flag', () => {
    const s = make(DOC, true, DOC.length)
    const next = s.update(headerToggleSpec(s, false)).state
    expect(next.field(headerHidden)).toBe(false)
    expect(collapsed(next)).toEqual([])
  })
  it('a document that is only a header puts the cursor at its end', () => {
    const only = '---\na: 1\n---'
    const s = make(only, false, 2)
    expect(s.update(headerToggleSpec(s, true)).state.selection.main.head).toBe(only.length)
  })
})

describe('collapsed header in a real view', () => {
  const HEAD = '---\ntitle: "Kickoff"\n---'
  const TEXT = `${HEAD}\nErste Zeile\n\n---\nmehr`

  function view(text = TEXT) {
    const parent = document.createElement('div')
    document.body.append(parent)
    return new EditorView({ state: createState(text, '\n', 'preview', true), parent })
  }

  it('starts collapsed with the cursor on the first body line', () => {
    const v = view()
    expect(collapsed(v.state)).toEqual([`header-fold@0-${HEAD.length}`])
    expect(v.state.selection.main.head).toBe(HEAD.length + 1)
    v.destroy()
  })

  it('Backspace at the first body line leaves the header and its line break alone', () => {
    const v = view()
    deleteCharBackward(v)
    expect(v.state.doc.toString()).toBe(TEXT)
    v.destroy()
  })

  it('Left then Backspace keeps the header intact', () => {
    const v = view()
    cursorCharLeft(v)
    expect(v.state.selection.main.head).toBe(HEAD.length + 1)
    deleteCharBackward(v)
    expect(v.state.doc.toString()).toBe(TEXT)
    v.destroy()
  })

  it('document start lands after the header and typing goes there', () => {
    const v = view()
    cursorDocStart(v)
    expect(v.state.selection.main.head).toBe(HEAD.length + 1)
    v.dispatch(v.state.replaceSelection('x'))
    expect(v.state.doc.toString()).toBe(`${HEAD}\nxErste Zeile\n\n---\nmehr`)
    v.destroy()
  })

  it('a change inside the header is dropped, one after it passes', () => {
    const v = view()
    v.dispatch({ changes: { from: 0, insert: 'x' } })
    v.dispatch({ changes: { from: HEAD.length, to: HEAD.length + 1 } })
    expect(v.state.doc.toString()).toBe(TEXT)
    v.dispatch({ changes: { from: TEXT.length, insert: '!' } })
    expect(v.state.doc.toString()).toBe(`${TEXT}!`)
    v.destroy()
  })

  it('select all + delete or typing keeps the header', () => {
    const v = view()
    selectAll(v)
    deleteCharBackward(v)
    expect(v.state.doc.toString()).toBe(`${HEAD}\n`)
    selectAll(v)
    v.dispatch(v.state.replaceSelection('neu'))
    expect(v.state.doc.toString()).toBe(`${HEAD}\nneu`)
    v.destroy()
  })

  it('undo still restores what was deleted after the header', () => {
    const v = view()
    selectAll(v)
    deleteCharBackward(v)
    undo(v)
    expect(v.state.doc.toString()).toBe(TEXT)
    v.destroy()
  })

  it('in Code view the header is editable again', () => {
    const v = view()
    v.dispatch({ effects: viewCompartment.reconfigure(viewExtensions('code')) })
    v.dispatch({ selection: { anchor: HEAD.length + 1 } })
    deleteCharBackward(v)
    expect(v.state.doc.toString()).toBe(`${HEAD}Erste Zeile\n\n---\nmehr`)
    cursorDocStart(v)
    expect(v.state.selection.main.head).toBe(0)
    v.dispatch(v.state.replaceSelection('x'))
    expect(v.state.doc.toString()).toBe(`x${HEAD}Erste Zeile\n\n---\nmehr`)
    v.destroy()
  })

  it('a header retyped while hidden stays visible while the cursor is on it', () => {
    const s = make('---\na: 1\n--', true, 11)
    const next = s.update({ changes: { from: 11, insert: '-' }, selection: { anchor: 12 } }).state
    expect(collapsed(next)).toEqual([])
    const away = next.update({
      changes: { from: 12, insert: '\nx' },
      selection: { anchor: 14 },
    }).state
    expect(collapsed(away)).toEqual(['header-fold@0-12'])
  })
})

function makePresent(doc: string, cursor: number, hidden = false) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      headerHidden.init(() => hidden),
      headerFold,
      modeCompartment.of(modeExtensions('present')),
    ],
  })
}

describe('Present', () => {
  it('collapses the header even when the per-tab toggle is off', () => {
    expect(collapsed(makePresent(DOC, DOC.length))).toEqual([`header-fold@0-${END}`])
  })
  it('collapses even while the selection touches it, and clamps the selection out', () => {
    const s = makePresent(DOC, DOC.length)
    const next = s.update({ selection: { anchor: 2 } }).state
    expect(collapsed(next)).toEqual([`header-fold@0-${END}`])
    expect(next.selection.main.head).toBe(END + 1)
  })
  it('is read-only in Present', () => {
    const s = makePresent(DOC, DOC.length)
    const next = s.update({ changes: { from: 4, insert: 'x' } }).state
    expect(next.doc.toString()).toBe(DOC)
  })
  it('leaving Present restores the per-tab toggle', () => {
    const s = makePresent(DOC, DOC.length, false)
    const edit = s.update({ effects: modeCompartment.reconfigure(modeExtensions('edit')) }).state
    expect(collapsed(edit)).toEqual([])
    const hidden = makePresent(DOC, DOC.length, true)
    const edit2 = hidden.update({
      effects: modeCompartment.reconfigure(modeExtensions('edit')),
    }).state
    expect(collapsed(edit2)).toEqual([`header-fold@0-${END}`])
  })
  it('a note without title fields shows nothing in Present', () => {
    const doc = '---\ntoc: false\n---\n\n# Body'
    const s = makePresent(doc, doc.length)
    let dom: HTMLElement | null = null
    s.field(headerFold).between(0, doc.length, (_f, _t, d) => {
      dom = (d.spec.widget as { toDOM(): HTMLElement }).toDOM()
    })
    expect((dom as HTMLElement | null)?.classList.contains('mdo-titleblock-none')).toBe(true)
    expect((dom as HTMLElement | null)?.textContent).toBe('')
  })
})

describe('moveOutOfHeader', () => {
  it('moves a cursor inside the front matter after it, else does nothing', () => {
    const inside = EditorState.create({ doc: DOC, selection: { anchor: 5 } })
    expect(inside.update(moveOutOfHeader(inside)).state.selection.main.head).toBe(END + 1)
    const outside = EditorState.create({ doc: DOC, selection: { anchor: DOC.length } })
    expect(moveOutOfHeader(outside)).toEqual({})
  })
})

describe('hardening', () => {
  const HEAD = '---\ntitle: "Kickoff"\n---'
  function pv(text: string, mode: 'edit' | 'present' = 'present') {
    const parent = document.createElement('div')
    document.body.append(parent)
    return new EditorView({ state: createState(text, '\n', 'preview', false, mode), parent })
  }

  it('a header-only note stays editable in Present', async () => {
    const v = pv('---\na: 1\n---')
    expect(collapsed(v.state)).toEqual([])
    v.dispatch({ changes: { from: v.state.doc.length, insert: '\nText' }, userEvent: 'input' })
    expect(v.state.doc.toString()).toBe('---\na: 1\n---\nText')
    expect(collapsed(v.state)).toEqual(['header-fold@0-12'])
    await Promise.resolve()
    expect(v.state.selection.main.head).toBeGreaterThanOrEqual(13)
    v.destroy()
  })

  it('undo that lands in the collapsed header moves the cursor out', async () => {
    const v = pv(`${HEAD}\nBody`, 'edit')
    v.dispatch({ effects: viewCompartment.reconfigure(viewExtensions('code')) })
    v.dispatch({ changes: { from: 4, insert: 'x' }, selection: { anchor: 5 }, userEvent: 'input' })
    v.dispatch({
      effects: [
        viewCompartment.reconfigure(viewExtensions('preview')),
        modeCompartment.reconfigure(modeExtensions('present')),
      ],
    })
    v.dispatch(moveOutOfHeader(v.state))
    undo(v)
    await Promise.resolve()
    await Promise.resolve()
    expect(v.state.doc.toString()).toBe(`${HEAD}\nBody`)
    expect(v.state.selection.main.head).toBeGreaterThanOrEqual(HEAD.length + 1)
    v.destroy()
  })

  it('the deferred move-out does not dispatch to a view destroyed in the meantime', async () => {
    const v = pv(`${HEAD}\nBody`, 'edit')
    v.dispatch({ effects: viewCompartment.reconfigure(viewExtensions('code')) })
    v.dispatch({ changes: { from: 4, insert: 'x' }, selection: { anchor: 5 }, userEvent: 'input' })
    v.dispatch({
      effects: [
        viewCompartment.reconfigure(viewExtensions('preview')),
        modeCompartment.reconfigure(modeExtensions('present')),
      ],
    })
    v.dispatch(moveOutOfHeader(v.state))
    undo(v)
    const dispatched: unknown[] = []
    const original = v.dispatch.bind(v)
    v.dispatch = ((...args: Parameters<EditorView['dispatch']>) => {
      dispatched.push(args)
      original(...args)
    }) as EditorView['dispatch']
    v.destroy()
    await Promise.resolve()
    await Promise.resolve()
    expect(dispatched).toEqual([])
  })

  it('leaving Present with the toggle on and no title fields shows the marker', () => {
    const doc = '---\ntoc: false\n---\n\n# Body'
    const text = (s: EditorState) => {
      let out = ''
      s.field(headerFold).between(0, doc.length, (_f, _t, d) => {
        out = (d.spec.widget as { toDOM(): HTMLElement }).toDOM().textContent ?? ''
      })
      return out
    }
    const s = makePresent(doc, doc.length, true)
    expect(text(s)).toBe('')
    const edit = s.update({ effects: modeCompartment.reconfigure(modeExtensions('edit')) }).state
    expect(text(edit)).toBe('⋯ YAML-Header')
  })

  it('Present keystrokes leave the header bytes unchanged', () => {
    const body = `${HEAD}\nBody`
    const v = pv(body)
    v.dispatch({ selection: { anchor: HEAD.length + 1 } })
    deleteCharBackward(v)
    expect(v.state.doc.toString()).toBe(body)
    cursorDocStart(v)
    v.dispatch(v.state.replaceSelection('z'))
    expect(v.state.doc.sliceString(0, HEAD.length)).toBe(HEAD)
    selectAll(v)
    deleteCharBackward(v)
    expect(v.state.doc.sliceString(0, HEAD.length)).toBe(HEAD)
    v.destroy()
  })
})
