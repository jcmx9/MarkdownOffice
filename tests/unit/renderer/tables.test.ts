// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, type WidgetType } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { splitRow, tableField, tableModel } from '../../../src/renderer/editor/tables'

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
})
