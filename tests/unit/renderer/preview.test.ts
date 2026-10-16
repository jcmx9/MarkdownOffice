// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { buildPreview, previewPlugin } from '../../../src/renderer/editor/preview'
import { rf } from './preview-helper'

describe('headings', () => {
  it('styles the line and hides "# " away from the cursor', () => {
    expect(rf('# Titel')).toEqual(expect.arrayContaining(['line:mdo-h1@0-0', 'hide@0-2']))
  })
  it('shows the marks faint when the cursor is on the line', () => {
    const d = rf('## Titel', 4)
    expect(d).toContain('line:mdo-h2@0-0')
    // "## " incl. its space is the mark range
    expect(d).toContain('mark:mdo-mark@0-3')
    expect(d.some((x) => x.startsWith('hide@0'))).toBe(false)
  })
  it('styles #### as h4', () => {
    expect(rf('#### Klein')).toContain('line:mdo-h4@0-0')
  })
})

describe('inline elements', () => {
  it('strong: style and hide **', () => {
    expect(rf('**fett**')).toEqual(
      expect.arrayContaining(['mark:mdo-strong@0-8', 'hide@0-2', 'hide@6-8']),
    )
  })
  it('strong: reveals ** faint with the cursor inside', () => {
    const d = rf('**fett**', 3)
    expect(d).toEqual(
      expect.arrayContaining(['mark:mdo-strong@0-8', 'mark:mdo-mark@0-2', 'mark:mdo-mark@6-8']),
    )
    expect(d.filter((x) => x.startsWith('hide'))).toEqual([])
  })
  it('emphasis, strike, inline code', () => {
    expect(rf('*kursiv*')).toEqual(
      expect.arrayContaining(['mark:mdo-em@0-8', 'hide@0-1', 'hide@7-8']),
    )
    expect(rf('~~weg~~')).toEqual(
      expect.arrayContaining(['mark:mdo-strike@0-7', 'hide@0-2', 'hide@5-7']),
    )
    expect(rf('`code`')).toEqual(
      expect.arrayContaining(['mark:mdo-code-inline@0-6', 'hide@0-1', 'hide@5-6']),
    )
  })
  it('link: keeps the text, hides brackets and URL', () => {
    expect(rf('[Text](https://x.de)')).toEqual(
      expect.arrayContaining([
        'mark:mdo-link@0-20',
        'hide@0-1',
        'hide@5-6',
        'hide@6-7',
        'hide@7-19',
        'hide@19-20',
      ]),
    )
  })
  it('bare URL is styled, never hidden', () => {
    const d = rf('siehe https://x.de')
    expect(d).toContain('mark:mdo-link@6-18')
    expect(d.filter((x) => x.startsWith('hide'))).toEqual([])
  })
})

describe('front matter', () => {
  it('gets its own line class and no heading styles', () => {
    const d = rf('---\ntitle: x\n---')
    expect(d).toEqual(
      expect.arrayContaining([
        'line:mdo-frontmatter@0-0',
        'line:mdo-frontmatter@4-4',
        'line:mdo-frontmatter@13-13',
      ]),
    )
    expect(d.some((x) => x.startsWith('line:mdo-h'))).toBe(false)
  })
})

describe('ranges', () => {
  it('only decorates the requested range', () => {
    const doc = '# Eins\n\n# Zwei'
    const state = EditorState.create({
      doc: `${doc}\n\nende`,
      selection: { anchor: doc.length + 6 },
      extensions: markdown({ base: markdownLanguage }),
    })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const out: number[] = []
    buildPreview(state, [{ from: 8, to: 14 }]).between(0, state.doc.length, (from) => {
      out.push(from)
    })
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((p) => p >= 8)).toBe(true)
    expect(out).not.toContain(0)
    expect(out).not.toContain(0)
  })
})

function stateOf(doc: string, anchor: number, head?: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head: head ?? anchor },
    extensions: markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

function collect(state: EditorState, set = buildPreview(state)): string[] {
  const out: string[] = []
  set.between(0, state.doc.length, (from, to, d) => {
    out.push(`${(d.spec as { rf: string }).rf}@${from}-${to}`)
  })
  return out
}

function noCrossLineHide(state: EditorState, d: string[]): boolean {
  return d
    .filter((x) => x.startsWith('hide@'))
    .every((x) => {
      const [from = 0, to = 0] = x.slice(5).split('-').map(Number)
      return state.doc.lineAt(from).number === state.doc.lineAt(to).number
    })
}

describe('line breaks', () => {
  it('never hides across a line break (link title)', () => {
    const state = stateOf('[a](u "t\nt")\n\nende', 17)
    expect(noCrossLineHide(state, collect(state))).toBe(true)
  })
  it('never hides across a line break (multi-line label)', () => {
    const state = stateOf('[a][x\ny]\n\n[x y]: https://x.de\n\nende', 33)
    expect(noCrossLineHide(state, collect(state))).toBe(true)
  })
})

describe('reveal rule', () => {
  it('reveals with a second selection range touching the element', () => {
    const state = EditorState.create({
      doc: 'text **fett** text\n\nende',
      selection: { anchor: 22 },
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        markdown({ base: markdownLanguage }),
      ],
    }).update({
      selection: EditorSelection.create([EditorSelection.cursor(22), EditorSelection.cursor(8)], 0),
    }).state
    ensureSyntaxTree(state, state.doc.length, 5000)
    const d = collect(state)
    expect(d).toContain('mark:mdo-mark@5-7')
    expect(d.some((x) => x.startsWith('hide'))).toBe(false)
  })
  it('reveals when a selection ends exactly at the element start', () => {
    const d = collect(stateOf('ab **fett**\n\nende', 0, 3))
    expect(d).toContain('mark:mdo-mark@3-5')
    expect(d.some((x) => x.startsWith('hide'))).toBe(false)
  })
})

describe('nesting', () => {
  it('handles ***x***', () => {
    const d = rf('***x***')
    expect(d).toContain('mark:mdo-strong@1-6')
    expect(d).toContain('mark:mdo-em@0-7')
  })
  it('handles [**a**](u)', () => {
    const d = rf('[**a**](u)')
    expect(d).toContain('mark:mdo-link@0-10')
    expect(d).toContain('mark:mdo-strong@1-6')
  })
  it('does not style image URLs as links', () => {
    expect(rf('![alt](https://x.de/a.png)').some((x) => x.startsWith('mark:mdo-link@'))).toBe(false)
  })
})

describe('previewPlugin', () => {
  it('follows selection and document changes', () => {
    const state = EditorState.create({
      doc: '**fett**\n\nende',
      selection: { anchor: 14 },
      extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter] }), previewPlugin],
    })
    const view = new EditorView({ state, parent: document.body })
    const get = () => collect(view.state, view.plugin(previewPlugin)?.decorations)
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.dispatch({ selection: { anchor: 1 } })
    let d = get()
    expect(d.some((x) => x.startsWith('hide'))).toBe(false)
    expect(d).toContain('mark:mdo-mark@0-2')
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    expect(get()).toContain('hide@0-2')
    view.dispatch({ changes: { from: 0, insert: '# ' } })
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    d = get()
    expect(d).toContain('line:mdo-h1@0-0')
    view.destroy()
  })
})
