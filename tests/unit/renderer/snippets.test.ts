// @vitest-environment happy-dom
import {
  acceptCompletion,
  CompletionContext,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { beforeEach, describe, expect, it } from 'vitest'
import { headerFold } from '../../../src/renderer/editor/header'
import { createState } from '../../../src/renderer/editor/setup'
import { snippetRegistry, snippetSource } from '../../../src/renderer/editor/snippets'

const ctx = (doc: string, explicit = false) => {
  const state = EditorState.create({ doc })
  return new CompletionContext(state, doc.length, explicit)
}
const labels = (doc: string, explicit = false) =>
  snippetSource(ctx(doc, explicit))?.options.map((o) => o.label) ?? null

beforeEach(() => snippetRegistry.setUser([]))

describe('snippetSource', () => {
  it.each([
    [':m', true],
    ['Text :me', true],
    ['- :auf', true],
    [':', false],
    ['Hinweis:', false],
    ['10:30', false],
    ['a:b', false],
    ['Uhrzeit: ', false],
  ])('%j offers snippets: %s', (doc, offered) => {
    expect(labels(doc) !== null).toBe(offered)
  })

  it('a bare colon offers all on explicit request (Ctrl+Space)', () => {
    expect(labels(':', true)).toEqual([
      ':aufgabe',
      ':header',
      ':meeting',
      ':newpage',
      ':telefonnotiz',
    ])
  })

  it.each([
    ['Super :D', null],
    [':P', null],
    [':me', [':meeting']],
    [':H', [':header']],
  ])('prefix filter %j -> %j', (doc, expected) => {
    expect(labels(doc)).toEqual(expected)
  })

  it('replaces from the colon', () => {
    expect(snippetSource(ctx('x :mee'))?.from).toBe(2)
  })

  it('matches combining marks like the name regex', () => {
    const name = 'cafe\u0301'
    snippetRegistry.setUser([{ name, body: 'x', source: 'user' }])
    expect(labels(`:${name}`)).toEqual([`:${name}`])
  })

  it('user snippets override built-ins and add new ones', () => {
    snippetRegistry.setUser([
      { name: 'meeting', body: 'mine', source: 'user' },
      { name: 'zz', body: 'z', source: 'user' },
    ])
    const list = snippetRegistry.list()
    expect(list.find((s) => s.name === 'meeting')?.body).toBe('mine')
    expect(list.map((s) => s.name)).toContain('zz')
  })
})

const tick = () => new Promise((r) => setTimeout(r, 0))
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !cond(); i++) await tick()
}
// CodeMirror ignores accept keys for `interactionDelay` (75 ms) after the list opens.
async function open(view: EditorView): Promise<void> {
  await until(() => completionStatus(view.state) === 'active')
  expect(completionStatus(view.state)).toBe('active')
  await new Promise((r) => setTimeout(r, 90))
}
function mount(doc: string, mode: 'edit' | 'present' = 'edit', headerHidden = false): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    state: createState(doc, '\n', 'preview', headerHidden, mode),
    parent,
  })
  view.dispatch({ selection: { anchor: doc.length } })
  return view
}
const type = (view: EditorView, text: string) => {
  const to = view.state.selection.main.head
  view.dispatch({
    changes: { from: to, insert: text },
    selection: { anchor: to + text.length },
    userEvent: 'input.type',
  })
}
const sel = (view: EditorView) => {
  const r = view.state.selection.main
  return view.state.sliceDoc(r.from, r.to)
}
const key = (view: EditorView, k: string, shiftKey = false) =>
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: k, shiftKey }), 'editor')

describe('snippet completion in the editor', () => {
  it('inserts :meeting, selects the first field and walks tab stops', async () => {
    const view = mount('')
    type(view, ':mee')
    startCompletion(view)
    await open(view)
    acceptCompletion(view)
    expect(view.state.doc.toString().startsWith('---\nclient: "Kunde"')).toBe(true)
    expect(sel(view)).toBe('Kunde')
    expect(key(view, 'Tab')).toBe(true)
    expect(sel(view)).toBe('Thema')
    view.destroy()
  })

  it('Tab accepts an open list; Enter does too', async () => {
    const view = mount(':mee')
    startCompletion(view)
    await open(view)
    expect(key(view, 'Tab')).toBe(true)
    expect(view.state.doc.toString().startsWith('---\n')).toBe(true)
    view.destroy()
  })

  it('with a session and no list, Tab goes to the next field, not indent', async () => {
    const view = mount(':mee')
    startCompletion(view)
    await open(view)
    acceptCompletion(view)
    expect(completionStatus(view.state)).toBeNull()
    const before = view.state.doc.toString()
    key(view, 'Tab')
    expect(sel(view)).toBe('Thema')
    expect(view.state.doc.toString()).toBe(before)
    view.destroy()
  })

  it('with neither list nor session, Tab falls through to indentWithTab', () => {
    const view = mount('abc')
    expect(completionStatus(view.state)).toBeNull()
    expect(key(view, 'Tab')).toBe(true)
    expect(view.state.doc.toString()).not.toBe('abc')
    expect(indentWithTab.key).toBe('Tab')
    view.destroy()
  })

  it('Tab accepts an open list even inside an active snippet field', async () => {
    const view = mount(':mee')
    startCompletion(view)
    await open(view)
    acceptCompletion(view)
    expect(sel(view)).toBe('Kunde')
    // Type a snippet trigger inside the field: list open + session active.
    type(view, ' :tel')
    startCompletion(view)
    await open(view)
    expect(key(view, 'Tab')).toBe(true)
    expect(view.state.doc.toString()).not.toContain(':tel')
    view.destroy()
  })

  it('Enter after a prose colon inserts a newline only', async () => {
    const view = mount('Hinweis:')
    expect(key(view, 'Enter')).toBe(true)
    await tick()
    expect(view.state.doc.toString()).toBe('Hinweis:\n')
    expect(completionStatus(view.state)).toBeNull()
    view.destroy()
  })

  it('a trailing colon in prose never opens the list', async () => {
    const view = mount('Hinweis')
    type(view, ':')
    // Typing-triggered completion starts after activateOnTypingDelay (100 ms).
    await new Promise((r) => setTimeout(r, 250))
    expect(completionStatus(view.state)).toBeNull()
    expect(view.state.doc.toString()).toBe('Hinweis:')
    view.destroy()
  })

  it('Escape with an open list is preventDefault-ed, so Present stays open', async () => {
    const view = mount(':mee')
    startCompletion(view)
    await open(view)
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    view.contentDOM.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(completionStatus(view.state)).toBeNull()
    const second = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    view.contentDOM.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    view.destroy()
  })
})

const isCollapsed = (view: EditorView) => view.state.field(headerFold).size > 0
const fill = (view: EditorView, text: string) =>
  view.dispatch(view.state.update(view.state.replaceSelection(text), { userEvent: 'input.type' }))
async function insertMeeting(view: EditorView): Promise<void> {
  type(view, ':mee')
  startCompletion(view)
  await open(view)
  acceptCompletion(view)
}

describe('Shift+Tab', () => {
  it('goes back to the previous field', async () => {
    const view = mount('')
    await insertMeeting(view)
    key(view, 'Tab')
    expect(sel(view)).toBe('Thema')
    expect(key(view, 'Tab', true)).toBe(true)
    expect(sel(view)).toBe('Kunde')
    view.destroy()
  })

  it('reaches a header field again while the header is hidden (Edit)', async () => {
    const view = mount('', 'edit', true)
    await insertMeeting(view)
    key(view, 'Tab')
    key(view, 'Tab')
    expect(sel(view)).toBe('Name')
    expect(isCollapsed(view)).toBe(true)
    key(view, 'Tab', true)
    expect(sel(view)).toBe('Thema')
    expect(isCollapsed(view)).toBe(false)
    view.destroy()
  })
})

describe('header snippets in Present', () => {
  it('keeps the header open while a field inside it is active, then collapses it', async () => {
    const view = mount('', 'present')
    await insertMeeting(view)
    expect(sel(view)).toBe('Kunde')
    expect(isCollapsed(view)).toBe(false)
    fill(view, 'ACME')
    expect(key(view, 'Tab')).toBe(true)
    expect(sel(view)).toBe('Thema')
    expect(isCollapsed(view)).toBe(false)
    fill(view, 'Kickoff')
    for (const stop of ['Name', 'Punkt', '', 'Aufgabe', 'Name', 'Datum']) {
      expect(key(view, 'Tab')).toBe(true)
      expect(sel(view)).toBe(stop)
      expect(isCollapsed(view)).toBe(true)
    }
    const before = view.state.doc.toString()
    expect(key(view, 'Tab')).toBe(true) // to $0: the session ends
    expect(view.state.doc.toString()).toBe(before)
    expect(view.state.selection.main.head).toBe(before.length - 1) // $0 before the final newline
    await tick()
    expect(before.startsWith('---\nclient: "ACME"\ntitle: "Kickoff"\n')).toBe(true)
    expect(isCollapsed(view)).toBe(true)
    // Read-only and the cursor stays out again.
    view.dispatch({ changes: { from: 4, insert: 'x' } })
    expect(view.state.doc.toString()).toBe(before)
    view.dispatch({ selection: { anchor: 2 } })
    expect(view.state.selection.main.head).toBeGreaterThan(view.state.doc.line(7).from - 1)
    view.destroy()
  })

  it('Shift+Tab from the body back into the header opens it again', async () => {
    const view = mount('', 'present')
    await insertMeeting(view)
    key(view, 'Tab')
    key(view, 'Tab')
    expect(isCollapsed(view)).toBe(true)
    expect(key(view, 'Tab', true)).toBe(true)
    expect(sel(view)).toBe('Thema')
    expect(isCollapsed(view)).toBe(false)
    fill(view, 'Neu')
    expect(view.state.doc.toString()).toContain('title: "Neu"')
    view.destroy()
  })

  it('Escape inside a header field ends the session, collapses and moves the cursor out', async () => {
    const view = mount('', 'present')
    await insertMeeting(view)
    fill(view, 'ACME')
    // Let the typing-triggered completion query settle, so Esc reaches the snippet keymap.
    await until(() => completionStatus(view.state) === null)
    await new Promise((r) => setTimeout(r, 250))
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    view.contentDOM.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(isCollapsed(view)).toBe(true)
    await tick()
    const end = view.state.doc.toString().indexOf('\n---\n') + 4
    expect(view.state.selection.main.head).toBeGreaterThan(end)
    expect(view.state.doc.toString()).toContain('client: "ACME"')
    view.destroy()
  })

  it(':telefonnotiz and :header also stay reachable', async () => {
    for (const [trigger, first, second] of [
      [':tel', 'Firma', 'Name'],
      [':hea', 'Titel', ''],
    ] as const) {
      const view = mount('', 'present')
      type(view, trigger)
      startCompletion(view)
      await open(view)
      acceptCompletion(view)
      expect(sel(view)).toBe(first)
      expect(isCollapsed(view)).toBe(false)
      key(view, 'Tab')
      expect(sel(view)).toBe(second)
      expect(isCollapsed(view)).toBe(false)
      view.destroy()
    }
  })
})
