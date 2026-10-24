// @vitest-environment happy-dom
import { history, redo, undo } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, type WidgetType } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { mdoMarkdown } from '../../../src/renderer/editor/markdown'
import { createMath } from '../../../src/renderer/editor/math'
import type { MathService } from '../../../src/renderer/editor/math-render'
import { mathRefresh } from '../../../src/renderer/editor/math-render'
import { presentMode } from '../../../src/renderer/editor/mode'
import { previewView } from '../../../src/renderer/editor/rendered'
import { okEntry, stubService } from './math-stub'
import { parsed } from './parsed'

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})

function mount(
  doc: string,
  cursor: number,
  service: MathService,
  extra: Extension[] = [previewView.of(true)],
  math = createMath({ service }),
): EditorView {
  const state = parsed(
    EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [history(), mdoMarkdown(), ...extra, math.extension],
    }),
  )
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({ state, parent })
  views.push(view)
  return view
}

const moveTo = (view: EditorView, anchor: number) => view.dispatch({ selection: { anchor } })

describe('inline formula widget', () => {
  const DOC = 'a $x$ b'

  it('replaces a formula whose result is there by its SVG; the note keeps its bytes', () => {
    const service = stubService({ 'I:x': okEntry() })
    const view = mount(DOC, DOC.length, service)
    const svgs = view.dom.querySelectorAll('.mdo-math-inline svg')
    expect(svgs).toHaveLength(1)
    expect(view.dom.querySelector('.cm-content')?.textContent).not.toContain('$x$')
    expect(view.state.doc.toString()).toBe(DOC)
  })

  it('sizes the clone in em from the entry and lowers it by its depth', () => {
    const service = stubService({ 'I:x': okEntry('mdo-mxT', 1.25, 0.9, 0.2) })
    const view = mount(DOC, DOC.length, service)
    const svg = view.dom.querySelector('.mdo-math-inline svg') as SVGSVGElement
    expect(svg.style.width).toBe('1.25em')
    expect(svg.style.height).toBe('0.9em')
    expect(svg.style.verticalAlign).toBe('-0.2em')
  })

  it('shows a clone with ids of its own, the cached SVG stays detached', () => {
    const entry = okEntry()
    const service = stubService({ 'I:x': entry })
    const view = mount('a $x$ b $x$', 0, service)
    const ids = Array.from(view.dom.querySelectorAll('.mdo-math-inline symbol')).map((s) => s.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain('mdo-mxT-g1')
    const use = view.dom.querySelector('.mdo-math-inline use')
    expect(use?.getAttribute('href')).toBe(`#${ids[0]}`)
    expect(entry.state === 'ok' && entry.svg.isConnected).toBe(false)
  })

  it('shows the source while the cursor is in the formula', () => {
    const service = stubService({ 'I:x': okEntry() })
    const view = mount(DOC, 3, service)
    expect(view.dom.querySelector('.mdo-math-inline')).toBeNull()
    expect(view.dom.querySelector('.cm-content')?.textContent).toContain('$x$')
  })

  it('keeps the source in the Code view and asks for nothing', () => {
    const service = stubService({ 'I:x': okEntry() })
    const view = mount(DOC, DOC.length, service, [])
    expect(view.dom.querySelector('.mdo-math-inline')).toBeNull()
    expect(service.requests).toEqual([])
  })

  it('flags a formula the PDF cannot build, with mitex’s message as tooltip', () => {
    const tex = '\\ce{H2O}'
    const service = stubService({
      [`I:${tex}`]: { state: 'error', message: 'unknown command: \\ce' },
    })
    const view = mount(`a $${tex}$ b`, 0, service)
    const flagged = view.dom.querySelector(
      '.mdo-math-error[title="Formel wird im PDF nicht gebaut: unknown command: \\\\ce"]',
    )
    expect(flagged?.textContent).toBe(`$${tex}$`)
    expect(view.dom.querySelector('.mdo-math-inline')).toBeNull()
  })

  it('shows a pending formula as muted source and requests it', () => {
    const service = stubService()
    const view = mount(DOC, DOC.length, service)
    expect(view.dom.querySelector('.mdo-math-pending')?.textContent).toBe('$x$')
    expect(service.requests.flat()).toContain('I:x')
  })

  it('redraws once the service has the result', async () => {
    const service = stubService()
    const view = mount(DOC, DOC.length, service)
    service.entries.set('I:x', okEntry())
    service.emit()
    await Promise.resolve()
    expect(view.dom.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
    expect(view.dom.querySelector('.mdo-math-pending')).toBeNull()
  })

  it('a $$…$$ inside a line is set in display style, inline', () => {
    const service = stubService({ 'D:y': okEntry() })
    const view = mount('a $$y$$ b', 0, service)
    expect(view.dom.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
    expect(view.dom.querySelector('.mdo-math')).toBeNull()
  })

  it('typing outside a formula asks for no new formula', () => {
    const service = stubService({ 'I:x': okEntry() })
    const view = mount(DOC, DOC.length, service)
    view.dispatch({ changes: { from: DOC.length, insert: 'c' }, selection: { anchor: 8 } })
    view.dispatch({ changes: { from: 0, insert: 'z' }, selection: { anchor: 1 } })
    expect(service.requests.flat()).toEqual([])
    expect(view.dom.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
  })

  it('never requests the formula being typed in', () => {
    const service = stubService({ 'I:x': okEntry() })
    const view = mount(DOC, 4, service)
    view.dispatch({ changes: { from: 4, insert: 'y' }, selection: { anchor: 5 } })
    expect(service.requests.flat()).toEqual([])
  })

  it('undo after typing inside a formula shows the widget again once the cursor leaves', () => {
    const service = stubService({ 'I:x': okEntry() })
    const view = mount(DOC, 4, service)
    view.dispatch({
      changes: { from: 4, insert: 'y' },
      selection: { anchor: 5 },
      userEvent: 'input',
    })
    undo(view)
    expect(view.state.doc.toString()).toBe(DOC)
    moveTo(view, DOC.length)
    expect(view.dom.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
  })

  it('redo of typing inside a formula shows the edited formula once the cursor leaves', () => {
    const service = stubService({ 'I:x': okEntry(), 'I:xy': okEntry('mdo-mxU') })
    const view = mount(DOC, 4, service)
    view.dispatch({
      changes: { from: 4, insert: 'y' },
      selection: { anchor: 5 },
      userEvent: 'input',
    })
    undo(view)
    redo(view)
    expect(view.state.doc.toString()).toBe('a $xy$ b')
    // The cursor is back in the formula after the redo: source, nothing sent.
    expect(view.dom.querySelector('.mdo-math-inline')).toBeNull()
    expect(service.requests.flat()).toEqual([])
    moveTo(view, view.state.doc.length)
    expect(view.dom.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
    expect(view.dom.querySelector('.mdo-math-inline use')?.getAttribute('href')).toMatch(/^#mdo-mi/)
  })

  it('leaves formulas in table source to the table widget', () => {
    const service = stubService({ 'I:x': okEntry() })
    const view = mount('| a | b |\n|---|---|\n| $x$ | c |\n\nEnde', 0, service)
    expect(view.dom.querySelector('.mdo-math-inline')).toBeNull()
    expect(service.requests).toEqual([])
  })

  it('a redraw keeps the shown widget, and a click on it is left to the editor', () => {
    const service = stubService({ 'I:x': okEntry() })
    const math = createMath({ service })
    const view = mount(DOC, DOC.length, service, [previewView.of(true)], math)
    const dom = view.dom.querySelector('.mdo-math-inline')
    view.dispatch({ effects: mathRefresh.of(null) })
    expect(view.dom.querySelector('.mdo-math-inline')).toBe(dom)
    const widgets: WidgetType[] = []
    view.state.field(math.field).deco.between(0, DOC.length, (_f, _t, d) => {
      if (d.spec.widget) widgets.push(d.spec.widget as WidgetType)
    })
    expect(widgets).toHaveLength(1)
    // CodeMirror then places the cursor at the formula, and the source shows.
    expect(widgets[0]?.ignoreEvent(new Event('mousedown'))).toBe(false)
  })
})

describe('block formula widget', () => {
  const DOC = 'Davor\n\n$$\nx\n$$\n\nDanach'
  const IN_BLOCK = DOC.indexOf('x')

  it('replaces a $$ block by a centred block widget', () => {
    const service = stubService({ 'D:\nx\n': okEntry() })
    const view = mount(DOC, DOC.length, service)
    expect(view.dom.querySelectorAll('.mdo-math svg')).toHaveLength(1)
    expect(view.dom.querySelector('.mdo-math-inline')).toBeNull()
    const svg = view.dom.querySelector('.mdo-math svg') as SVGSVGElement
    expect(svg.style.width).toBe('0.6em')
    expect(svg.style.verticalAlign).toBe('')
  })

  it('shows the source while the cursor is on any of its lines', () => {
    const service = stubService({ 'D:\nx\n': okEntry() })
    const view = mount(DOC, IN_BLOCK, service)
    expect(view.dom.querySelector('.mdo-math')).toBeNull()
    expect(view.dom.querySelector('.cm-content')?.textContent).toContain('$$')
    moveTo(view, DOC.indexOf('$$\n\nDanach') + 2)
    expect(view.dom.querySelector('.mdo-math')).toBeNull()
  })

  it('draws in Present', () => {
    const service = stubService({ 'D:\nx\n': okEntry() })
    const view = mount(DOC, DOC.length, service, [previewView.of(true), presentMode.of(true)])
    expect(view.dom.querySelectorAll('.mdo-math svg')).toHaveLength(1)
  })

  it('pending and failing blocks keep their source lines, marked', () => {
    const pending = mount(DOC, DOC.length, stubService())
    expect(pending.dom.querySelectorAll('.mdo-math-pending').length).toBeGreaterThan(0)
    expect(pending.dom.querySelector('.mdo-math')).toBeNull()
    const failing = mount(
      DOC,
      DOC.length,
      stubService({ 'D:\nx\n': { state: 'error', message: 'kaputt' } }),
    )
    const flagged = failing.dom.querySelector('.mdo-math-error')
    expect(flagged?.getAttribute('title')).toBe('Formel wird im PDF nicht gebaut: kaputt')
  })

  it('a $$ block inside a list item stays in its line, set in display style', () => {
    const service = stubService({ 'D:x': okEntry() })
    const doc = '- $$x$$\n\nEnde'
    const view = mount(doc, doc.length, service)
    expect(view.dom.querySelector('.mdo-math')).toBeNull()
    expect(view.dom.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
  })
  it.each([
    ['list item', '- $$\n  x\n  $$\n\nEnde', '\n  x\n  '],
    ['quote', '> $$\n> x\n> $$\n\nEnde', '\nx\n'],
  ])('a multi-line $$ block in a %s is centred within the item', (_name, doc, tex) => {
    const service = stubService({ [`D:${tex}`]: okEntry() })
    const view = mount(doc, doc.length, service)
    expect(view.dom.querySelector('.mdo-math')).toBeNull()
    // One widget for the whole block, on the item's first line (marker and quote bar stay).
    const widget = view.dom.querySelector('.mdo-math-inline.mdo-math-centred')
    expect(widget).not.toBeNull()
    expect(widget?.querySelectorAll('svg')).toHaveLength(1)
    expect(view.dom.querySelectorAll('.mdo-math-inline')).toHaveLength(1)
    expect(view.dom.querySelector('.cm-content')?.textContent).not.toContain('$$')
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('a $$…$$ inside a line of a list item stays in the line, not centred', () => {
    const service = stubService({ 'D:x': okEntry() })
    const doc = '- a $$x$$ b\n\nEnde'
    const view = mount(doc, doc.length, service)
    expect(view.dom.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
    expect(view.dom.querySelector('.mdo-math-centred')).toBeNull()
  })
})
