// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { MEMO_PREVIEW, type PreviewSpec } from '../../../src/core/preview-spec'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { buildPreview, previewPlugin } from '../../../src/renderer/editor/preview'
import { previewSource, setPreviewSource } from '../../../src/renderer/editor/preview-source'
import { parsed } from './parsed'
import { rf } from './preview-helper'

const lists = (d: string[]) => d.filter((x) => x.startsWith('line:mdo-list-item'))
const nobreak = (d: string[]) => d.filter((x) => x.startsWith('mark:mdo-nobreak'))

function withSpec(text: string, spec: PreviewSpec | null): EditorState {
  const doc = `${text}\n\nende`
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter] }), previewSource],
  })
  const source = spec && { set: 'fx', spec, profile: {}, signature: null }
  return parsed(state.update({ effects: setPreviewSource.of(source) }).state)
}

function collect(state: EditorState): string[] {
  const out: string[] = []
  buildPreview(state).between(0, state.doc.length, (from, to, d) => {
    out.push(`${(d.spec as { rf: string }).rf}@${from}-${to}`)
  })
  return out
}

describe('list items carry the hanging-indent line class', () => {
  it('marks bullet, task and ordered item lines', () => {
    // "- a" 0-3, "- [ ] b" 4-11, "1. c" 12-16
    expect(lists(rf('- a\n- [ ] b\n\n1. c'))).toEqual([
      'line:mdo-list-item@0-0',
      'line:mdo-list-item@4-4',
      'line:mdo-list-item@13-13',
    ])
  })
  it('marks nested items and the cursor line too', () => {
    // "- a" 0-3, "  - b" 4-9, "    1. c" 10-18
    expect(lists(rf('- a\n  - b\n    1. c', 6))).toEqual([
      'line:mdo-list-item@0-0',
      'line:mdo-list-item@4-4',
      'line:mdo-list-item@10-10',
    ])
  })
  it('leaves a continuation line of an item alone', () => {
    // "- a" 0-3, "  weiter" 4-12: the hanging indent already places it
    expect(lists(rf('- a\n  weiter'))).toEqual(['line:mdo-list-item@0-0'])
  })
})

describe('hidden marks never become break opportunities', () => {
  it('keeps a closing ** with the punctuation after it', () => {
    // "Ein **fett**, x": ** at 4-6 and 10-12; t at 9, "," at 12
    const d = rf('Ein **fett**, x')
    expect(d).toContain('hide@10-12')
    expect(nobreak(d)).toEqual(['mark:mdo-nobreak@9-13'])
  })
  it('keeps a link with the full stop after it, across all its hidden parts', () => {
    // "[Link](u)." : [ 0-1, ] 5-6, ( 6-7, u 7-8, ) 8-9, "." 9
    expect(nobreak(rf('[Link](u).'))).toEqual(['mark:mdo-nobreak@4-10'])
  })
  it('adds nothing when a space follows or precedes the mark', () => {
    expect(nobreak(rf('Ein **fett** und'))).toEqual([])
    expect(nobreak(rf('x *kursiv* y'))).toEqual([])
  })
  it('keeps an opening mark with the word before it', () => {
    // "x**y** z": ** at 1-3; x at 0, y at 3
    expect(nobreak(rf('x**y** z'))).toEqual(['mark:mdo-nobreak@0-4'])
  })
  it('adds nothing on the line whose marks the cursor reveals', () => {
    expect(nobreak(rf('Ein **fett**, x', 6))).toEqual([])
  })
  it('never splits a surrogate pair next to a mark', () => {
    // "😀" is two UTF-16 units (0-2), ** at 2-4, "a" 4, ** 5-7, "😀" 7-9
    expect(nobreak(rf('😀**a**😀'))).toEqual(['mark:mdo-nobreak@0-5', 'mark:mdo-nobreak@4-9'])
  })
  it('builds a valid decoration set with the marks overlapping the hidden ranges', () => {
    const doc = 'Ein **fett**, [Link](u). Und x**y**z.\n\nende'
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter] }), previewPlugin],
    })
    const view = new EditorView({ state: parsed(state), parent: document.body })
    view.dispatch({ selection: { anchor: doc.length } })
    expect(view.contentDOM.querySelectorAll('.mdo-nobreak').length).toBeGreaterThan(0)
    // the text stays byte-exact
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })
})

describe('no-break phrases from the set description', () => {
  it('marks memo phrases and number + unit without a set', () => {
    // "Das ist z. B. 5 mm breit": "z. B." 8-13, "5 mm" 14-18
    expect(nobreak(rf('Das ist z. B. 5 mm breit'))).toEqual([
      'mark:mdo-nobreak@8-13',
      'mark:mdo-nobreak@14-18',
    ])
  })
  it("uses the note's set spec: an empty list marks nothing", () => {
    const spec: PreviewSpec = { ...MEMO_PREVIEW, nobreak: { words: [], units: [] } }
    expect(nobreak(collect(withSpec('Das ist z. B. gut', spec)))).toEqual([])
    expect(nobreak(collect(withSpec('Das ist z. B. gut', null)))).toEqual(['mark:mdo-nobreak@8-13'])
  })
  it('skips inline code, code blocks and table lines', () => {
    expect(nobreak(rf('Code `z. B.` hier'))).toEqual([])
    expect(nobreak(rf('```\nz. B.\n```'))).toEqual([])
    expect(nobreak(rf('    z. B. eingerückt'))).toEqual([])
    expect(nobreak(rf('| a | b |\n|---|---|\n| z. B. | 5 mm |', 0))).toEqual([])
  })
  it('marks only lines in the decorated ranges', () => {
    const state = withSpec('z. B. eins\n\nz. B. zwei', null)
    const out: string[] = []
    buildPreview(state, [{ from: 12, to: 22 }]).between(0, state.doc.length, (f, t, d) => {
      out.push(`${(d.spec as { rf: string }).rf}@${f}-${t}`)
    })
    expect(nobreak(out)).toEqual(['mark:mdo-nobreak@12-17'])
  })
  it('rebuilds when the set description changes', () => {
    const doc = 'Das ist z. B. gut\n\nende'
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
        previewSource,
        previewPlugin,
      ],
    })
    const view = new EditorView({ state: parsed(state), parent: document.body })
    const marks = () => {
      const out: string[] = []
      view.plugin(previewPlugin)?.decorations.between(0, view.state.doc.length, (f, t, d) => {
        out.push(`${(d.spec as { rf: string }).rf}@${f}-${t}`)
      })
      return nobreak(out)
    }
    view.dispatch({ selection: { anchor: doc.length } })
    expect(marks()).toEqual(['mark:mdo-nobreak@8-13'])
    const spec: PreviewSpec = { ...MEMO_PREVIEW, nobreak: { words: [], units: [] } }
    view.dispatch({
      effects: setPreviewSource.of({ set: 'fx', spec, profile: {}, signature: null }),
    })
    expect(marks()).toEqual([])
    view.destroy()
  })
})
