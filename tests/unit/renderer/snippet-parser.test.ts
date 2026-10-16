// @vitest-environment happy-dom
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: snippet syntax is full of "${n}" literals
import { snippet } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { BUILTIN_SNIPPETS } from '../../../src/renderer/editor/builtin-snippets'
import { expandVariables, toCmTemplate } from '../../../src/renderer/editor/snippet-parser'

const NOW = new Date(2026, 0, 5, 7, 8, 9) // 05.01.2026 07:08:09 local

/** Inserts the template into an empty editor and returns doc text and the main selection. */
function insert(body: string) {
  const view = new EditorView({ state: EditorState.create({ doc: '' }) })
  snippet(toCmTemplate(body, NOW))(view, { label: 'x' }, 0, 0)
  const sel = view.state.selection.main
  const out = {
    text: view.state.doc.toString(),
    sel: view.state.sliceDoc(sel.from, sel.to),
    at: sel.from,
  }
  view.destroy()
  return out
}

describe('expandVariables', () => {
  it.each([
    ['$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE', '2026-01-05'],
    ['$CURRENT_HOUR:$CURRENT_MINUTE:$CURRENT_SECOND', '07:08:09'],
    ['${CURRENT_YEAR}', '2026'],
    ['$CURRENT_DATE.$CURRENT_MONTH.$CURRENT_YEAR', '05.01.2026'],
    ['$UNKNOWN and $ and 5 $', '$UNKNOWN and $ and 5 $'],
    ['$CURRENT_YEARS', '$CURRENT_YEARS'],
  ])('%s -> %s', (src, out) => {
    expect(expandVariables(src, NOW)).toBe(out)
  })
})

describe('toCmTemplate', () => {
  it('selects the first tab stop with its default', () => {
    expect(insert('a ${1:Kunde} b $2')).toMatchObject({ text: 'a Kunde b ', sel: 'Kunde' })
  })

  it('orders multi-digit stops numerically and puts $0 last', () => {
    const view = new EditorView({ state: EditorState.create({ doc: '' }) })
    snippet(toCmTemplate('$0|${10:z}|${2:b}|${1:a}', NOW))(view, { label: 'x' }, 0, 0)
    const order: string[] = []
    for (let i = 0; i < 4; i++) {
      const s = view.state.selection.main
      order.push(view.state.sliceDoc(s.from, s.to) || `@${s.from}`)
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    }
    expect(order).toEqual(['a', 'b', 'z', '@0'])
    view.destroy()
  })

  it('expands a variable inside a default', () => {
    expect(insert('date: ${5:$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE}')).toMatchObject({
      text: 'date: 2026-01-05',
      sel: '2026-01-05',
    })
  })

  it('keeps literal dollars, braces, hashes and backslashes', () => {
    const body = 'Preis 5 $, ${x}, #{y}, \\{z\\}, $UNKNOWN, {a}'
    expect(insert(body).text).toBe(body)
  })

  it('keeps braces inside a default (text kept, empty stop after it)', () => {
    expect(insert('${1:a{b}c}')).toMatchObject({ text: 'a{b}c', at: 5 })
  })

  it('keeps a multi-line default as text with an empty stop after it', () => {
    expect(insert('${1:a\nb}')).toMatchObject({ text: 'a\nb', at: 3 })
  })

  it.each([
    ['\\$1', '$1'],
    ['\\${1:x}', '${1:x}'],
    ['a\\\\b', 'a\\b'],
    ['\\$CURRENT_YEAR', '$CURRENT_YEAR'],
  ])('honours the escape in %s', (src, text) => {
    expect(insert(src).text).toBe(text)
  })

  it('treats \\} inside a default as a literal brace', () => {
    expect(insert('${1:a\\}b}')).toMatchObject({ text: 'a}b', at: 3 })
  })

  it('a repeated stop number mirrors the same field', () => {
    expect(insert('${1:x}-$1').text).toBe('x-x')
  })

  it('$0 alone puts the cursor at its place', () => {
    expect(insert('\n<!-- pagebreak -->\n\n$0')).toMatchObject({
      text: '\n<!-- pagebreak -->\n\n',
      at: '\n<!-- pagebreak -->\n\n'.length,
    })
  })
})

describe('BUILTIN_SNIPPETS', () => {
  it('lists the five templates sorted by name', () => {
    expect(BUILTIN_SNIPPETS.map((s) => s.name)).toEqual([
      'aufgabe',
      'header',
      'meeting',
      'newpage',
      'telefonnotiz',
    ])
    expect(BUILTIN_SNIPPETS.every((s) => s.source === 'builtin')).toBe(true)
  })

  it('keeps the raw, unexpanded meeting body', () => {
    const meeting = BUILTIN_SNIPPETS.find((s) => s.name === 'meeting')
    expect(meeting?.body.startsWith('---\nclient: "${1:Kunde}"')).toBe(true)
  })
})
