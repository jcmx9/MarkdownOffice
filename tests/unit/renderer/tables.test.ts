// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, type WidgetType } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { mdoMarkdown } from '../../../src/renderer/editor/markdown'
import { createMath } from '../../../src/renderer/editor/math'
import { previewView } from '../../../src/renderer/editor/rendered'
import {
  createTableField,
  splitRow,
  tableField,
  tableModel,
  typstAutoColumns,
} from '../../../src/renderer/editor/tables'
import { okEntry, type Stub, stubService } from './math-stub'
import { parsed } from './parsed'

const TABLE =
  '| Produkt | Menge | Preis |\n|:--|:-:|---|\n| Espresso | 12 | 3,50 € |\n| Filter | 8 | 2 € |\n| **Neu** | | 1.200,00 EUR |'

function make(doc: string, cursor: number) {
  const s = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter] }), tableField],
  })
  ensureSyntaxTree(s, s.doc.length, 5000)
  // Rebuild once the tree is complete (a no-op transaction re-runs the field).
  return s.update({}).state
}

function tables(state: EditorState): { range: string; widget: WidgetType }[] {
  const out: { range: string; widget: WidgetType }[] = []
  state.field(tableField).between(0, state.doc.length, (from, to, d) => {
    out.push({
      range: `${(d.spec as { rf: string }).rf}@${from}-${to}`,
      widget: d.spec.widget as WidgetType,
    })
  })
  return out
}

describe('splitRow', () => {
  it.each([
    ['| a | b |', ['a', 'b']],
    ['a | b', ['a', 'b']],
    ['| `a|b` | c |', ['`a', 'b`', 'c']],
    ['| 5` | x | y |', ['5`', 'x', 'y']],
    ['| a \\| b | c |', ['a | b', 'c']],
    ['| | x |', ['', 'x']],
  ])('%j', (row, cells) => expect(splitRow(row)).toEqual(cells))
})

describe('typstAutoColumns', () => {
  it('keeps the natural widths when everything fits (no stretching)', () => {
    expect(typstAutoColumns([50, 120, 40], 548)).toEqual([50, 120, 40])
  })
  it('caps one oversized column at the space the others leave', () => {
    // fair = 300 / 3 = 100: 40 and 60 keep theirs, then fair = 200 / 1 for the rest.
    expect(typstAutoColumns([40, 500, 60], 300)).toEqual([40, 200, 60])
  })
  it('gives several oversized columns the same remaining share', () => {
    // fair = 300 / 3 = 100: 50 stays, then fair = 250 / 2 = 125 for both long columns.
    expect(typstAutoColumns([50, 400, 300], 300)).toEqual([50, 125, 125])
  })
  it('removes columns iteratively as the fair share grows', () => {
    // fair 400 / 4 = 100: 90 stays; fair 310 / 3 = 103.3: 103 stays (it did not fit
    // the first round); fair 207 / 2 = 103.5 removes nothing more -> both long ones get 103.5.
    expect(typstAutoColumns([90, 103, 500, 600], 400)).toEqual([90, 103, 103.5, 103.5])
  })
  it('lets a column whose share grows past it keep its natural width', () => {
    // fair 300 / 3 = 100: 20 stays; fair 280 / 2 = 140: 130 stays; rest 150.
    expect(typstAutoColumns([20, 130, 900], 300)).toEqual([20, 130, 150])
  })
  it('lays a single cell out in the available width at most', () => {
    expect(typstAutoColumns([900], 300)).toEqual([300])
  })
  it('the Soiron Ausstattung case: short columns are not squeezed', () => {
    const w = typstAutoColumns([148.3, 700, 82.4], 411)
    expect(w[0]).toBe(148.3)
    expect(w[2]).toBe(82.4)
    expect(w[1]).toBeCloseTo(411 - 148.3 - 82.4, 6)
  })
  it('handles empty tables and no space', () => {
    expect(typstAutoColumns([], 300)).toEqual([])
    expect(typstAutoColumns([10, 20], 0)).toEqual([10, 20])
  })
})

describe('tableModel', () => {
  it('reads head, rows, explicit and numeric alignment', () => {
    const m = tableModel(TABLE.split('\n'))
    expect(m.head).toEqual(['Produkt', 'Menge', 'Preis'])
    expect(m.rows).toEqual([
      ['Espresso', '12', '3,50 €'],
      ['Filter', '8', '2 €'],
      ['**Neu**', '', '1.200,00 EUR'],
    ])
    expect(m.aligns).toEqual(['left', 'center', 'right'])
  })
  it('pads short rows and cuts long ones to the head width', () => {
    const m = tableModel(['| a | b |', '|---|---|', '| 1 |', '| 1 | 2 | 3 |'])
    expect(m.rows).toEqual([
      ['1', ''],
      ['1', '2'],
    ])
    expect(m.aligns).toEqual(['right', 'right'])
  })
  it('right-aligns thin-space and plain-space thousands', () => {
    expect(
      tableModel(['| x |', '|---|', '| 1 200 \u20ac |', '| 3\u20092\u00a0000 |']).aligns,
    ).toEqual(['right'])
  })
  it('mixed text column stays left', () => {
    expect(tableModel(['| x |', '|---|', '| 1 |', '| zwei |']).aligns).toEqual(['left'])
  })
})

describe('tableField', () => {
  it('keeps tables inside blockquotes and list items raw', () => {
    const quote = '> | a | b |\n> |---|---|\n> | 1 | 2 |\n\nende'
    const list = '- | a | b |\n  |---|---|\n  | 1 | 2 |\n\nende'
    expect(tables(make(quote, quote.length))).toEqual([])
    expect(tables(make(list, list.length))).toEqual([])
  })
  it('click switches to Markdown; secondary button does nothing', () => {
    const doc = `Text\n\n${TABLE}\n\nende`
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter] }), tableField],
      }),
    })
    ensureSyntaxTree(view.state, doc.length, 5000)
    view.dispatch({})
    const start = doc.indexOf('| Produkt')
    const wrap = () => view.dom.querySelector('.mdo-table-wrap') as HTMLElement
    expect(wrap()).not.toBeNull()
    wrap().dispatchEvent(
      new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }),
    )
    expect(view.state.selection.main.head).toBe(doc.length)
    wrap().dispatchEvent(
      new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }),
    )
    expect(view.state.selection.main.head).toBe(start)
    expect(tables(view.state)).toEqual([])
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

  it('replaces the table by a widget when the cursor is elsewhere', () => {
    const doc = `Text\n\n${TABLE}\n\nende`
    const t = tables(make(doc, doc.length))
    const start = doc.indexOf('| Produkt')
    expect(t.map((x) => x.range)).toEqual([`table@${start}-${start + TABLE.length}`])
  })
  it('shows the Markdown when the cursor is inside', () => {
    const doc = `Text\n\n${TABLE}\n\nende`
    expect(tables(make(doc, doc.indexOf('Espresso') + 2))).toEqual([])
  })
  it('renders a PDF-like table', () => {
    const doc = `${TABLE}\n\nende`
    const [first] = tables(make(doc, doc.length))
    const dom = first?.widget.toDOM({} as EditorView) as HTMLElement
    const table = dom.querySelector('table.mdo-table') as HTMLTableElement
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Produkt',
      'Menge',
      'Preis',
    ])
    const rows = table.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.classList.contains('mdo-table-stripe')).toBe(false)
    expect(rows[1]?.classList.contains('mdo-table-stripe')).toBe(true)
    expect(rows[2]?.querySelector('td')?.querySelector('strong.mdo-strong')?.textContent).toBe(
      'Neu',
    )
    expect(rows[0]?.children[2]?.classList.contains('mdo-al-right')).toBe(true)
    expect(rows[0]?.children[1]?.classList.contains('mdo-al-center')).toBe(true)
  })
  it('keeps citations in cells as text unless the document defines the label', () => {
    const doc = '| Quelle | Wert |\n|---|---|\n| [21] | [def] |\n\n[DEF]: https://x.de\n\nende'
    const [first] = tables(make(doc, doc.length))
    const dom = first?.widget.toDOM({} as EditorView) as HTMLElement
    const cells = [...dom.querySelectorAll('tbody td')]
    expect(cells.map((c) => c.textContent)).toEqual(['[21]', 'def'])
    expect(cells[0]?.querySelector('.mdo-link')).toBeNull()
    expect(cells[1]?.querySelector('.mdo-link')?.textContent).toBe('def')
  })
  it('redraws the table when a reference definition changes', () => {
    const doc = '| a |\n|---|\n| [21] |\n\nende'
    const before = make(doc, doc.length)
    const after = before.update({ changes: { from: doc.length, insert: '\n\n[21]: /u' } }).state
    const [w1] = tables(before)
    const [w2] = tables(after)
    expect(w2?.widget.eq(w1?.widget as WidgetType)).toBe(false)
  })
})

describe('typography in table cells', () => {
  const cellsOf = (doc: string) => {
    const s = make(doc, doc.length)
    const widget = tables(s)[0]?.widget
    if (!widget) throw new Error('no table widget')
    const dom = widget.toDOM({} as EditorView)
    return [...dom.querySelectorAll('th, td')].map((c) => c.textContent)
  }
  it('shows the quotes, dashes and ellipses the PDF prints, per lang', () => {
    const table = '| "a" | b -- c |\n|---|---|\n| it\'s ... | `"code" --` |\n\nEnde'
    expect(cellsOf(table)).toEqual(['„a“', 'b – c', 'it’s …', '"code" --'])
    expect(cellsOf(`---\nlang: en\n---\n\n${table}`)).toEqual([
      '“a”',
      'b – c',
      'it’s …',
      '"code" --',
    ])
  })
  it('leaves a row with HTML alone, as the PDF does', () => {
    expect(cellsOf('| <b>x</b> "a" | -- |\n|---|---|\n\nEnde').slice(0, 2)).toEqual([
      '<b>x</b> "a"',
      '--',
    ])
  })
})

describe('formulas in table cells', () => {
  const views: EditorView[] = []
  afterEach(() => {
    for (const v of views.splice(0)) v.destroy()
  })

  /** A view with the app's Markdown, a table field and the formula redraw on one stub service. */
  function mountTable(doc: string, service: Stub) {
    const field = createTableField({ service })
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: parsed(
        EditorState.create({
          doc,
          selection: { anchor: doc.length },
          extensions: [
            mdoMarkdown(),
            previewView.of(true),
            field,
            createMath({ service }).extension,
          ],
        }),
      ),
    })
    views.push(view)
    return view
  }
  const cells = (view: EditorView) => [...view.dom.querySelectorAll('.mdo-table tbody td')]
  const DOC = '| a | b |\n|---|---|\n| $x$ | c |\n\nEnde'

  it('a cell formula with a result shows its SVG, sized like the inline widget', () => {
    const service = stubService({ 'I:x': okEntry('mdo-mxT', 1.25, 0.9, 0.2) })
    const view = mountTable(DOC, service)
    const svg = cells(view)[0]?.querySelector('.mdo-math-inline svg') as SVGSVGElement | null
    expect(svg).not.toBeNull()
    expect(svg?.style.width).toBe('1.25em')
    expect(svg?.style.verticalAlign).toBe('-0.2em')
    expect(cells(view)[0]?.textContent).not.toContain('$')
  })

  it('a formula the PDF cannot build stays flagged source in its cell', () => {
    const service = stubService({ 'I:x': { state: 'error', message: 'kaputt' } })
    const view = mountTable(DOC, service)
    const flagged = cells(view)[0]?.querySelector('.mdo-math-error')
    expect(flagged?.textContent).toBe('$x$')
    expect(flagged?.getAttribute('title')).toBe('Formel wird im PDF nicht gebaut: kaputt')
    expect(cells(view)[0]?.querySelector('svg')).toBeNull()
  })

  it('a pending cell formula is requested, shown muted and drawn once the result is there', async () => {
    const service = stubService()
    const view = mountTable(DOC, service)
    expect(cells(view)[0]?.querySelector('.mdo-math-pending')?.textContent).toBe('$x$')
    expect(service.requests.flat()).toContain('I:x')
    service.entries.set('I:x', okEntry())
    service.emit()
    await Promise.resolve()
    expect(cells(view)[0]?.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
  })

  it('a \\| in a cell formula is the escaped pipe (GFM), and $$…$$ is display style', () => {
    const doc = '| a | b |\n|---|---|\n| $x\\|y$ | $$z$$ |\n\nEnde'
    const service = stubService()
    const view = mountTable(doc, service)
    expect(service.requests.flat()).toEqual(expect.arrayContaining(['I:x|y', 'D:z']))
    service.entries.set('I:x|y', okEntry())
    service.entries.set('D:z', okEntry())
    service.emit()
    return Promise.resolve().then(() => {
      expect(cells(view)[0]?.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
      expect(cells(view)[1]?.querySelectorAll('.mdo-math-inline svg')).toHaveLength(1)
    })
  })

  it('a cell formula drawn pending that its build never asked for is requested then', () => {
    // Settled when the field was built (so not requested), gone by the time the widget draws
    // (evicted): without a request in toDOM it would stay pending for ever.
    const service = stubService({ 'I:x': okEntry() })
    const field = createTableField({ service })
    const state = parsed(
      EditorState.create({
        doc: DOC,
        selection: { anchor: DOC.length },
        extensions: [mdoMarkdown(), previewView.of(true), field],
      }),
    )
    expect(service.requests).toEqual([])
    let widget: WidgetType | undefined
    state.field(field).between(0, state.doc.length, (_f, _t, d) => {
      widget = d.spec.widget as WidgetType
    })
    service.entries.delete('I:x')
    const dom = widget?.toDOM({} as EditorView)
    expect(dom?.querySelector('.mdo-math-pending')?.textContent).toBe('$x$')
    expect(service.requests.flat()).toEqual(['I:x'])
  })

  it('a table being edited shows its source and asks for nothing', () => {
    const service = stubService()
    const field = createTableField({ service })
    const state = parsed(
      EditorState.create({
        doc: DOC,
        selection: { anchor: DOC.indexOf('$x$') + 1 },
        extensions: [mdoMarkdown(), field],
      }),
    )
    expect(state.field(field).size).toBe(0)
    expect(service.requests).toEqual([])
  })
})
