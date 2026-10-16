// @vitest-environment happy-dom

import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { insertPageBreak, PAGEBREAK } from '../../../src/renderer/editor/pagebreak'
import { createState, serializeDoc } from '../../../src/renderer/editor/setup'
import type { Mode } from '../../../src/shared/types'

const B = PAGEBREAK

function make(marked: string, mode: Mode = 'edit', eol: '\n' | '\r\n' = '\n') {
  // '|' marks the cursor; '[' ... ']' a selection (no marker: cursor at 0).
  let anchor = 0
  let head = 0
  let text = marked
  const open = marked.indexOf('[')
  if (open >= 0) {
    const close = marked.indexOf(']') - 1
    text = marked.replace('[', '').replace(']', '')
    anchor = open
    head = close
  } else if (marked.includes('|')) {
    anchor = head = marked.indexOf('|')
    text = marked.replace('|', '')
  }
  const state = createState(text, eol, 'code', false, mode)
  const view = new EditorView({
    state: state.update({ selection: { anchor, head } }).state,
    parent: document.body,
  })
  return view
}

const doc = (v: EditorView) => v.state.doc.toString()

describe('insertPageBreak', () => {
  it.each([
    ['|', `${B}\n`, `${B}\n`.length],
    ['Text|', `Text\n\n${B}\n\n`, `Text\n\n${B}\n`.length],
    ['A|B', `A\n\n${B}\n\nB`, `A\n\n${B}\n`.length],
    ['|Text', `${B}\n\nText`, `${B}\n`.length],
    ['A\n\n|\n\nB', `A\n\n${B}\n\nB`, `A\n\n${B}\n`.length],
    ['A\n|\nB', `A\n\n${B}\n\nB`, `A\n\n${B}\n`.length],
    ['A\n|', `A\n\n${B}\n`, `A\n\n${B}\n`.length],
    ['A\n\n|', `A\n\n${B}\n`, `A\n\n${B}\n`.length],
    ['A [mid] B', `A \n\n${B}\n\n B`, `A \n\n${B}\n`.length],
    ['One\nTw|o\nThree', `One\nTw\n\n${B}\n\no\nThree`, `One\nTw\n\n${B}\n`.length],
  ])('%j', (marked, expected, cursor) => {
    const v = make(marked)
    expect(insertPageBreak(v)).toBe(true)
    expect(doc(v)).toBe(expected)
    expect(v.state.selection.main.empty).toBe(true)
    expect(v.state.selection.main.head).toBe(cursor)
  })

  it.each([
    ['A\n  \n|B', `A\n  \n${B}\n\nB`],
    ['A|\n \t\nB', `A\n\n${B}\n \t\nB`],
  ])('whitespace-only lines count as empty: %j', (marked, expected) => {
    const v = make(marked)
    insertPageBreak(v)
    expect(doc(v)).toBe(expected)
  })

  it('does not double blank lines around a break on an empty line', () => {
    const v = make('A\n\n|\nB')
    insertPageBreak(v)
    expect(doc(v)).toBe(`A\n\n${B}\n\nB`)
  })

  it('undoes in one step to the exact original', () => {
    const v = make('A|B')
    insertPageBreak(v)
    undo(v)
    expect(doc(v)).toBe('AB')
  })

  it('keeps CRLF on save', () => {
    const v = make('A|B', 'edit', '\r\n')
    insertPageBreak(v)
    expect(serializeDoc(v.state.doc, '\r\n')).toBe(`A\r\n\r\n${B}\r\n\r\nB`)
  })

  it.each(['edit', 'present'] as const)('refuses inside the front matter (%s)', (mode) => {
    const text = '---\ntitle: "X"\n---\n\nBody'
    for (const pos of [0, 6, text.indexOf('\n\nBody'), 3]) {
      const v = make(text, mode)
      v.dispatch({ selection: { anchor: pos } })
      expect(insertPageBreak(v)).toBe(false)
      expect(doc(v)).toBe(text)
    }
  })

  it('refuses a selection that reaches into the header', () => {
    const text = '---\ntitle: "X"\n---\n\nBody'
    const v = make(text)
    v.dispatch({ selection: { anchor: 5, head: text.length } })
    expect(insertPageBreak(v)).toBe(false)
  })

  it('works below the header in Present', () => {
    const v = make('---\ntitle: "X"\n---\n\nBody|', 'present')
    expect(insertPageBreak(v)).toBe(true)
    expect(doc(v)).toBe(`---\ntitle: "X"\n---\n\nBody\n\n${B}\n\n`)
  })

  it('Mod-Enter beats insertBlankLine and is consumed even when refused', () => {
    const text = '---\ntitle: "X"\n---\n\nBody'
    const v = make(text)
    v.dispatch({ selection: { anchor: 6 } })
    v.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 13,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(doc(v)).toBe(text)
  })

  it('Mod-Enter in the body inserts one break instead of a blank line', () => {
    const v = make('A|B')
    v.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 13,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(doc(v)).toBe(`A\n\n${B}\n\nB`)
  })
})
