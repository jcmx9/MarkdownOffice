// @vitest-environment happy-dom
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { createState } from '../../../src/renderer/editor/setup'
import {
  clearSpellcheckCache,
  forgetDismissedNotices,
  offerDictionaryNotice,
  recheckSpelling,
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

describe('recheckSpelling', () => {
  /** Old values of every change to the content's spellcheck attribute during `run`. */
  function oldValues(v: EditorView, run: () => void): string[] {
    const mo = new MutationObserver(() => undefined)
    mo.observe(v.contentDOM, { attributeFilter: ['spellcheck'], attributeOldValue: true })
    run()
    const seen = mo.takeRecords().map((r) => r.oldValue ?? '')
    mo.disconnect()
    return seen
  }

  it('switches checking off and on again, so Chromium checks the text anew', () => {
    const v = view('Ein Fehlr hier\n')
    v.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckExtensions(true, 'edit')) })
    // true -> false -> true: it really went through off before it ended on again.
    expect(oldValues(v, () => recheckSpelling(v, true, 'edit'))).toEqual(['true', 'false'])
    expect(attr(v)).toBe('true')
  })

  it("drops Chromium's cached result before the text is checked again", () => {
    const v = view('Ein Fehlr hier\n')
    v.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckExtensions(true, 'edit')) })
    const calls: string[] = []
    const doc = document as Document & { spellCheckCustomDictionary?: unknown }
    doc.spellCheckCustomDictionary = {
      removeWords: (words: string[]) => calls.push(`removeWords(${JSON.stringify(words)})`),
    }
    const mo = new MutationObserver((records) => {
      for (const r of records) calls.push(`spellcheck ${r.oldValue}`)
    })
    try {
      mo.observe(v.contentDOM, { attributeFilter: ['spellcheck'], attributeOldValue: true })
      recheckSpelling(v, true, 'edit')
      for (const r of mo.takeRecords()) calls.push(`spellcheck ${r.oldValue}`)
    } finally {
      mo.disconnect()
      delete doc.spellCheckCustomDictionary
    }
    expect(calls).toEqual(['removeWords([])', 'spellcheck true', 'spellcheck false'])
  })

  it('clearSpellcheckCache reports a missing API', () => {
    expect(clearSpellcheckCache(document)).toBe(false)
  })

  it.each([
    [false, 'edit'],
    [true, 'present'],
  ] as const)('never touches checking when on=%s in %s', (on, mode) => {
    const v = view('Text\n')
    v.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckExtensions(on, mode)) })
    expect(oldValues(v, () => recheckSpelling(v, on, mode))).toEqual([])
    expect(attr(v)).toBe('false')
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

describe('offerDictionaryNotice', () => {
  // Present is shown to clients and an off switch makes a missing dictionary irrelevant.
  it.each([
    [true, 'edit', true],
    [true, 'present', false],
    [false, 'edit', false],
    [false, 'present', false],
  ] as const)('spellcheck %s, mode %s → %s', (on, mode, offered) => {
    expect(offerDictionaryNotice(on, mode)).toBe(offered)
  })
})

describe('forgetDismissedNotices', () => {
  it('forgets only the codes whose banner the app dismissed', () => {
    const noticed = new Set(['fr', 'es'])
    forgetDismissedNotices(noticed, ['dict-fr'])
    expect([...noticed]).toEqual(['es'])
  })

  it('ignores foreign keys and unknown codes', () => {
    const noticed = new Set(['fr'])
    forgetDismissedNotices(noticed, ['other-fr', 'dict-it'])
    expect([...noticed]).toEqual(['fr'])
  })
})
