// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import { describe, expect, it } from 'vitest'
import { renderInline } from '../../../src/renderer/editor/inline-render'
import { mdoMarkdown } from '../../../src/renderer/editor/markdown'
import { mathTex, unescapeCellPipes } from '../../../src/renderer/editor/math-syntax'
import { buildPreview } from '../../../src/renderer/editor/preview'
import { createState } from '../../../src/renderer/editor/setup'
import {
  spellcheckCompartment,
  spellcheckExtensions,
} from '../../../src/renderer/editor/spellcheck'
import { parsed } from './parsed'

const parser = mdoMarkdown().language.parser

/** All nodes of the tree as `Name from-to`, in document order. */
function nodes(tree: Tree, names?: readonly string[]): string[] {
  const out: string[] = []
  tree.iterate({
    enter: (n) => {
      if (!names || names.includes(n.name)) out.push(`${n.name} ${n.from}-${n.to}`)
    },
  })
  return out
}

const NAMES = ['Paragraph', 'BlockMath', 'InlineMath', 'MathMark']

describe('math syntax nodes', () => {
  it('a paragraph that is exactly one $$…$$ is a BlockMath with two marks', () => {
    expect(nodes(parser.parse('$$\na\n$$'), NAMES)).toEqual([
      'BlockMath 0-7',
      'MathMark 0-2',
      'MathMark 5-7',
    ])
  })

  it('$$…$$ with text around it stays an InlineMath in its paragraph', () => {
    expect(nodes(parser.parse('text $$ a $$ more'), NAMES)).toEqual([
      'Paragraph 0-17',
      'InlineMath 5-12',
      'MathMark 5-7',
      'MathMark 10-12',
    ])
  })

  it('a $$ block followed by more text in the same paragraph is no BlockMath', () => {
    const names = nodes(parser.parse('$$\na\n$$\nund weiter'), NAMES)
    expect(names).not.toContain('BlockMath 0-7')
    expect(names).toContain('InlineMath 0-7')
  })

  it('$x$ is an InlineMath with two marks', () => {
    expect(nodes(parser.parse('a $x$ b'), NAMES)).toEqual([
      'Paragraph 0-7',
      'InlineMath 2-5',
      'MathMark 2-3',
      'MathMark 4-5',
    ])
  })

  it('no emphasis inside a formula', () => {
    const tree = parser.parse('*a $x*y$ b*')
    expect(nodes(tree, ['Emphasis', 'InlineMath'])).toEqual(['Emphasis 0-11', 'InlineMath 3-8'])
    const inner = nodes(tree).filter((n) => /^Emphasis(Mark)? [3-7]-/.test(n))
    expect(inner).toEqual([])
  })

  it('no subscript inside a formula', () => {
    const tree = parser.parse('H~2~O $x~y$')
    expect(nodes(tree, ['Subscript', 'InlineMath'])).toEqual(['Subscript 1-4', 'InlineMath 6-11'])
  })

  it('a ~ or ^ span never swallows a formula that starts inside it (the PDF has neither)', () => {
    expect(nodes(parser.parse('q~$x~y$'), ['Subscript', 'InlineMath'])).toEqual(['InlineMath 2-7'])
    expect(nodes(parser.parse('q^$x^y$'), ['Superscript', 'InlineMath'])).toEqual([
      'InlineMath 2-7',
    ])
    expect(nodes(parser.parse('H~2~O'), ['Subscript'])).toEqual(['Subscript 1-4'])
  })

  it('no formula in code spans, fences, indented code or the front matter', () => {
    const doc = '---\nt: $x$\n---\n\n`$x$`\n\n```\n$x$\n```\n\n    $x$\n'
    expect(nodes(parser.parse(doc), ['InlineMath', 'BlockMath'])).toEqual([])
  })

  it('mathTex is the text between the marks', () => {
    const state = EditorState.create({
      doc: 'a $x^2$ b\n\n$$\n\\sum\n$$',
      extensions: mdoMarkdown(),
    })
    const tree = mdoMarkdown().language.parser.parse(state.doc.toString())
    const found: SyntaxNode[] = []
    tree.iterate({
      enter: (n) => {
        if (n.name === 'InlineMath' || n.name === 'BlockMath') found.push(n.node)
      },
    })
    expect(found.map((n) => mathTex(state, n))).toEqual(['x^2', '\n\\sum\n'])
  })

  it('mathTex leaves out the quote marks of a formula inside a blockquote', () => {
    const state = EditorState.create({ doc: '> $$\n> a\n> $$', extensions: mdoMarkdown() })
    const tree = mdoMarkdown().language.parser.parse(state.doc.toString())
    const block = tree.topNode.firstChild?.getChild('BlockMath')
    expect(block).toBeTruthy()
    if (block) expect(mathTex(state, block)).toBe('\na\n')
  })
})

describe('table cells (renderInline)', () => {
  it('parses a formula in a cell: no emphasis inside it', () => {
    const el = document.createElement('div')
    renderInline('$a *b* c$', el)
    expect(el.querySelector('em')).toBeNull()
    expect(el.textContent).toBe('$a *b* c$')
  })
  it('the editor tree sees formulas in table cells too', () => {
    const names = nodes(parser.parse('| a |\n|---|\n| $x$ |'), ['InlineMath'])
    expect(names).toEqual(['InlineMath 14-17'])
  })
  it.each([
    ['|x|', '|x|'],
    ['\\|x\\|', '|x|'],
    ['a \\\\\\| b', 'a \\\\| b'],
    ['\\{x\\}', '\\{x\\}'],
  ])('a cell formula’s \\| is GFM’s escaped pipe: %s → %s', (cell, tex) => {
    expect(unescapeCellPipes(cell)).toBe(tex)
  })
})

describe('spellcheck', () => {
  it('words in $\\alpha beta$ are not checked, the rest of the line is', () => {
    const v = new EditorView({
      state: parsed(createState('Ein $\\alpha beta$ Satz\n', '\n', 'preview')),
      parent: document.body,
    })
    v.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckExtensions(true, 'edit')) })
    const line = v.contentDOM.querySelector('.cm-line') as HTMLElement
    expect(line.getAttribute('spellcheck')).not.toBe('false')
    const off = [...line.querySelectorAll('[spellcheck="false"]')].map((e) => e.textContent)
    expect(off.join('')).toBe('$\\alpha beta$')
  })
  it('lines of a $$ block are not checked', () => {
    const v = new EditorView({
      state: parsed(createState('$$\n\\alpha beta\n$$\n', '\n', 'preview')),
      parent: document.body,
    })
    v.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckExtensions(true, 'edit')) })
    const lines = [...v.contentDOM.querySelectorAll('.cm-line')] as HTMLElement[]
    expect(lines.slice(0, 3).map((l) => l.getAttribute('spellcheck'))).toEqual([
      'false',
      'false',
      'false',
    ])
  })
})

describe('preview until formulas are drawn', () => {
  /** Preview decorations as `rf@from-to`, cursor on the trailing line. */
  function decos(text: string): string[] {
    const doc = `${text}\n\nende`
    const state = parsed(createState(doc, '\n', 'preview'))
    const at = state.update({ selection: { anchor: doc.length } }).state
    const out: string[] = []
    buildPreview(at).between(0, at.doc.length, (from, to, d) => {
      out.push(`${(d.spec as { rf: string }).rf}@${from}-${to}`)
    })
    return out
  }

  it('keeps the $ marks visible and draws no typography inside the formula', () => {
    // Three `$`: markdown.typ's split skips nothing here, but `$a--b$` (12-18) is a formula;
    // the `--` before it still becomes a dash.
    const out = decos('x -- y: $5, $a--b$')
    expect(out).toContain('typo@2-4')
    expect(out.filter((d) => /@1[2-7]-/.test(d))).toEqual([])
  })
})
