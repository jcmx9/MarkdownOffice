// @vitest-environment happy-dom
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { createState } from '../../../src/renderer/editor/setup'
import {
  replaceWordAt,
  SpellLanguageTracker,
  spellAnswerCurrent,
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

describe('replaceWordAt', () => {
  it('replaces exactly the word at the position', () => {
    const v = view('Ein Fehlr hier\n')
    expect(replaceWordAt(v, 6, 'Fehlr', 'Fehler')).toBe(true)
    expect(v.state.doc.toString()).toBe('Ein Fehler hier\n')
  })
  it('refuses when the word at the position changed meanwhile', () => {
    const v = view('Ein Wort hier\n')
    expect(replaceWordAt(v, 6, 'Fehlr', 'Fehler')).toBe(false)
    expect(v.state.doc.toString()).toBe('Ein Wort hier\n')
  })
  it('is one undoable step', () => {
    const v = view('Fehlr\n')
    replaceWordAt(v, 2, 'Fehlr', 'Fehler')
    undo(v)
    expect(v.state.doc.toString()).toBe('Fehlr\n')
  })
})

describe('SpellLanguageTracker', () => {
  it('reports the first value and changes, not repeats', () => {
    const t = new SpellLanguageTracker()
    expect(t.next('de')).toBe(true)
    expect(t.next('de')).toBe(false)
    expect(t.next('')).toBe(true)
    t.reset()
    expect(t.next('')).toBe(true)
  })
})

describe('spellAnswerCurrent', () => {
  it('accepts only an unchanged tab and lang', () => {
    expect(spellAnswerCurrent({ id: 1, lang: 'fr' }, { id: 1, lang: 'fr' })).toBe(true)
    expect(spellAnswerCurrent({ id: 1, lang: 'fr' }, { id: 2, lang: 'fr' })).toBe(false)
    expect(spellAnswerCurrent({ id: 1, lang: 'fr' }, { id: 1, lang: 'de' })).toBe(false)
  })
})
