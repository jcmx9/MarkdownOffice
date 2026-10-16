import { undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import { frontmatterRange } from '../../../src/renderer/editor/frontmatter'
import { insertHeader } from '../../../src/renderer/editor/insert-header'
import { createState, serializeDoc } from '../../../src/renderer/editor/setup'

const TEMPLATE = '---\n# Kommentar\ntitle: ""\nlang: de\n---\n'

function run(text: string, template = TEMPLATE, eol: '\n' | '\r\n' = '\n') {
  const state = createState(text, eol, 'code')
  const res = insertHeader(state, template)
  if ('refused' in res) return { refused: res.refused, state }
  const next = state.update(res.spec).state
  return { refused: null, state: next }
}

describe('insertHeader', () => {
  it('fills an empty note with the template and puts the cursor into title ""', () => {
    const { state } = run('')
    expect(state.doc.toString()).toBe('---\n# Kommentar\ntitle: ""\nlang: de\n---\n')
    expect(state.selection.main.head).toBe(state.doc.toString().indexOf('title: "') + 8)
    expect(frontmatterRange(state.doc)).not.toBeNull()
  })

  it('goes above existing text, separated by one blank line', () => {
    const { state } = run('# Termin\n\nText')
    expect(state.doc.toString()).toBe(
      '---\n# Kommentar\ntitle: ""\nlang: de\n---\n\n# Termin\n\nText',
    )
  })

  it('adds no second blank line when the note starts with one', () => {
    const { state } = run('\nText')
    expect(state.doc.toString()).toBe('---\n# Kommentar\ntitle: ""\nlang: de\n---\n\nText')
  })

  it('refuses a note that already has a front matter and leaves it unchanged', () => {
    const { refused, state } = run('---\ntitle: x\n---\n\nText')
    expect(refused).toBe('exists')
    expect(state.doc.toString()).toBe('---\ntitle: x\n---\n\nText')
  })

  it('takes a CRLF template and saves it with the note’s CRLF line breaks', () => {
    const { state } = run('A\r\nB', TEMPLATE.replace(/\n/g, '\r\n'), '\r\n')
    expect(serializeDoc(state.doc, '\r\n')).toBe(
      '---\r\n# Kommentar\r\ntitle: ""\r\nlang: de\r\n---\r\n\r\nA\r\nB',
    )
  })

  it('puts the cursor after the header when the template has no empty title', () => {
    const { state } = run('Text', '---\nlang: de\n---')
    expect(state.doc.toString()).toBe('---\nlang: de\n---\n\nText')
    expect(state.selection.main.head).toBe('---\nlang: de\n---\n'.length)
  })

  it('is one undo step', () => {
    const { state } = run('Text')
    let undone = state
    undo({
      state,
      dispatch: (tr) => {
        undone = tr.state
      },
    })
    expect(undone.doc.toString()).toBe('Text')
  })
})
