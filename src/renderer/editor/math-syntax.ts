import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { tags as t } from '@lezer/highlight'
import type {
  BlockContext,
  InlineContext,
  LeafBlock,
  LeafBlockParser,
  MarkdownConfig,
} from '@lezer/markdown'
import { scanInlineMath } from '../../core/math-delims'

const DOLLAR = 36
const BACKSLASH = 92
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13

/**
 * lang-markdown's `~x~` / `^x^` spans start before a `$` inside them and would swallow the
 * formula (`q~$x~y$`); the PDF knows neither span, only the formula. Where the span the built-in
 * parser would take (same scan: up to the next marker, escapes skipped, no whitespace) holds the
 * start of a formula, the marker is passed over as text and the formula is parsed after it.
 */
function guardSubSuper(ch: number) {
  return (cx: InlineContext, next: number, pos: number): number => {
    if (next !== ch || cx.char(pos + 1) === ch) return -1
    for (let i = pos + 1; i < cx.end; i++) {
      const c = cx.char(i)
      if (c === ch || isSpace(c)) return -1
      if (c === BACKSLASH) i++
      else if (c === DOLLAR && scanInlineMath(cx.text, i - cx.offset)) return pos + 1
    }
    return -1
  }
}

/**
 * A paragraph that is exactly one `$$…$$` (the usual way of writing display math) becomes a
 * `BlockMath` node, so the preview can show it as a block. Decided when the paragraph ends:
 * any other text in it, and the formula stays an `InlineMath` of that paragraph.
 */
class BlockMathParser implements LeafBlockParser {
  nextLine(): boolean {
    return false
  }
  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    const m = scanInlineMath(leaf.content, 0)
    // Trailing spaces after the closing `$$` add nothing the PDF shows.
    if (!m?.display || leaf.content.slice(m.end).trim() !== '') return false
    const from = leaf.start
    const to = from + m.end
    cx.addLeafElement(
      leaf,
      cx.elt('BlockMath', from, to, [
        cx.elt('MathMark', from, from + 2),
        cx.elt('MathMark', to - 2, to),
      ]),
    )
    return true
  }
}

/**
 * `$…$` and `$$…$$` formulas by the PDF's rules (core/math-delims, pulldown-cmark as in cmarker).
 * The inline parser consumes the whole formula as one element, so emphasis, sub/superscript and
 * links never act inside it; code spans keep winning where they start first (left to right).
 */
export const MathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath' },
    { name: 'BlockMath', block: true },
    { name: 'MathMark', style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      leaf: (_cx, leaf) =>
        leaf.content.charCodeAt(0) === DOLLAR && leaf.content.charCodeAt(1) === DOLLAR
          ? new BlockMathParser()
          : null,
    },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1
        const m = scanInlineMath(cx.text, pos - cx.offset)
        if (!m) return -1
        const end = cx.offset + m.end
        const w = m.display ? 2 : 1
        return cx.addElement(
          cx.elt('InlineMath', pos, end, [
            cx.elt('MathMark', pos, pos + w),
            cx.elt('MathMark', end - w, end),
          ]),
        )
      },
    },
    { name: 'MathBeforeSubscript', before: 'Subscript', parse: guardSubSuper(126) },
    { name: 'MathBeforeSuperscript', before: 'Superscript', parse: guardSubSuper(94) },
  ],
}

/**
 * The formula's TeX: the text between its two `MathMark`s. Inside a blockquote the continuation
 * lines carry `>` marks (and the space after each), which belong to the quote, not the formula.
 */
export function mathTex(state: EditorState, node: SyntaxNode): string {
  const marks = node.getChildren('MathMark')
  const open = marks[0]
  const close = marks[1]
  if (!open || !close) return ''
  let tex = ''
  let pos = open.to
  for (const q of node.getChildren('QuoteMark')) {
    tex += state.doc.sliceString(pos, q.from)
    pos = state.doc.sliceString(q.to, q.to + 1) === ' ' ? q.to + 1 : q.to
  }
  return tex + state.doc.sliceString(pos, close.from)
}

/**
 * A formula's TeX as the PDF gets it from a GFM table cell: the table splits the row first and
 * every `\|` in a cell is an escaped pipe, inside formulas too (cmark-gfm's unescape_pipes:
 * the backslash before a `|` goes, every other backslash stays). For table cells only.
 */
export function unescapeCellPipes(tex: string): string {
  return tex.replace(/\\\|/g, '|')
}
