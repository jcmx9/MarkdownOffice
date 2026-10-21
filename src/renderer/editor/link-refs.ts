import type { SyntaxNode, Tree } from '@lezer/common'

/**
 * Which `Link` nodes are real links.
 *
 * Lezer's Markdown parser marks every bracket pair `[…]` as a `Link`, even a citation like
 * `[21]` that has no destination and no `[21]: …` definition. Per CommonMark that is plain
 * text, and the PDF pipeline (Typst + cmarker) prints it with its brackets. The preview,
 * Present and the table widget must therefore only hide the brackets of a real link, or
 * "[21]" would show up as "21".
 */

/** Slices source text by offsets (a document or a table cell). */
export type Slice = (from: number, to: number) => string

/**
 * A link label normalised like CommonMark: trim, collapse inner whitespace to one space,
 * case-fold. `toLowerCase().toUpperCase()` is the fold the CommonMark reference
 * implementation uses (so `ß` matches `SS`).
 */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase()
}

/** Blocks that hold only inline content: a link reference definition never sits inside. */
const INLINE_ONLY =
  /^(Paragraph|ATXHeading\d|SetextHeading\d|Table|FencedCode|CodeBlock|HTMLBlock|CommentBlock|Frontmatter)$/

/** The normalised labels of all link reference definitions (`[label]: dest`) in the tree. */
export function referenceLabels(tree: Tree, slice: Slice): Set<string> {
  const labels = new Set<string>()
  tree.iterate({
    enter: (n) => {
      if (n.name === 'LinkReference') {
        const label = n.node.getChild('LinkLabel')
        if (label) labels.add(normalizeLabel(slice(label.from + 1, label.to - 1)))
        return false
      }
      return INLINE_ONLY.test(n.name) ? false : undefined
    },
  })
  return labels
}

/**
 * True if a `Link` node is a link in CommonMark's sense: an inline link `[text](dest)` (also
 * with an empty destination `[text]()`), or a full/collapsed/shortcut reference whose label is
 * defined in the document. Otherwise its brackets are literal text.
 */
export function isRealLink(node: SyntaxNode, slice: Slice, labels: ReadonlySet<string>): boolean {
  const marks = node.getChildren('LinkMark')
  if (node.getChild('URL') || marks.some((m) => slice(m.from, m.to) === '(')) return true
  const label = node.getChild('LinkLabel')
  // `[text][label]` uses the label; `[text][]` and `[text]` use the text between the brackets.
  if (label && label.to - label.from > 2) {
    return labels.has(normalizeLabel(slice(label.from + 1, label.to - 1)))
  }
  const open = marks[0]
  const close = marks[1]
  if (!open || !close) return false
  return labels.has(normalizeLabel(slice(open.to, close.from)))
}
