// @vitest-environment happy-dom

import { undo } from '@codemirror/commands'
import { type Command, EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { createState, serializeDoc } from '../../../src/renderer/editor/setup'
import {
  cellAt,
  cellsOfTable,
  insertTable,
  tableAt,
  tableColDelete,
  tableColRight,
  tableCommandState,
  tableRowBelow,
  tableRowDelete,
} from '../../../src/renderer/editor/table-edit'
import { splitRow } from '../../../src/renderer/editor/tables'
import type { Mode } from '../../../src/shared/types'
import { parsed } from './parsed'

// Tables are full of `|`, so the cursor marker here is `‸` (U+2038) instead of the `|` the
// format tests use.
const CURSOR = '‸'

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})

function make(marked: string, mode: Mode = 'edit', eol: '\n' | '\r\n' = '\n'): EditorView {
  const at = marked.indexOf(CURSOR)
  const text = marked.replace(CURSOR, '')
  const state = parsed(createState(text, eol, 'code', false, mode))
  const view = new EditorView({
    state: state.update({ selection: { anchor: Math.max(at, 0) } }).state,
    parent: document.body,
  })
  views.push(view)
  return view
}

/** The document with the main cursor marked. */
function marked(v: EditorView): string {
  const doc = v.state.doc.toString()
  const at = v.state.selection.main.head
  return doc.slice(0, at) + CURSOR + doc.slice(at)
}

/** Cell texts per row of the table at `pos`, read from a freshly parsed state. */
function reparsedCells(v: EditorView, pos = 0): string[][] {
  const state = parsed(v.state)
  const table = tableAt(state, pos)
  expect(table?.name).toBe('Table')
  if (!table) return []
  return cellsOfTable(state, table).map((row) =>
    row.map((c) => state.doc.sliceString(c.from, c.to)),
  )
}

/** Runs `cmd`, checks one undo restores the exact bytes, then redoes nothing (state after cmd). */
function runUndoable(v: EditorView, cmd: (view: EditorView) => boolean): string {
  const before = v.state.doc.toString()
  expect(cmd(v)).toBe(true)
  const after = marked(v)
  const afterState = v.state
  undo(v)
  expect(v.state.doc.toString()).toBe(before)
  v.setState(afterState)
  return after
}

const E = '|   |   |   |'
const D = '| --- | --- | --- |'

describe('cell model', () => {
  const T = '| a | b \\| c |  x |\n|---|:-:|--|\n| 1 |  | |\n| only |'

  it('splits rows like splitRow, keeping \\| in the cell', () => {
    const v = make(T)
    const cells = reparsedCells(v)
    expect(cells).toEqual([['a', 'b \\| c', 'x'], ['---', ':-:', '--'], ['1', '', ''], ['only']])
    // Same cells as the preview's splitRow (which unescapes the pipe).
    T.split('\n').forEach((line, i) => {
      expect(cells[i]?.map((c) => c.replace(/\\\|/g, '|'))).toEqual(splitRow(line))
    })
  })

  it('handles rows without outer pipes', () => {
    expect(reparsedCells(make('a | b\n--|--\n1 | 2'))).toEqual([
      ['a', 'b'],
      ['--', '--'],
      ['1', '2'],
    ])
  })

  it('finds the cell at a position, pipes belonging to the cell on their left', () => {
    const v = make(T)
    const s = v.state
    const at = (pos: number) => {
      const c = cellAt(s, pos)
      return c && [c.row, c.col]
    }
    expect(at(0)).toEqual([0, 0])
    expect(at(1)).toEqual([0, 0])
    expect(at(4)).toEqual([0, 0])
    expect(at(5)).toEqual([0, 1])
    expect(at(9)).toEqual([0, 1]) // inside the escaped pipe
    expect(at(19)).toEqual([0, 2]) // line end after the trailing pipe
    expect(at(T.indexOf(':-:'))).toEqual([1, 1])
    expect(at(T.indexOf('only'))).toEqual([3, 0])
    expect(at(T.length)).toEqual([3, 0])
  })

  it("counts a position in the first row's indentation as in the table", () => {
    const v = make(' b | c\n--|--\n 2 | 3')
    expect(cellAt(v.state, 0)).toEqual({ row: 0, col: 0, from: 1, to: 2 })
  })

  it('places an empty cell after one padding space', () => {
    const v = make(`${E}\n${D}`)
    expect(cellAt(v.state, 0)).toEqual({ row: 0, col: 0, from: 2, to: 2 })
  })

  it('only knows top-level tables', () => {
    for (const doc of ['> | a |\n> |---|\n', '- x\n\n  | a | b |\n  |---|---|\n', 'text']) {
      const v = make(doc)
      for (let p = 0; p <= doc.length; p++) expect(tableAt(v.state, p)).toBeNull()
      expect(cellAt(v.state, 3)).toBeNull()
    }
  })
})

describe('insertTable', () => {
  const T34 = `${E}\n${D}\n${E}\n${E}\n${E}\n`

  it('inserts a 3 × 4 table into an empty note, cursor in the first header cell', () => {
    const v = make('')
    expect(runUndoable(v, (view) => insertTable(view, 3, 4))).toBe(
      `| ${CURSOR}  |   |   |${T34.slice(E.length)}`,
    )
    expect(reparsedCells(v)).toEqual([
      ['', '', ''],
      ['---', '---', '---'],
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ])
  })

  it.each([
    [1, 1],
    [8, 10],
    [2, 1],
    [1, 10],
  ])('inserts %i × %i (rows include the header)', (cols, rows) => {
    const v = make('')
    expect(insertTable(v, cols, rows)).toBe(true)
    const cells = reparsedCells(v)
    expect(cells.length).toBe(rows + 1)
    expect(cells.every((r) => r.length === cols)).toBe(true)
  })

  it.each([
    [0, 1],
    [9, 1],
    [1, 0],
    [1, 11],
    [1.5, 2],
  ])('refuses the size %d × %d', (cols, rows) => {
    const v = make('')
    expect(insertTable(v, cols, rows)).toBe(false)
    expect(v.state.doc.toString()).toBe('')
  })

  const one = '|   |\n| --- |\n'
  const cur = `| ${CURSOR}  |\n| --- |\n`
  it.each([
    ['after a paragraph line', `Para${CURSOR}`, `Para\n\n${cur}`],
    ['after a paragraph with newline', `Pa${CURSOR}ra\n`, `Para\n\n${cur}`],
    ['between blocks', `Para${CURSOR}\n\nNext`, `Para\n\n${cur}\nNext`],
    ['before a following line', `# H${CURSOR}\nNext`, `# H\n\n${cur}\nNext`],
    ['on a blank line between blocks', `A\n${CURSOR}\nB`, `A\n\n${cur}\nB`],
    ['on a blank line after a blank', `A\n\n${CURSOR}\n\nB`, `A\n\n${cur}\n\nB`],
    ['at the end of a multi-line paragraph', `A${CURSOR}\nB\n\nC`, `A\nB\n\n${cur}\nC`],
  ])('places the table %s', (_name, before, after) => {
    const v = make(before)
    expect(runUndoable(v, (view) => insertTable(view, 1, 1))).toBe(after)
    expect(v.state.doc.toString().includes(one)).toBe(true)
  })

  it.each([
    ['a list item', `- item${CURSOR}`],
    ['a task item', `- [ ] item${CURSOR}`],
    ['a quote', `> quote${CURSOR}`],
    ['an alert', `> [!NOTE]\n> text${CURSOR}`],
    ['a fence', `\`\`\`\ncode${CURSOR}\n\`\`\``],
    ['an indented code block', `    code${CURSOR}`],
    ['an HTML comment', `<!-- pagebreak ${CURSOR}-->`],
    ['the front matter', `---\ntitle: X${CURSOR}\n---\n\nBody`],
    ['a table', `| a${CURSOR} |\n|---|`],
  ])('refuses in %s', (_name, before) => {
    const v = make(before)
    const text = v.state.doc.toString()
    expect(insertTable(v, 2, 2)).toBe(false)
    expect(v.state.doc.toString()).toBe(text)
  })

  it('refuses in Present', () => {
    const v = make(`Para${CURSOR}`, 'present')
    expect(insertTable(v, 2, 2)).toBe(false)
    expect(v.state.doc.toString()).toBe('Para')
  })

  it('keeps CRLF on save', () => {
    const v = make(`Para${CURSOR}\r\nNext`, 'edit', '\r\n')
    expect(insertTable(v, 2, 2)).toBe(true)
    expect(serializeDoc(v.state.doc, '\r\n')).toBe(
      'Para\r\nNext\r\n\r\n|   |   |\r\n| --- | --- |\r\n|   |   |\r\n',
    )
  })

  it('is its own undo step, apart from typing right after', () => {
    const v = make(`Para${CURSOR}`)
    insertTable(v, 1, 1)
    v.dispatch(v.state.replaceSelection('x'), { userEvent: 'input.type' })
    undo(v)
    expect(v.state.doc.toString()).toBe(`Para\n\n${one}`)
    undo(v)
    expect(v.state.doc.toString()).toBe('Para')
  })
})

const TABLE = '| A | B | C |\n|---|:-:|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |'

/** Puts the cursor right before the first occurrence of `needle`. */
function at(text: string, needle: string): string {
  const i = text.indexOf(needle)
  expect(i).toBeGreaterThanOrEqual(0)
  return text.slice(0, i) + CURSOR + text.slice(i)
}

describe('tableRowBelow', () => {
  it.each([
    ['header', 'A', '| A | B | C |\n|---|:-:|---|\n| ‸  |   |   |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |'],
    [
      'delimiter',
      ':-:',
      '| A | B | C |\n|---|:-:|---|\n| ‸  |   |   |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |',
    ],
    [
      'first body row',
      '2',
      '| A | B | C |\n|---|:-:|---|\n| 1 | 2 | 3 |\n| ‸  |   |   |\n| 4 | 5 | 6 |',
    ],
    [
      'last body row',
      '6',
      '| A | B | C |\n|---|:-:|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| ‸  |   |   |',
    ],
  ])('on the %s row', (_name, needle, after) => {
    const v = make(at(TABLE, needle))
    expect(runUndoable(v, tableRowBelow)).toBe(after)
    expect(reparsedCells(v).every((r) => r.length === 3)).toBe(true)
  })

  it('writes outer pipes even in a table without them (an empty first cell needs one)', () => {
    const v = make('a | b\n--|--\n1 | 2‸')
    expect(runUndoable(v, tableRowBelow)).toBe('a | b\n--|--\n1 | 2\n| ‸  |   |')
    expect(reparsedCells(v)).toEqual([
      ['a', 'b'],
      ['--', '--'],
      ['1', '2'],
      ['', ''],
    ])
  })

  it('keeps CRLF on save', () => {
    const v = make('| A |\r\n|---|\r\n| 1‸ |\r\n\r\nText', 'edit', '\r\n')
    expect(tableRowBelow(v)).toBe(true)
    expect(serializeDoc(v.state.doc, '\r\n')).toBe('| A |\r\n|---|\r\n| 1 |\r\n|   |\r\n\r\nText')
  })
})

describe('tableColRight', () => {
  it('inserts after the middle column, other cells byte-identical', () => {
    const src = '| A |  B \\| x | C |\n|---|:-:|---|\n| 1 | 2 |3|\n| 4 | 5 | 6 |'
    const v = make(at(src, 'B'))
    expect(runUndoable(v, tableColRight)).toBe(
      '| A |  B \\| x | ‸  | C |\n|---|:-:| --- |---|\n| 1 | 2 |   |3|\n| 4 | 5 |   | 6 |',
    )
    expect(reparsedCells(v)).toEqual([
      ['A', 'B \\| x', '', 'C'],
      ['---', ':-:', '---', '---'],
      ['1', '2', '', '3'],
      ['4', '5', '', '6'],
    ])
  })

  it('puts the cursor into the new cell of its own row', () => {
    const v = make(at(TABLE, '5'))
    expect(runUndoable(v, tableColRight)).toBe(
      '| A | B |   | C |\n|---|:-:| --- |---|\n| 1 | 2 |   | 3 |\n| 4 | 5 | ‸  | 6 |',
    )
  })

  it('inserts after the first and the last column', () => {
    const first = make(at(TABLE, 'A'))
    expect(tableColRight(first)).toBe(true)
    expect(reparsedCells(first)[0]).toEqual(['A', '', 'B', 'C'])
    const last = make(at(TABLE, 'C'))
    expect(tableColRight(last)).toBe(true)
    expect(reparsedCells(last)).toEqual([
      ['A', 'B', 'C', ''],
      ['---', ':-:', '---', '---'],
      ['1', '2', '3', ''],
      ['4', '5', '6', ''],
    ])
  })

  it('keeps rows without outer pipes in that style', () => {
    const v = make('a | b\n--|--\n1 | 2'.replace('a', '‸a'))
    expect(runUndoable(v, tableColRight)).toBe('a | ‸  | b\n--| --- |--\n1 |   | 2')
    expect(reparsedCells(v)).toEqual([
      ['a', '', 'b'],
      ['--', '---', '--'],
      ['1', '', '2'],
    ])
  })

  it('closes the last cell of a row without trailing pipe (an empty last cell needs one)', () => {
    const v = make('a | b‸\n--|--\n1 | 2')
    expect(runUndoable(v, tableColRight)).toBe('a | b | ‸  |\n--|-- | --- |\n1 | 2 |   |')
    expect(reparsedCells(v)).toEqual([
      ['a', 'b', ''],
      ['--', '--', '---'],
      ['1', '2', ''],
    ])
  })

  it('pads a short row up to the header count and keeps the extra cells of a long one', () => {
    const v = make('| A‸ | B | C |\n|---|---|---|\n| 1 |\n| 4 | 5 | 6 | 7 |\n| x | y |')
    expect(runUndoable(v, tableColRight)).toBe(
      '| A | ‸  | B | C |\n|---| --- |---|---|\n| 1 |   |   |   |\n| 4 |   | 5 | 6 | 7 |\n| x |   | y |   |',
    )
    const cells = reparsedCells(v)
    expect(cells.map((r) => r.length)).toEqual([4, 4, 4, 5, 4])
  })

  it('pads a short row that lacks the cursor column', () => {
    const v = make('| A | B | C‸ |\n|---|---|---|\n| 1 |')
    expect(runUndoable(v, tableColRight)).toBe(
      '| A | B | C | ‸  |\n|---|---|---| --- |\n| 1 |   |   |   |',
    )
  })

  it('keeps CRLF on save', () => {
    const v = make('| A‸ |\r\n|---|\r\n| 1 |', 'edit', '\r\n')
    expect(tableColRight(v)).toBe(true)
    expect(serializeDoc(v.state.doc, '\r\n')).toBe('| A |   |\r\n|---| --- |\r\n| 1 |   |')
  })
})

describe('tableRowDelete', () => {
  it.each([
    ['first body row', '2', '| A | B | C |\n|---|:-:|---|\n| 4 | ‸5 | 6 |', ['4', '5', '6']],
    ['last body row', '5', '| A | B | C |\n|---|:-:|---|\n| 1 | ‸2 | 3 |', ['1', '2', '3']],
  ])('removes the %s', (_name, needle, after, left) => {
    const v = make(at(TABLE, needle))
    expect(runUndoable(v, tableRowDelete)).toBe(after)
    expect(reparsedCells(v)).toEqual([['A', 'B', 'C'], ['---', ':-:', '---'], left])
  })

  it('removes the only body row, cursor into the header', () => {
    const v = make('| A |\n|---|\n| 1‸ |\n\nText')
    expect(runUndoable(v, tableRowDelete)).toBe('| ‸A |\n|---|\n\nText')
    expect(reparsedCells(v)).toEqual([['A'], ['---']])
  })

  it('removes a middle row of a table without outer pipes', () => {
    const v = make('a | b\n--|--\n1 | 2‸\n3 | 4')
    expect(runUndoable(v, tableRowDelete)).toBe('a | b\n--|--\n3 | ‸4')
    expect(reparsedCells(v)).toEqual([
      ['a', 'b'],
      ['--', '--'],
      ['3', '4'],
    ])
  })

  it.each(['A', ':-:'])('refuses on the header and delimiter row (%s)', (needle) => {
    const v = make(at(TABLE, needle))
    expect(tableRowDelete(v)).toBe(false)
    expect(v.state.doc.toString()).toBe(TABLE)
  })
})

describe('tableColDelete', () => {
  it.each([
    ['first', 'A', '| ‸B | C |\n|:-:|---|\n| 2 | 3 |\n| 5 | 6 |'],
    ['middle', 'B', '| A | ‸C |\n|---|---|\n| 1 | 3 |\n| 4 | 6 |'],
    ['last', 'C', '| A | ‸B |\n|---|:-:|\n| 1 | 2 |\n| 4 | 5 |'],
  ])('removes the %s column, delimiter included', (_name, needle, after) => {
    const v = make(at(TABLE, needle))
    expect(runUndoable(v, tableColDelete)).toBe(after)
    expect(reparsedCells(v).every((r) => r.length === 2)).toBe(true)
  })

  it('keeps escaped pipes and odd padding of the other cells', () => {
    const v = make('| a \\| b |  c‸  |d|\n|---|---|---|\n|x\\||  y | z  |')
    expect(runUndoable(v, tableColDelete)).toBe('| a \\| b |‸d|\n|---|---|\n|x\\|| z  |')
    expect(reparsedCells(v)).toEqual([
      ['a \\| b', 'd'],
      ['---', '---'],
      ['x\\|', 'z'],
    ])
  })

  it.each([
    ['first', 'a', ' ‸b | c\n--|--\n 2 | 3', ['b', 'c'], ['2', '3']],
    ['middle', 'b', 'a | ‸c\n--|--\n1 | 3', ['a', 'c'], ['1', '3']],
    ['last', 'c', 'a | ‸b \n--|--\n1 | 2 ', ['a', 'b'], ['1', '2']],
  ])(
    "keeps rows without outer pipes and the neighbours' padding (%s)",
    (_n, needle, after, head, body) => {
      // Only the removed cell and its own pipe go; the padding next to it stays byte for byte.
      const v = make(at('a | b | c\n--|--|--\n1 | 2 | 3', needle))
      expect(runUndoable(v, tableColDelete)).toBe(after)
      expect(reparsedCells(v)).toEqual([head, ['--', '--'], body])
    },
  )

  it.each([
    ['first', 'A', '| ‸B |\n|--- |\n| 2 |', ['B'], ['---'], ['2']],
    ['last', 'B', '| ‸A |\n|---|\n| 1 |', ['A'], ['---'], ['1']],
  ])(
    'keeps a trailing pipe when a row with only a leading pipe drops to one cell (%s)',
    (_n, needle, after, head, delim, body) => {
      // `| A` / `|---` would re-parse as a paragraph: the table needs a pipe after the cell.
      const v = make(at('| A | B\n|---|---\n| 1 | 2', needle))
      expect(runUndoable(v, tableColDelete)).toBe(after)
      expect(reparsedCells(v)).toEqual([head, delim, body])
    },
  )

  it('keeps a pipe when a row without outer pipes drops to one cell', () => {
    const v = make('a | b‸\n--|--\n1 | 2')
    expect(runUndoable(v, tableColDelete)).toBe('‸a |\n--|\n1 |')
    expect(reparsedCells(v)).toEqual([['a'], ['--'], ['1']])
  })

  it('leaves short rows without that column alone and empties a lone cell', () => {
    const v = make('| A | B | C‸ |\n|---|---|---|\n| 1 |\n| x | y | z | w |')
    expect(runUndoable(v, tableColDelete)).toBe('| A | ‸B |\n|---|---|\n| 1 |\n| x | y | w |')
    const w = make('| ‸A | B |\n|---|---|\n| 1 |')
    expect(runUndoable(w, tableColDelete)).toBe('| ‸B |\n|---|\n|  |')
    expect(reparsedCells(w)).toEqual([['B'], ['---'], ['']])
  })

  it('turns a lazy row without pipes into an empty row instead of a blank line', () => {
    const v = make('‸a | b\n--|--\nx')
    expect(runUndoable(v, tableColDelete)).toBe(' ‸b |\n-- |\n|   |')
    expect(reparsedCells(v)).toEqual([['b'], ['--'], ['']])
  })

  it('refuses with one column left', () => {
    const v = make('| A‸ |\n|---|\n| 1 |')
    expect(tableColDelete(v)).toBe(false)
  })

  it('keeps CRLF on save', () => {
    const v = make('| A | B‸ |\r\n|---|---|\r\n| 1 | 2 |', 'edit', '\r\n')
    expect(tableColDelete(v)).toBe(true)
    expect(serializeDoc(v.state.doc, '\r\n')).toBe('| A |\r\n|---|\r\n| 1 |')
  })
})

describe('table commands outside a table', () => {
  const cmds: [string, Command][] = [
    ['row below', tableRowBelow],
    ['col right', tableColRight],
    ['row delete', tableRowDelete],
    ['col delete', tableColDelete],
  ]
  it.each(cmds)('%s refuses outside a table, in a quoted table and in Present', (_n, cmd) => {
    for (const [doc, mode] of [
      ['Text‸', 'edit'],
      ['> | a‸ | b |\n> |---|---|\n> | 1 | 2 |', 'edit'],
      [at(TABLE, '5'), 'present'],
    ] as const) {
      const v = make(doc, mode)
      const text = v.state.doc.toString()
      expect(cmd(v)).toBe(false)
      expect(v.state.doc.toString()).toBe(text)
    }
  })
})

describe('selections', () => {
  it('refuses a selection that leaves the table', () => {
    const doc = `${TABLE}\n\nText`
    const v = make(doc)
    v.dispatch({ selection: { anchor: doc.indexOf('5'), head: doc.length } })
    expect(tableColRight(v)).toBe(false)
    expect(tableCommandState(v.state).inTable).toBe(false)
    expect(v.state.doc.toString()).toBe(doc)
  })

  it('acts on a selection inside the table at its head', () => {
    const v = make(TABLE)
    v.dispatch({ selection: { anchor: TABLE.indexOf('1'), head: TABLE.indexOf('5') } })
    expect(tableRowDelete(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('| A | B | C |\n|---|:-:|---|\n| 1 | 2 | 3 |')
  })
})

describe('tableCommandState', () => {
  it.each([
    ['Text‸', { inTable: false, rowDelete: false, colDelete: false }],
    [at(TABLE, 'A'), { inTable: true, rowDelete: false, colDelete: true }],
    [at(TABLE, ':-:'), { inTable: true, rowDelete: false, colDelete: true }],
    [at(TABLE, '5'), { inTable: true, rowDelete: true, colDelete: true }],
    ['| A |\n|---|\n| 1‸ |', { inTable: true, rowDelete: true, colDelete: false }],
  ])('%j', (doc, want) => {
    expect(tableCommandState(make(doc).state)).toEqual(want)
  })

  it('is all false in Present', () => {
    expect(tableCommandState(make(at(TABLE, '5'), 'present').state)).toEqual({
      inTable: false,
      rowDelete: false,
      colDelete: false,
    })
  })
})
