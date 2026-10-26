// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toolbar } from '../../../src/renderer/ui/toolbar'
import type { MenuCommand, Session } from '../../../src/shared/types'

/**
 * App-level wiring of the formatting toolbar (spec section 2 „Wiring in App“): a real App over a
 * fake window.mdo. Every bridge method not named below returns a promise that never settles,
 * so the set check, preview inputs and snippets simply stay pending.
 */

const NOTE = '/notes/a.md'
const PROFILE = '/notes/p.yaml'

let menu: (cmd: MenuCommand) => void
let frames: FrameRequestCallback[]
let saved: unknown[]

function fakeMdo(session: Partial<Session>, files: Record<string, string>) {
  const known: Record<string, unknown> = {
    startup: async () => ({
      session: {
        tabs: [],
        activeIndex: 0,
        mode: 'edit',
        view: 'code',
        zoom: { edit: 1, present: 1 },
        outline: { edit: false, present: false },
        toolbar: { edit: true },
        recent: [],
        ...session,
      },
      openPaths: [],
      settings: {
        defaultFolder: '/notes',
        snippetFolder: '/notes/Snippets',
        presentFontFactor: 1.6,
        headerDefault: 'yaml',
        spellcheck: false,
        dictionaryAutoUpdate: false,
      },
    }),
    readNote: async (path: string) =>
      path in files
        ? { text: files[path], eol: '\n', bom: false, hash: 'h' }
        : { error: 'missing' },
    watch: async () => undefined,
    saveSession: async (patch: unknown) => {
      saved.push(patch)
    },
    setFullScreen: async () => undefined,
    onMenu: (cb: (cmd: MenuCommand) => void) => {
      menu = cb
    },
  }
  return new Proxy(known, {
    get: (target, key: string) =>
      key in target
        ? target[key]
        : key.startsWith('on')
          ? () => undefined
          : () => new Promise(() => {}),
  })
}

async function start(session: Partial<Session>, files: Record<string, string>) {
  ;(window as unknown as { mdo: unknown }).mdo = fakeMdo(session, files)
  // The index.html skeleton App needs (ids only).
  const el = (tag: string, id: string, hidden = false) => {
    const e = document.createElement(tag)
    e.id = id
    e.hidden = hidden
    return e
  }
  document.body.replaceChildren(
    el('div', 'tabbar'),
    el('div', 'toolbar', true),
    el('div', 'editor'),
    el('hr', 'outline-grip', true),
    el('nav', 'outline', true),
    el('div', 'empty', true),
    el('footer', 'status'),
    el('footer', 'infoline', true),
    el('div', 'notices'),
  )
  const byId = (id: string) => document.getElementById(id) as HTMLElement
  const { App } = await import('../../../src/renderer/app')
  const app = new App({
    tabbar: byId('tabbar'),
    toolbar: byId('toolbar'),
    editor: byId('editor'),
    empty: byId('empty'),
    status: byId('status'),
    infoline: byId('infoline'),
    outline: byId('outline'),
    outlineGrip: byId('outline-grip'),
    notices: byId('notices'),
  })
  await app.start()
  const view = EditorView.findFromDOM(byId('editor')) as EditorView
  const bar = byId('toolbar')
  const q = (id: string) => document.querySelector(`[data-testid=${id}]`) as HTMLButtonElement
  const flush = () => {
    for (const f of frames.splice(0)) f(0)
  }
  return { app, view, bar, q, flush }
}

// happy-dom fires selectionchange synchronously while CodeMirror writes the DOM selection of a
// focused editor, re-entering its update; a real browser fires it later. Kept from the editor.
const swallow = (e: Event) => e.stopImmediatePropagation()

beforeEach(() => {
  window.addEventListener('selectionchange', swallow, true)
  frames = []
  saved = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
})
afterEach(() => {
  window.removeEventListener('selectionchange', swallow, true)
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('App: formatting toolbar wiring', () => {
  it('a toolbar click and the menu command run the same command', async () => {
    const { view, q } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: 'Wort',
      },
    )
    view.dispatch({ selection: { anchor: 1 } })
    q('fmt-bold').click()
    expect(view.state.doc.toString()).toBe('**Wort**')
    menu('format-bold')
    expect(view.state.doc.toString()).toBe('Wort')
  })

  it('format commands are ignored with a text field focused or behind a dialog', async () => {
    const { view } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: 'Wort',
      },
    )
    view.dispatch({ selection: { anchor: 1 } })
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    menu('format-italic')
    expect(view.state.doc.toString()).toBe('Wort')
    input.remove()
    const dialog = document.createElement('dialog')
    document.body.append(dialog)
    dialog.setAttribute('open', '')
    view.focus()
    menu('format-italic')
    menu('insert-alert-note')
    expect(view.state.doc.toString()).toBe('Wort')
  })

  it('hidden in Present (commands silent there), shown again after it', async () => {
    const { view, bar } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: 'Wort',
      },
    )
    expect(bar.hidden).toBe(false)
    menu('toggle-present')
    await new Promise((r) => setTimeout(r, 0))
    expect(bar.hidden).toBe(true)
    view.dispatch({ selection: { anchor: 1 } })
    menu('format-bold')
    expect(view.state.doc.toString()).toBe('Wort')
    expect(document.querySelector('#notices')?.textContent).toBe('')
    menu('toggle-present')
    await new Promise((r) => setTimeout(r, 0))
    expect(bar.hidden).toBe(false)
  })

  it('shown but disabled on a profile tab; menu commands ignored there', async () => {
    const { view, q, bar } = await start(
      { tabs: [{ path: PROFILE, headerHidden: false }] },
      {
        [PROFILE]: 'a: 1',
      },
    )
    expect(bar.hidden).toBe(false)
    expect(q('fmt-bold').disabled).toBe(true)
    menu('format-h1')
    expect(view.state.doc.toString()).toBe('a: 1')
  })

  it('toggle-toolbar and the „Leiste“ switch hide and show it and persist the choice', async () => {
    const { bar, q } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: 'Wort',
      },
    )
    menu('toggle-toolbar')
    expect(bar.hidden).toBe(true)
    expect(q('status-toolbar').getAttribute('aria-pressed')).toBe('false')
    expect(saved).toContainEqual({ toolbar: { edit: false } })
    q('status-toolbar').click()
    expect(bar.hidden).toBe(false)
    expect(saved).toContainEqual({ toolbar: { edit: true } })
  })

  it('starts hidden when the session says so', async () => {
    const { bar } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }], toolbar: { edit: false } },
      { [NOTE]: 'Wort' },
    )
    expect(bar.hidden).toBe(true)
  })

  it('active state follows the cursor once per frame', async () => {
    const { view, q, flush } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: '**fett** normal',
      },
    )
    flush()
    view.dispatch({ selection: { anchor: 11 } })
    flush()
    expect(q('fmt-bold').getAttribute('aria-pressed')).toBe('false')
    const render = vi.spyOn(Toolbar.prototype, 'render')
    view.dispatch({ selection: { anchor: 3 } })
    view.dispatch({ selection: { anchor: 4 } })
    // Not yet: two transactions wait for the next frame.
    expect(render).not.toHaveBeenCalled()
    expect(q('fmt-bold').getAttribute('aria-pressed')).toBe('false')
    flush()
    expect(render).toHaveBeenCalledOnce()
    expect(q('fmt-bold').getAttribute('aria-pressed')).toBe('true')
    render.mockRestore()
    view.dispatch({ selection: { anchor: 12 } })
    flush()
    expect(q('fmt-bold').getAttribute('aria-pressed')).toBe('false')
  })

  it('typing re-renders it once per frame, not per keystroke', async () => {
    const { view, q, flush } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: 'normal',
      },
    )
    flush()
    const render = vi.spyOn(Toolbar.prototype, 'render')
    // Doc changes run App.refresh() (tab bar, status line); the toolbar waits for the frame.
    view.dispatch({ changes: { from: 0, insert: '**fett** ' }, selection: { anchor: 3 } })
    view.dispatch({ changes: { from: 3, insert: 'x' } })
    expect(render).not.toHaveBeenCalled()
    flush()
    expect(render).toHaveBeenCalledOnce()
    expect(q('fmt-bold').getAttribute('aria-pressed')).toBe('true')
    render.mockRestore()
  })

  it('a reconfigure (view switch) refreshes it at once, without waiting for a frame', async () => {
    const { view, q } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: '**fett** normal',
      },
    )
    view.dispatch({ selection: { anchor: 3 } })
    menu('toggle-view')
    expect(q('fmt-bold').getAttribute('aria-pressed')).toBe('true')
  })

  it('without a note the toolbar and the „Leiste“ switch rest', async () => {
    const { bar, q } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: 'Wort',
      },
    )
    menu('close-tab')
    await new Promise((r) => setTimeout(r, 0))
    expect(document.getElementById('empty')?.hidden).toBe(false)
    expect(bar.hidden).toBe(true)
    expect(q('status-toolbar').disabled).toBe(true)
  })

  it('Link reads the clipboard only on the click and re-checks after the read', async () => {
    const { view } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: 'Wort',
      },
    )
    let answer: (text: string) => void = () => {}
    const readText = vi.fn(() => new Promise<string>((r) => (answer = r)))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { readText } })
    expect(readText).not.toHaveBeenCalled()
    view.dispatch({ selection: { anchor: 0, head: 4 } })
    menu('format-link')
    expect(readText).toHaveBeenCalledOnce()
    answer('https://example.org')
    await new Promise((r) => setTimeout(r, 0))
    expect(view.state.doc.toString()).toBe('[Wort](https://example.org)')

    // A dialog opened while the clipboard was read: the link is dropped.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Neu' } })
    view.dispatch({ selection: { anchor: 0, head: 3 } })
    menu('format-link')
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    answer('https://example.org')
    await new Promise((r) => setTimeout(r, 0))
    expect(view.state.doc.toString()).toBe('Neu')
  })

  it('the page-break button acts on the editor even with a text field focused', async () => {
    const { view, q } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: 'Wort',
      },
    )
    view.dispatch({ selection: { anchor: 4 } })
    // E.g. the editor's search input: Mod+Enter would be ignored there (editCommand's field
    // branch), the toolbar button is aimed at the document like its siblings.
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    q('fmt-pagebreak').click()
    expect(view.state.doc.toString()).toBe('Wort\n\n<!-- pagebreak -->\n\n')
    input.remove()
    // The menu command keeps its editCommand route: ignored while a field has focus.
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    menu('insert-pagebreak')
    expect(view.state.doc.toString()).toBe('Wort\n\n<!-- pagebreak -->\n\n')
    field.remove()
  })

  it('Einfügen → Tabelle … asks for the size, then inserts the table', async () => {
    const { view } = await start(
      { tabs: [{ path: NOTE, headerHidden: false }] },
      {
        [NOTE]: '',
      },
    )
    menu('insert-table')
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    expect(dialog?.open).toBe(true)
    const [cols, rows] = [...dialog.querySelectorAll('input')]
    if (!cols || !rows) throw new Error('fields missing')
    cols.value = '2'
    rows.value = '3'
    dialog.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await new Promise((r) => setTimeout(r, 0))
    // Header, delimiter and two body rows (3 rows with the header); blank-line handling is
    // table-edit.ts's business and tested there.
    expect(view.state.doc.toString().split('\n').slice(0, 4)).toEqual([
      '|   |   |',
      '| --- | --- |',
      '|   |   |',
      '|   |   |',
    ])
  })
})
