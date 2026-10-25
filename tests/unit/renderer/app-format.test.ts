// @vitest-environment happy-dom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { modeCompartment, modeExtensions } from '../../../src/renderer/editor/mode'
import { createState, freezeSpec } from '../../../src/renderer/editor/setup'
import { allowedWithDialog } from '../../../src/renderer/ui/edit-target'
import {
  FORMAT_COMMANDS,
  FrameThrottle,
  formatAction,
  formatShown,
  readClipboardText,
  runFormatAction,
  toolbarState,
} from '../../../src/renderer/ui/format-wiring'
import type { MenuCommand } from '../../../src/shared/types'
import { parsed } from './parsed'

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})

function view(text: string, at: number, kind: 'markdown' | 'yaml' = 'markdown'): EditorView {
  let state = parsed(createState(text, '\n', 'code', false, 'edit', false, kind))
  state = state.update({ selection: EditorSelection.single(at) }).state
  const v = new EditorView({ state, parent: document.body })
  views.push(v)
  return v
}

describe('format menu commands', () => {
  it('map onto the toolbar actions (the same function for click and menu)', () => {
    expect(formatAction('format-bold')).toEqual({ kind: 'format', id: 'bold' })
    expect(formatAction('format-link')).toEqual({ kind: 'format', id: 'link' })
    expect(formatAction('insert-alert-warning')).toEqual({ kind: 'alert', type: 'warning' })
    expect(formatAction('table-col-delete')).toEqual({ kind: 'table', op: 'col-delete' })
    // The size comes from the dialog, so insert-table has no action of its own.
    expect(formatAction('insert-table')).toBeNull()
    expect(formatAction('undo')).toBeNull()
    expect(formatAction('insert-pagebreak')).toBeNull()
  })

  it('are dropped behind an open dialog (not in DIALOG_COMMANDS)', () => {
    for (const cmd of FORMAT_COMMANDS) expect(allowedWithDialog(cmd, true)).toBe(false)
    expect(FORMAT_COMMANDS.has('insert-table')).toBe(true)
    expect(FORMAT_COMMANDS.has('toggle-toolbar')).toBe(false)
  })
})

describe('runFormatAction', () => {
  it('runs a format, an alert and a table command on the view', () => {
    const v = view('Wort', 1)
    expect(runFormatAction(v, { kind: 'format', id: 'bold' })).toBe(true)
    expect(v.state.doc.toString()).toBe('**Wort**')
    const t = view('| a | b |\n| --- | --- |\n| 1 | 2 |', 2)
    expect(runFormatAction(t, { kind: 'table', op: 'row-below' })).toBe(true)
    expect(t.state.doc.lines).toBe(4)
    const i = view('', 0)
    expect(runFormatAction(i, { kind: 'table-insert', cols: 2, rows: 2 })).toBe(true)
    expect(i.state.doc.toString()).toContain('| --- | --- |')
    const a = view('', 0)
    expect(runFormatAction(a, { kind: 'alert', type: 'tip' })).toBe(true)
    expect(a.state.doc.toString()).toContain('> [!TIP]')
  })

  it('link takes the clipboard text only when it is one URL', () => {
    const v = view('Wort', 0)
    v.dispatch({ selection: EditorSelection.single(0, 4) })
    expect(runFormatAction(v, { kind: 'format', id: 'link' }, 'https://example.org')).toBe(true)
    expect(v.state.doc.toString()).toBe('[Wort](https://example.org)')
  })

  it('a frozen editor and Present refuse without a change', () => {
    const v = view('Wort', 1)
    v.dispatch(freezeSpec(true))
    expect(runFormatAction(v, { kind: 'format', id: 'bold' })).toBe(false)
    const p = view('Wort', 1)
    p.dispatch({ effects: modeCompartment.reconfigure(modeExtensions('present')) })
    expect(runFormatAction(p, { kind: 'format', id: 'italic' })).toBe(false)
    expect(p.state.doc.toString()).toBe('Wort')
  })
})

describe('formatShown (where a command acts)', () => {
  const base = { closing: false, mode: 'edit', shown: 'markdown', target: 'editor' } as const
  it('acts on the editor of a shown note in Edit mode', () => {
    expect(formatShown(base)).toBe(true)
    // A toolbar click: focus may sit on the button or the outline, the editor is meant.
    expect(formatShown({ ...base, target: 'toolbar' })).toBe(true)
  })
  it.each([
    ['a focused text field', { target: 'field' }],
    ['an open dialog', { target: 'blocked' }],
    ['Present', { mode: 'present' }],
    ['a profile (YAML) tab', { shown: 'profile' }],
    ['no note', { shown: 'none' }],
    ['a closing window', { closing: true }],
  ] as const)('is ignored with %s', (_name, over) => {
    expect(formatShown({ ...base, ...over })).toBe(false)
  })
})

describe('toolbarState', () => {
  it('hidden in Present, without a note and when switched off', () => {
    const s = view('**a**', 2).state
    const on = { mode: 'edit', on: true, shown: 'markdown', state: s } as const
    expect(toolbarState(on).visible).toBe(true)
    expect(toolbarState({ ...on, mode: 'present' }).visible).toBe(false)
    expect(toolbarState({ ...on, shown: 'none', state: null }).visible).toBe(false)
    expect(toolbarState({ ...on, on: false }).visible).toBe(false)
  })

  it('shown but disabled on a profile tab and in a frozen editor, without active state', () => {
    const y = view('a: 1', 0, 'yaml').state
    const profile = toolbarState({ mode: 'edit', on: true, shown: 'profile', state: y })
    expect(profile).toMatchObject({ visible: true, enabled: false })
    expect(profile.active.size).toBe(0)
    const v = view('**a**', 2)
    v.dispatch(freezeSpec(true))
    const frozen = toolbarState({ mode: 'edit', on: true, shown: 'markdown', state: v.state })
    expect(frozen).toMatchObject({ visible: true, enabled: false })
    expect(frozen.active.size).toBe(0)
  })

  it('reports the active formats and the table flags of the cursor', () => {
    const b = toolbarState({
      mode: 'edit',
      on: true,
      shown: 'markdown',
      state: view('**a**', 2).state,
    })
    expect(b.enabled).toBe(true)
    expect([...b.active]).toContain('bold')
    const t = toolbarState({
      mode: 'edit',
      on: true,
      shown: 'markdown',
      state: view('| a | b |\n| --- | --- |\n| 1 | 2 |', 30).state,
    })
    expect(t.table).toEqual({ inTable: true, rowDelete: true, colDelete: true })
    expect(t.active.has('table')).toBe(true)
  })
})

describe('FrameThrottle', () => {
  it('runs once per frame however often it is scheduled; now() runs at once', () => {
    const frames: FrameRequestCallback[] = []
    const run = vi.fn()
    const t = new FrameThrottle(run, (cb) => {
      frames.push(cb)
      return frames.length
    })
    t.schedule()
    t.schedule()
    t.schedule()
    expect(run).not.toHaveBeenCalled()
    expect(frames).toHaveLength(1)
    frames[0]?.(0)
    expect(run).toHaveBeenCalledTimes(1)
    t.schedule()
    expect(frames).toHaveLength(2)
    t.now()
    expect(run).toHaveBeenCalledTimes(2)
    // The frame scheduled before now() has nothing left to do.
    frames[1]?.(0)
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('readClipboardText', () => {
  it('returns the text, and null when the read fails', async () => {
    expect(await readClipboardText(async () => 'https://a.de')).toBe('https://a.de')
    expect(
      await readClipboardText(async () => {
        throw new Error('denied')
      }),
    ).toBeNull()
  })
})

// Every new menu command is handled: either a format action, the size dialog or the toggle.
describe('menu command coverage', () => {
  it('each FORMAT_COMMAND except insert-table has an action', () => {
    for (const cmd of FORMAT_COMMANDS as ReadonlySet<MenuCommand>) {
      if (cmd === 'insert-table') continue
      expect(formatAction(cmd), cmd).not.toBeNull()
    }
    expect(FORMAT_COMMANDS.size).toBe(23)
  })
})
