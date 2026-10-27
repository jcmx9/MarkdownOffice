// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import {
  focusCompartment,
  focusExtensions,
  focusHiddenField,
  focusHiddenRanges,
  focusStepTarget,
} from '../../../src/renderer/editor/focus'
import { mdoMarkdown } from '../../../src/renderer/editor/markdown'
import { parsed } from './parsed'

function state(doc: string, cursor = 0, on = true): EditorState {
  const s = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [mdoMarkdown(), focusCompartment.of(focusExtensions(on))],
  })
  return parsed(s)
}

/** The visible lines: every line not covered by a hidden range. */
function visible(doc: string, cursor: number): string[] {
  const s = state(doc, cursor)
  const hidden = focusHiddenRanges(s, cursor)
  const out: string[] = []
  for (let n = 1; n <= s.doc.lines; n++) {
    const line = s.doc.line(n)
    if (!hidden.some((r) => line.from >= r.from && line.to <= r.to)) out.push(line.text)
  }
  return out
}

const DOC = [
  '# Eins', // 0
  'Intro eins',
  '## Eins A',
  'Text 1A',
  '### Eins A x',
  'Text 1Ax',
  '## Eins B',
  'Text 1B',
  '# Zwei',
  'Intro zwei',
  '## Zwei A',
  'Text 2A',
].join('\n')
const at = (s: string) => DOC.indexOf(s)

describe('focusHiddenRanges', () => {
  it('cursor in an H2: every H1, the path to it and only its own text stay', () => {
    expect(visible(DOC, at('Text 1B'))).toEqual(['# Eins', '## Eins B', 'Text 1B', '# Zwei'])
  })

  it('sub-headings of the active section and their text are hidden', () => {
    expect(visible(DOC, at('## Eins A'))).toEqual(['# Eins', '## Eins A', 'Text 1A', '# Zwei'])
  })

  it('a deeper heading shows the whole path back to its chapter, siblings stay hidden', () => {
    expect(visible(DOC, at('Text 1Ax'))).toEqual([
      '# Eins',
      '## Eins A',
      '### Eins A x',
      'Text 1Ax',
      '# Zwei',
    ])
  })

  it('cursor in the H1 intro: only the intro, no sub-chapters', () => {
    expect(visible(DOC, at('Intro eins'))).toEqual(['# Eins', 'Intro eins', '# Zwei'])
  })

  it('cursor before the first heading: text before it stays, only the H1 lines show', () => {
    const doc = `---\ntitle: T\n---\n\nVorspann\n\n${DOC}`
    expect(visible(doc, doc.indexOf('Vorspann'))).toEqual([
      '---',
      'title: T',
      '---',
      '',
      'Vorspann',
      '',
      '# Eins',
      '# Zwei',
    ])
  })

  it('without H1 the top heading level counts as chapter level', () => {
    const doc = '## A\na\n### A1\na1\n## B\nb'
    expect(visible(doc, doc.indexOf('b'))).toEqual(['## A', '## B', 'b'])
  })

  it('blank lines of hidden sections go too, so headings sit together', () => {
    const doc = '# A\n\nText\n\n# B\n\nMehr\n'
    expect(visible(doc, doc.indexOf('Mehr'))).toEqual(['# A', '# B', '', 'Mehr', ''])
  })

  it('a Setext heading counts with all its lines', () => {
    const doc = 'Eins\n====\ntext\n\nZwei\n====\nmehr'
    expect(visible(doc, doc.indexOf('mehr'))).toEqual(['Eins', '====', 'Zwei', '====', 'mehr'])
  })

  it('headings inside a quote are no sections', () => {
    const doc = '# A\n> # Zitat\ntext\n# B\nb'
    expect(visible(doc, doc.indexOf('b'))).toEqual(['# A', '# B', 'b'])
  })

  it('no headings: nothing is hidden', () => {
    expect(focusHiddenRanges(state('nur text\nmehr'), 0)).toEqual([])
  })

  it('hidden ranges are whole lines and never touch the document', () => {
    const s = state(DOC, at('Text 2A'))
    for (const r of focusHiddenRanges(s, at('Text 2A'))) {
      expect(s.doc.lineAt(r.from).from).toBe(r.from)
      expect(s.doc.lineAt(r.to).to).toBe(r.to)
    }
  })
})

describe('focus field', () => {
  it('follows the cursor and is empty when focus is off', () => {
    const s = state(DOC, at('Text 1B'))
    expect(s.field(focusHiddenField).size).toBeGreaterThan(0)
    const moved = s.update({ selection: { anchor: at('Text 2A') } }).state
    const ranges: number[] = []
    moved.field(focusHiddenField).between(0, moved.doc.length, (from) => {
      ranges.push(from)
    })
    expect(ranges).toContain(at('Intro eins'))
    expect(ranges).not.toContain(at('Text 2A'))
    const off = moved.update({
      effects: focusCompartment.reconfigure(focusExtensions(false)),
    }).state
    expect(off.field(focusHiddenField, false)).toBeUndefined()
  })

  it('an edit that adds a heading recomputes the ranges', () => {
    const doc = '# A\na\n# B\nb'
    const s = state(doc, doc.indexOf('b'))
    const next = s.update({ changes: { from: doc.length, insert: '\n# C\nc' } }).state
    const hidden = focusHiddenRanges(next, next.selection.main.head)
    const view = new EditorView({ state: next })
    expect(hidden.length).toBeGreaterThan(0)
    expect(view.dom.textContent).not.toContain('a')
    view.destroy()
  })
})

describe('focusStepTarget (PageDown/PageUp)', () => {
  const lineEnd = (doc: string, text: string) => doc.indexOf(text) + text.length

  it('goes to the next and previous heading with text of its own', () => {
    const s = state(DOC, at('Text 1B'))
    expect(focusStepTarget(s, at('Text 1B'), 1)).toBe(lineEnd(DOC, '# Zwei'))
    expect(focusStepTarget(s, at('Text 1B'), -1)).toBe(lineEnd(DOC, '### Eins A x'))
  })

  it('skips a heading without own text; the path still shows it', () => {
    const doc = '# A\n## A1\ntext\n# B\nb'
    const s = state(doc, 0)
    expect(focusStepTarget(s, 0, 1)).toBe(lineEnd(doc, '## A1'))
    expect(focusStepTarget(s, doc.indexOf('text'), -1)).toBeNull()
    expect(visible(doc, doc.indexOf('text'))).toEqual(['# A', '## A1', 'text', '# B'])
  })

  it('does nothing at the ends', () => {
    expect(focusStepTarget(state(DOC), at('Text 2A'), 1)).toBeNull()
    expect(focusStepTarget(state(DOC), at('Intro eins'), -1)).toBeNull()
  })

  it('before the first heading the first step goes to the first filled heading', () => {
    const doc = `Vorspann\n\n${DOC}`
    expect(focusStepTarget(state(doc), 0, 1)).toBe(lineEnd(doc, '# Eins'))
  })

  it('no headings: no step', () => {
    expect(focusStepTarget(state('nur text'), 0, 1)).toBeNull()
  })
})

describe('focus keys and scrolling', () => {
  const press = (view: EditorView, key: string) =>
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )

  it('PageDown steps to the next section only while focus is on', () => {
    const view = new EditorView({ state: state(DOC, at('Text 1B')) })
    press(view, 'PageDown')
    expect(view.state.selection.main.head).toBe(DOC.indexOf('# Zwei') + '# Zwei'.length)
    press(view, 'PageUp')
    expect(view.state.selection.main.head).toBe(DOC.indexOf('## Eins B') + '## Eins B'.length)
    view.dispatch({ effects: focusCompartment.reconfigure(focusExtensions(false)) })
    press(view, 'PageDown')
    // Off: CodeMirror's own page motion (happy-dom has no layout), never the section step.
    expect(view.state.selection.main.head).not.toBe(DOC.indexOf('# Zwei') + '# Zwei'.length)
    view.destroy()
  })

  it('a cursor move into another section asks to scroll; a move inside it does not', () => {
    const s = state(DOC, at('Text 1B'))
    expect(s.update({ selection: { anchor: at('Text 2A') } }).effects).toHaveLength(1)
    expect(s.update({ selection: { anchor: at('Text 1B') + 2 } }).effects).toHaveLength(0)
  })

  it('an edit never scrolls', () => {
    const s = state(DOC, at('Text 1B'))
    const tr = s.update({ changes: { from: at('Text 1B'), insert: 'x' } })
    expect(tr.effects.length).toBe(0)
  })
})
