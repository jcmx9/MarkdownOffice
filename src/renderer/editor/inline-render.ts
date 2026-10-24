import { markdownLanguage } from '@codemirror/lang-markdown'
import type { SyntaxNode } from '@lezer/common'
import type { MarkdownParser } from '@lezer/markdown'
import { isRealLink } from './link-refs'
import { MathSyntax } from './math-syntax'

// The editor's own inline rules for a cell parsed on its own, formulas included: `$a*b*c$` in a
// cell is a formula as in the PDF, never emphasis.
const cellParser = (markdownLanguage.parser as MarkdownParser).configure([MathSyntax])

const ELEMENTS: Record<string, [tag: string, cls: string]> = {
  StrongEmphasis: ['strong', 'mdo-strong'],
  Emphasis: ['em', 'mdo-em'],
  InlineCode: ['code', 'mdo-code-inline'],
  Strikethrough: ['s', 'mdo-strike'],
  Link: ['span', 'mdo-link'],
}
const MARKS = new Set([
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'LinkMark',
  'LinkTitle',
  'LinkLabel',
])

/**
 * Link destinations the memo set marks as external in the PDF (memo.typ `is-external`,
 * case-sensitive like Typst's `starts-with`): they get the ↗ in the preview and table
 * widget too. Internal links (`#anker`) stay plain.
 */
export const EXTERNAL_DEST = /^(https?:\/\/|mailto:)/

/** The URL child's text of a `Link`/`Autolink` node, or '' without one. */
function destOf(text: string, node: SyntaxNode): string {
  const url = node.getChild('URL')
  return url ? text.slice(url.from, url.to) : ''
}

/** Appends the external-link arrow (glyph from CSS, so it is never copied as text). */
function appendArrow(into: HTMLElement): void {
  const arrow = into.ownerDocument.createElement('span')
  arrow.className = 'mdo-link-arrow'
  arrow.setAttribute('aria-hidden', 'true')
  into.append(arrow)
}

/**
 * Inline Markdown → DOM, built node by node (never innerHTML); HTML stays text.
 *
 * `labels` are the normalised reference labels of the whole document (`referenceLabels`):
 * a cell is parsed on its own and cannot see the definitions. A `[…]` that is no real link
 * (the citation `[21]`) keeps its brackets as text, as in the PDF.
 */
export function renderInline(
  text: string,
  parent: HTMLElement,
  labels: ReadonlySet<string> = new Set(),
): void {
  const doc = parent.ownerDocument
  const tree = cellParser.parse(text)
  const slice = (from: number, to: number) => text.slice(from, to)
  // `literal`: node is a `Link` that is no real link, so its brackets and label stay text.
  const walk = (
    node: SyntaxNode,
    from: number,
    to: number,
    into: HTMLElement,
    literal = false,
  ): void => {
    let pos = from
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.from > pos) into.append(text.slice(pos, c.from))
      if (c.name === 'Link' && !isRealLink(c, slice, labels)) {
        // Literal brackets: no link element; the inside is still rendered (`[**21**]`).
        walk(c, c.from, c.to, into, true)
        pos = c.to
        continue
      }
      if (literal && (c.name === 'LinkMark' || c.name === 'LinkLabel')) {
        into.append(text.slice(c.from, c.to))
        pos = c.to
        continue
      }
      if (
        MARKS.has(c.name) ||
        (c.name === 'URL' && (node.name === 'Link' || node.name === 'Image'))
      ) {
        pos = c.to
        continue
      }
      const spec = ELEMENTS[c.name]
      if (spec) {
        const el = doc.createElement(spec[0])
        const external = c.name === 'Link' && EXTERNAL_DEST.test(destOf(text, c))
        el.className = external ? `${spec[1]} mdo-link-ext` : spec[1]
        walk(c, c.from, c.to, el)
        into.append(el)
        if (external) appendArrow(into)
      } else if (c.name === 'URL' || c.name === 'Autolink') {
        // A bare URL is plain text in the PDF; only <https://…> is a link with the ↗.
        const external = c.name === 'Autolink' && EXTERNAL_DEST.test(destOf(text, c))
        const el = doc.createElement('span')
        el.className = external ? 'mdo-link mdo-link-ext' : 'mdo-link'
        el.textContent = text.slice(c.from, c.to).replace(/^<|>$/g, '')
        into.append(el)
        if (external) appendArrow(into)
      } else if (c.name === 'Escape') {
        into.append(text.slice(c.from + 1, c.to))
      } else {
        walk(c, c.from, c.to, into)
      }
      pos = c.to
    }
    if (to > pos) into.append(text.slice(pos, to))
  }
  walk(tree.topNode, 0, text.length, parent)
}
