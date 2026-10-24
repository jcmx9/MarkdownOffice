import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

// The syntax itself lives in core so the CLI parses notes like the editor (core/markdown-syntax).
export { MathSyntax } from '../../core/markdown-syntax'

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
