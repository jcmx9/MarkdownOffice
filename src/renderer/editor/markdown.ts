import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { LanguageDescription } from '@codemirror/language'
import { foldService, LanguageSupport, syntaxTree } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { HighlightSyntax } from '../../core/markdown-syntax'
import { Frontmatter } from './frontmatter'
import { MathSyntax } from './math-syntax'

/** Blocks that are in the file but never shown: HTML comments (page breaks too) and link definitions. */
const INVISIBLE = new Set(['CommentBlock', 'LinkReference'])

function headingLevel(node: SyntaxNode): number | null {
  const m = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name)
  return m ? Number(m[1]) : null
}

/**
 * Section folds like lang-markdown's, but a section ends at its last visible block: trailing
 * comments and link definitions belong to the next heading (a page break before `## M3` is
 * M3's), so a section holding only those is empty and does not fold.
 */
export const sectionFold = foldService.of((state, start, end) => {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(end, -1);
    node;
    node = node.parent
  ) {
    if (node.from < start) break
    const level = headingLevel(node)
    if (level === null) continue
    let last: SyntaxNode | null = null
    for (let next = node.nextSibling; next; next = next.nextSibling) {
      const l = headingLevel(next)
      if (l !== null && l <= level) break
      if (!INVISIBLE.has(next.name)) last = next
    }
    return last && last.to > end ? { from: end, to: last.to } : null
  }
  return null
})

/**
 * Markdown with our front matter, formulas, highlights and section folds. lang-markdown's support is
 * [html tag support, header fold service, …rest]; its header fold service is replaced by
 * `sectionFold` (sections.test.ts fails if that order changes).
 */
export function mdoMarkdown(codeLanguages?: readonly LanguageDescription[]): LanguageSupport {
  const md = markdown({
    base: markdownLanguage,
    codeLanguages: codeLanguages as LanguageDescription[] | undefined,
    // Formulas by the PDF's rules: also keeps emphasis and typography out of them. Highlights
    // `==…==` exactly where markdown.typ's marks() sets them (core/highlight).
    extensions: [Frontmatter, MathSyntax, HighlightSyntax],
  })
  const [htmlSupport, , ...rest] = md.support as Extension[]
  return new LanguageSupport(md.language, [htmlSupport ?? [], sectionFold, ...rest])
}
