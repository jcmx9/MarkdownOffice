import { tags as t } from '@lezer/highlight'
import type {
  BlockContext,
  Element,
  InlineContext,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
} from '@lezer/markdown'
import { Emoji, GFM, parser, Subscript, Superscript } from '@lezer/markdown'
import { type HighlightSpan, highlightSpans } from './highlight'
import { scanInlineMath } from './math-delims'

// The Markdown syntax of the editor, here so the CLI (export-files.ts) parses a note with the very
// same rules: the editor builds its language from lang-markdown's `markdownLanguage` (CommonMark +
// GFM, Subscript, Superscript, Emoji) plus these three extensions, `markdownParser` below is that
// parser without CodeMirror (markdown-syntax.test.ts compares both trees).

/** A front matter's opening line and its closing line (`---` or `...`), for every reader of it. */
export const FRONTMATTER_OPEN = /^---\s*$/
export const FRONTMATTER_CLOSE = /^(---|\.\.\.)\s*$/

/**
 * YAML front matter: only at the very start, `---` … `---`/`...` (pipeline/pandoc rule). The
 * editor adds the YAML highlighting on top (renderer/editor/frontmatter.ts).
 */
export const FrontmatterSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: t.meta },
    { name: 'FrontmatterMark', style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line): boolean {
        if (cx.lineStart !== 0 || !FRONTMATTER_OPEN.test(line.text)) return false
        const marks: Element[] = [cx.elt('FrontmatterMark', 0, line.text.length)]
        let end = line.text.length
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length
          if (FRONTMATTER_CLOSE.test(line.text)) {
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, end))
            cx.nextLine()
            break
          }
        }
        // An unclosed header still forms one block, so typing it never yields setext headings
        // (frontmatterRange returns null for it).
        cx.addElement(cx.elt('Frontmatter', 0, end, marks))
        return true
      },
    },
  ],
}

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

const EQUALS = 61
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }

/** The last line asked about, as an inline section asks once per `=` on the same line. */
let lastLine = ''
let lastSpans: HighlightSpan[] = []

/** The `==…==` spans of the line holding `pos` in this inline section, offsets in the line. */
function lineSpans(cx: InlineContext, pos: number): [lineStart: number, HighlightSpan[]] {
  const rel = pos - cx.offset
  const start = cx.text.lastIndexOf('\n', rel - 1) + 1
  const nl = cx.text.indexOf('\n', rel)
  const line = cx.text.slice(start, nl < 0 ? cx.text.length : nl)
  if (line !== lastLine) {
    lastLine = line
    lastSpans = highlightSpans(line)
  }
  return [cx.offset + start, lastSpans]
}

/** Closing `==` positions promised by an opening one, per inline section. */
const pendingClose = new WeakMap<InlineContext, Set<number>>()

/**
 * `==text==` highlights by the PDF's rules (core/highlight, markdown.typ `marks()`): only the
 * spans `highlightSpans` reports for the current line, so never across a line break and never
 * where the pipeline leaves the text alone. Opening and closing `==` are delimiters (like
 * GFM's `~~`), so emphasis, links and code inside are still parsed (`==**b**==`); code spans
 * and formulas are consumed by their own parsers first and never reach the `=` inside them.
 */
export const HighlightSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: t.special(t.content) },
    { name: 'HighlightMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS) return -1
        const closes = pendingClose.get(cx)
        if (closes?.delete(pos)) return cx.addDelimiter(HighlightDelim, pos, pos + 2, false, true)
        const [lineStart, spans] = lineSpans(cx, pos)
        const span = spans.find((s) => lineStart + s.from === pos)
        if (!span) return -1
        // The content holds no `=` (mark-re), so the next `=` this parser sees in the span is
        // its closing pair, unless a link or the like swallows it (the opener then stays text).
        if (closes) closes.add(lineStart + span.to - 2)
        else pendingClose.set(cx, new Set([lineStart + span.to - 2]))
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, true, false)
      },
    },
  ],
}

/** lang-markdown's `markdownLanguage` extensions, which the editor's language is built on. */
const BASE = [GFM, Subscript, Superscript, Emoji]

/** The editor's Markdown parser (mdoMarkdown in renderer/editor/markdown.ts) without CodeMirror. */
export const markdownParser = parser.configure([
  ...BASE,
  FrontmatterSyntax,
  MathSyntax,
  HighlightSyntax,
])

/** The same without front matter, for text the PDF reads as all body (see export-files.ts). */
export const markdownBodyParser = parser.configure([...BASE, MathSyntax, HighlightSyntax])
