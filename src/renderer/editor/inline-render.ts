import { markdownLanguage } from '@codemirror/lang-markdown'
import type { SyntaxNode } from '@lezer/common'

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

/** Inline Markdown → DOM, built node by node (never innerHTML); HTML stays text. */
export function renderInline(text: string, parent: HTMLElement): void {
  const doc = parent.ownerDocument
  const tree = markdownLanguage.parser.parse(text)
  const walk = (node: SyntaxNode, from: number, to: number, into: HTMLElement): void => {
    let pos = from
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.from > pos) into.append(text.slice(pos, c.from))
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
        el.className = spec[1]
        walk(c, c.from, c.to, el)
        into.append(el)
      } else if (c.name === 'URL' || c.name === 'Autolink') {
        const el = doc.createElement('span')
        el.className = 'mdo-link'
        el.textContent = text.slice(c.from, c.to).replace(/^<|>$/g, '')
        into.append(el)
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
