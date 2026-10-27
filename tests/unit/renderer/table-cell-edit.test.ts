// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import {
  cellInput,
  editableCell,
  neighbourCell,
} from '../../../src/renderer/editor/table-cell-edit'
import { cellsOfTable, tableAt } from '../../../src/renderer/editor/table-edit'

const TABLE = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'

function state(doc: string, opts: { readOnly?: boolean } = {}) {
  const s = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
      EditorState.readOnly.of(opts.readOnly ?? false),
    ],
  })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}

describe('cellInput', () => {
  it('is null when nothing changed', () => {
    expect(cellInput('abc', 'abc')).toBeNull()
  })
  it('replaces only the changed middle', () => {
    expect(cellInput('Espresso', 'Espressi')).toEqual({
      start: 7,
      end: 8,
      insert: 'i',
      text: 'Espressi',
      caret: 8,
    })
    expect(cellInput('ab', 'aXb')).toMatchObject({ start: 1, end: 1, insert: 'X', caret: 2 })
    expect(cellInput('abc', 'ac')).toMatchObject({ start: 1, end: 2, insert: '', text: 'ac' })
  })
  it('keeps typed spaces, also at the end', () => {
    expect(cellInput('a', 'a ')).toMatchObject({ insert: ' ', text: 'a ', caret: 2 })
  })
  it('escapes a bare pipe, keeps an escaped one', () => {
    expect(cellInput('ab', 'a|b')).toMatchObject({ insert: '\\|', text: 'a\\|b', caret: 3 })
    expect(cellInput('a\\', 'a\\|')).toMatchObject({ insert: '|', text: 'a\\|' })
    expect(cellInput('', 'x\\|y|z')).toMatchObject({ insert: 'x\\|y\\|z' })
  })
  it('turns line breaks (paste) into spaces', () => {
    expect(cellInput('', 'eins\nzwei\r\ndrei')).toMatchObject({ text: 'eins zwei drei' })
  })
})

describe('neighbourCell', () => {
  const s = state(TABLE)
  const cells = cellsOfTable(s, tableAt(s, 0) as NonNullable<ReturnType<typeof tableAt>>)
  const at = (r: number, c: number) => cells[r]?.[c]
  it('Tab runs along the row and wraps, skipping the delimiter row', () => {
    expect(neighbourCell(cells, 0, 0, 'next')).toEqual(at(0, 1))
    expect(neighbourCell(cells, 0, 1, 'next')).toEqual(at(2, 0))
    expect(neighbourCell(cells, 3, 1, 'next')).toBeNull()
  })
  it('Shift+Tab goes back and wraps to the previous row', () => {
    expect(neighbourCell(cells, 2, 0, 'prev')).toEqual(at(0, 1))
    expect(neighbourCell(cells, 0, 0, 'prev')).toBeNull()
  })
  it('Enter goes down in the column, from the header to the first body row', () => {
    expect(neighbourCell(cells, 0, 1, 'down')).toEqual(at(2, 1))
    expect(neighbourCell(cells, 3, 0, 'down')).toBeNull()
  })
})

describe('editableCell', () => {
  it('finds header and body cells, never the delimiter row', () => {
    const s = state(`${TABLE}\n\nText`)
    expect(editableCell(s, TABLE.indexOf('B'))).toMatchObject({ row: 0, col: 1 })
    expect(editableCell(s, TABLE.indexOf('3'))).toMatchObject({ row: 3, col: 0 })
    expect(editableCell(s, TABLE.indexOf('---'))).toBeNull()
    expect(editableCell(s, TABLE.length + 3)).toBeNull()
  })
  it('refuses a read-only note', () => {
    const s = state(TABLE, { readOnly: true })
    expect(editableCell(s, TABLE.indexOf('B'))).toBeNull()
  })
})
