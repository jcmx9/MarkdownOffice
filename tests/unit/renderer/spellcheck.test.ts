// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { createState } from '../../../src/renderer/editor/setup'
import {
  spellcheckCompartment,
  spellcheckExtensions,
} from '../../../src/renderer/editor/spellcheck'

function view(text: string) {
  return new EditorView({ state: createState(text, '\n', 'preview'), parent: document.body })
}
const attr = (v: EditorView) => v.contentDOM.getAttribute('spellcheck')

describe('spellcheck extensions', () => {
  it('on in Edit, off in Present and when switched off', () => {
    const v = view('Text\n')
    v.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckExtensions(true, 'edit')) })
    expect(attr(v)).toBe('true')
    v.dispatch({
      effects: spellcheckCompartment.reconfigure(spellcheckExtensions(true, 'present')),
    })
    expect(attr(v)).toBe('false')
    v.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckExtensions(false, 'edit')) })
    expect(attr(v)).toBe('false')
  })

  it('front matter and code block lines are never checked', () => {
    const v = view('---\ntitle: Tset\n---\n\nTxet\n\n```\nkonst x\n```\n')
    v.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckExtensions(true, 'edit')) })
    const lines = [...v.contentDOM.querySelectorAll('.cm-line')] as HTMLElement[]
    const off = lines
      .filter((l) => l.getAttribute('spellcheck') === 'false')
      .map((l) => l.textContent)
    expect(off).toEqual(expect.arrayContaining(['title: Tset', 'konst x']))
    expect(off).not.toContain('Txet')
  })
})
