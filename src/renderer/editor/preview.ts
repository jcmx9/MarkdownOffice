import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range, TransactionSpec } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common'
import { nobreakRanges } from '../../core/nobreak'
import { MEMO_PREVIEW, type PreviewSpec } from '../../core/preview-spec'
import { smartTypography } from '../../core/typography'
import { frontmatterFields } from './frontmatter'
import { EXTERNAL_DEST } from './inline-render'
import { isRealLink, referenceLabels } from './link-refs'
import { previewSource } from './preview-source'
import { lineIsRendered, selectionTouches } from './rendered'
import { typoMaskOf } from './typo-mask'

export type PreviewRange = { from: number; to: number }

const hide = Decoration.replace({ rf: 'hide' })
const lineDeco = (cls: string) => Decoration.line({ class: cls, rf: `line:${cls}` })
const markDeco = (cls: string) => Decoration.mark({ class: cls, rf: `mark:${cls}` })
const faint = markDeco('mdo-mark')
const listMark = markDeco('mdo-mark mdo-list-mark')
// text-wrap-mode: nowrap (theme.css): no line break inside, the source stays byte-exact.
const nobreakMark = markDeco('mdo-nobreak')
// Hanging indent (theme.css): continuation lines start where the item's text does, like the PDF.
const listItem = lineDeco('mdo-list-item')
// A number slot (theme.css) so `1.` + space fills the indent like the bullet slot does.
const olMark = markDeco('mdo-ol-mark')
const listItemVariants = new Map<string, Decoration>()

/**
 * The list line class plus what theme.css needs to hang the wrapped lines under the item's own
 * text: `lead` visible spaces before the marker (nested items keep their source indent) and
 * `extra` digits beyond one in the list's widest number (its slot grows by 1ch each).
 */
function listItemDeco(lead: number, extra: number): Decoration {
  const style = [
    lead > 0 ? `--mdo-list-lead: ${lead}` : '',
    extra > 0 ? `--mdo-list-extra: ${extra}` : '',
  ]
    .filter(Boolean)
    .join('; ')
  if (style === '') return listItem
  let deco = listItemVariants.get(style)
  if (!deco) {
    deco = Decoration.line({
      class: 'mdo-list-item',
      attributes: { style },
      rf: 'line:mdo-list-item',
    })
    listItemVariants.set(style, deco)
  }
  return deco
}

/**
 * Spaces left visible before a list marker: the quote marks and the space after each are hidden.
 * Tabs end at a tab stop, not after a fixed number of space advances: no lead then.
 */
function listLead(prefix: string): number {
  const visible = prefix.replace(/> ?/g, '')
  return /^ *$/.test(visible) ? Math.min(visible.length, 64) : 0
}

/** Digits beyond one in the widest number of an ordered list (numbers ascend: the last one). */
function listExtraDigits(mark: SyntaxNodeRef, list: SyntaxNode): number {
  const last = list.lastChild?.getChild('ListMark')
  const widest = Math.max(mark.to - mark.from, last ? last.to - last.from : 0)
  // the marker is the number plus `.` or `)`
  return Math.max(0, widest - 2)
}

const INLINE: Record<string, { cls: string; marks: string[] }> = {
  Emphasis: { cls: 'mdo-em', marks: ['EmphasisMark'] },
  StrongEmphasis: { cls: 'mdo-strong', marks: ['EmphasisMark'] },
  Strikethrough: { cls: 'mdo-strike', marks: ['StrikethroughMark'] },
  InlineCode: { cls: 'mdo-code-inline', marks: ['CodeMark'] },
  Link: { cls: 'mdo-link', marks: ['LinkMark', 'URL', 'LinkTitle', 'LinkLabel'] },
}

/** The destination of a `Link` or `Autolink` node if the set marks it as external. */
function externalDest(state: EditorState, node: SyntaxNode): string | null {
  const url = node.getChild('URL')
  if (!url) return null
  const dest = state.doc.sliceString(url.from, url.to)
  return EXTERNAL_DEST.test(dest) ? dest : null
}

/**
 * The small ↗ after an external link, like the set's PDF. A widget, so the arrow is never
 * part of the document (byte-exact source); the glyph itself comes from CSS (`::before`),
 * so copying the rendered text does not pick it up either.
 */
class LinkArrowWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'mdo-link-arrow'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
}
// side -1: the arrow belongs to the link's end, so a cursor right after the link sits behind it.
const linkArrow = Decoration.widget({ widget: new LinkArrowWidget(), side: -1, rf: 'link-arrow' })

/** Context passed to every node handler (Task 5 adds block handlers that use it too). */
export interface PreviewCx {
  state: EditorState
  out: Range<Decoration>[]
  /** Line starts whose text a widget already replaces: skip further replaces there. */
  replacedLines: Set<number>
  /** Blank line starts already collapsed next to a heading (a line between two headings once). */
  gapLines: Set<number>
  /** True if pos lies in one of the ranges being decorated (the viewport). */
  inRanges(pos: number): boolean
  touches(from: number, to: number): boolean
  onLine(pos: number): boolean
  lines(from: number, to: number, d: Decoration): void
  hideOrFaint(from: number, to: number, reveal: boolean): void
  /** True if a `Link` node is a real link, not literal brackets like the citation `[21]`. */
  isLink(node: SyntaxNode): boolean
}

function makeCx(
  state: EditorState,
  out: Range<Decoration>[],
  ranges: readonly PreviewRange[] = [{ from: 0, to: state.doc.length }],
): PreviewCx {
  const doc = state.doc
  const touches = (from: number, to: number) => selectionTouches(state, from, to)
  const slice = (from: number, to: number) => doc.sliceString(from, to)
  // Definitions may sit anywhere (usually at the end, outside the viewport): collected from
  // the whole tree, once per pass and only when a link without destination needs them.
  let labels: Set<string> | undefined
  return {
    state,
    out,
    replacedLines: new Set(),
    gapLines: new Set(),
    inRanges: (pos) => ranges.some((r) => r.from <= pos && pos <= r.to),
    touches,
    onLine(pos) {
      const l = doc.lineAt(pos)
      return touches(l.from, l.to)
    },
    lines(from, to, d) {
      for (let pos = from; pos <= to; ) {
        const l = doc.lineAt(pos)
        out.push(d.range(l.from))
        pos = l.to + 1
      }
    },
    hideOrFaint(from, to, reveal) {
      if (from >= to) return
      if (!reveal && doc.lineAt(from).number === doc.lineAt(to).number) {
        out.push(hide.range(from, to))
        return
      }
      // Replace decorations from plugins must not span a line break: fade per line segment.
      for (let pos = from; pos < to; ) {
        const l = doc.lineAt(pos)
        const end = Math.min(l.to, to)
        if (end > pos) out.push(faint.range(pos, end))
        pos = l.to + 1
      }
    },
    isLink(node) {
      labels ??= referenceLabels(syntaxTree(state), slice)
      return isRealLink(node, slice, labels)
    },
  }
}

const headingGap = lineDeco('mdo-heading-gap')

/**
 * Typst ignores blank lines around a heading: the heading block's own above/below spacing sets
 * the gap. The heading line carries that spacing as padding (theme.css), so the blank lines
 * directly before and after it collapse, and the Preview looks the same with or without them.
 * A blank line holding the cursor or selection keeps its height, so the cursor stays visible.
 */
function collapseHeadingGaps(cx: PreviewCx, node: SyntaxNode): void {
  const doc = cx.state.doc
  const collapse = (n: number): boolean => {
    const l = doc.line(n)
    if (l.text.trim() !== '') return false
    // Only lines in the decorated ranges, like every other decoration of this pass.
    if (cx.inRanges(l.from) && !cx.onLine(l.from) && !cx.gapLines.has(l.from)) {
      cx.gapLines.add(l.from)
      cx.out.push(headingGap.range(l.from))
    }
    return true
  }
  for (let n = doc.lineAt(node.from).number - 1; n >= 1 && collapse(n); n--);
  for (let n = doc.lineAt(node.to).number + 1; n <= doc.lines && collapse(n); n++);
}

function heading(cx: PreviewCx, node: SyntaxNode, level: number): void {
  const { state } = cx
  cx.out.push(lineDeco(`mdo-h${level}`).range(state.doc.lineAt(node.from).from))
  collapseHeadingGaps(cx, node)
  const reveal = cx.onLine(node.from)
  for (const m of node.getChildren('HeaderMark')) {
    if (m.from === node.from) {
      const space = state.doc.sliceString(m.to, m.to + 1) === ' ' ? 1 : 0
      cx.hideOrFaint(m.from, m.to + space, reveal)
    } else {
      const space = state.doc.sliceString(m.from - 1, m.from) === ' ' ? 1 : 0
      cx.hideOrFaint(m.from - space, m.to, reveal)
    }
  }
}

/** Handles one node; returns false to skip its children. Task 5 extends this. */
export function visitInline(cx: PreviewCx, ref: SyntaxNodeRef): boolean | undefined {
  const name = ref.name
  const atx = /^ATXHeading(\d)$/.exec(name)
  if (atx) {
    heading(cx, ref.node, Number(atx[1]))
    return
  }
  const setext = /^SetextHeading(\d)$/.exec(name)
  if (setext) {
    cx.out.push(lineDeco(`mdo-h${setext[1]}`).range(cx.state.doc.lineAt(ref.from).from))
    collapseHeadingGaps(cx, ref.node)
    for (const m of ref.node.getChildren('HeaderMark')) cx.out.push(faint.range(m.from, m.to))
    return
  }
  if (name === 'Frontmatter') {
    cx.lines(ref.from, ref.to, lineDeco('mdo-frontmatter'))
    return false
  }
  // `[21]` without destination or definition is text (CommonMark, PDF): keep its brackets,
  // no link look; the children (e.g. `[**21**]`) are still styled.
  if (name === 'Link' && !cx.isLink(ref.node)) return
  const inline = INLINE[name]
  if (inline) {
    const external = name === 'Link' && externalDest(cx.state, ref.node) !== null
    cx.out.push(
      markDeco(external ? `${inline.cls} mdo-link-ext` : inline.cls).range(ref.from, ref.to),
    )
    if (external) cx.out.push(linkArrow.range(ref.to))
    const reveal = cx.touches(ref.from, ref.to)
    for (const markName of inline.marks) {
      for (const m of ref.node.getChildren(markName)) cx.hideOrFaint(m.from, m.to, reveal)
    }
    return
  }
  if (name === 'URL' && ref.node.parent?.name !== 'Link' && ref.node.parent?.name !== 'Image') {
    cx.out.push(markDeco('mdo-link').range(ref.from, ref.to))
    return
  }
  if (name === 'Autolink') {
    // <https://…> is a real link in the PDF (and gets the ↗); a bare URL without <> is not.
    const external = externalDest(cx.state, ref.node) !== null
    cx.out.push(markDeco(external ? 'mdo-link mdo-link-ext' : 'mdo-link').range(ref.from, ref.to))
    if (external) cx.out.push(linkArrow.range(ref.to))
    // The PDF prints the link without its `<` `>`; the cursor line keeps them to edit.
    if (lineIsRendered(cx.state, cx.state.doc.lineAt(ref.from))) {
      for (const m of ref.node.getChildren('LinkMark')) cx.out.push(hide.range(m.from, m.to))
    }
    return false
  }
  if (name === 'Escape') {
    cx.out.push(faint.range(ref.from, ref.from + 1))
    return
  }
  if (name === 'CommentBlock' || name === 'Comment') {
    cx.out.push(markDeco('mdo-comment').range(ref.from, ref.to))
    return false
  }
  return
}

/** The memo set's alert titles per `lang` (memo.typ labels), German without `lang`. */
const ALERT_TITLES: Record<'de' | 'en', Record<string, string>> = {
  de: { note: 'Info', tip: 'Tipp', important: 'Wichtig', warning: 'Hinweis', caution: 'Achtung' },
  en: { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' },
}

export function alertTitle(state: EditorState, type: string): string {
  // template.typ label-text: the first two letters pick the labels, unknown ones fall back to en.
  const lang = (frontmatterFields(state.doc).lang ?? '').trim().toLowerCase() || 'de'
  const titles = lang.startsWith('de') ? ALERT_TITLES.de : ALERT_TITLES.en
  return titles[type] ?? type
}
export const ALERT_RE = /^\s*>\s*\[!(note|tip|important|warning|caution)\]\s*$/i

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'mdo-bullet'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  override eq(other: TaskWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'mdo-task'
    box.checked = this.checked
    box.setAttribute('aria-label', this.checked ? 'Erledigt' : 'Offen')
    box.tabIndex = -1
    // The document is the source of truth: never let the browser toggle the DOM itself.
    box.addEventListener('click', (e) => e.preventDefault())
    box.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      // Position looked up at click time, so a reused widget never edits a stale offset.
      const spec = toggleTaskAt(view.state, view.posAtDOM(box))
      if (spec) view.dispatch(spec)
    })
    return box
  }
}

class AlertTitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super()
  }
  override eq(other: AlertTitleWidget): boolean {
    return other.title === this.title
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'mdo-alert-title'
    s.textContent = this.title
    return s
  }
}

/** Toggles `[ ]` ↔ `[x]` at `pos` (the `[`): exactly one character changes. */
export function toggleTaskAt(state: EditorState, pos: number): TransactionSpec | null {
  const text = state.doc.sliceString(pos, pos + 3)
  if (!/^\[[ xX]\]$/.test(text)) return null
  return {
    changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' },
    userEvent: 'input.toggle-task',
  }
}

function hideQuoteMark(cx: PreviewCx, m: { from: number; to: number }): void {
  const line = cx.state.doc.lineAt(m.from)
  if (cx.replacedLines.has(line.from)) return
  const space = cx.state.doc.sliceString(m.to, m.to + 1) === ' ' ? 1 : 0
  cx.hideOrFaint(m.from, m.to + space, cx.onLine(m.from))
}

export function visitBlock(cx: PreviewCx, ref: SyntaxNodeRef): boolean | undefined {
  const { state, out } = cx
  const doc = state.doc
  switch (ref.name) {
    case 'ListMark': {
      const item = ref.node.parent
      const list = item?.parent?.name
      if (!item || (list !== 'BulletList' && list !== 'OrderedList')) return
      // Every item's first line, nested ones too (their source indent stays as it renders).
      const line = doc.lineAt(ref.from)
      const lead = listLead(doc.sliceString(line.from, ref.from))
      const ordered = list === 'OrderedList' ? item.parent : null
      const extra = ordered ? listExtraDigits(ref, ordered) : 0
      out.push(listItemDeco(lead, extra).range(line.from))
      if (ordered) {
        // the cursor line too: the number is plain text either way, so nothing jumps
        out.push(olMark.range(ref.from, ref.to))
        return
      }
      if (item.getChild('Task')) {
        const space = doc.sliceString(ref.to, ref.to + 1) === ' ' ? 1 : 0
        out.push(hide.range(ref.from, ref.to + space))
      } else if (cx.onLine(ref.from)) {
        // Same slot as the square, so the text does not shift when the mark is revealed.
        out.push(listMark.range(ref.from, ref.to))
      } else {
        out.push(
          Decoration.replace({ widget: new BulletWidget(), rf: 'bullet' }).range(ref.from, ref.to),
        )
      }
      return
    }
    case 'TaskMarker': {
      const checked = /x/i.test(doc.sliceString(ref.from, ref.to))
      out.push(
        Decoration.replace({ widget: new TaskWidget(checked), rf: 'task' }).range(ref.from, ref.to),
      )
      return
    }
    case 'Blockquote': {
      const first = doc.lineAt(ref.from)
      const alert = ALERT_RE.exec(first.text)
      if (alert?.[1]) {
        const type = alert[1].toLowerCase()
        cx.lines(ref.from, ref.to, lineDeco(`mdo-alert mdo-alert-${type}`))
        if (!cx.onLine(first.from)) {
          cx.replacedLines.add(first.from)
          out.push(
            Decoration.replace({
              widget: new AlertTitleWidget(alertTitle(state, type)),
              rf: 'alert-title',
            }).range(first.from, first.to),
          )
        }
      } else {
        cx.lines(ref.from, ref.to, lineDeco('mdo-quote'))
      }
      return
    }
    case 'QuoteMark':
      hideQuoteMark(cx, ref)
      return
    case 'FencedCode': {
      const firstLine = doc.lineAt(ref.from)
      const lastLine = doc.lineAt(ref.to)
      const closed =
        lastLine.number > firstLine.number &&
        ref.node.getChildren('CodeMark').some((m) => m.from >= lastLine.from)
      for (let n = firstLine.number; n <= lastLine.number; n++) {
        const l = doc.line(n)
        const fence = n === firstLine.number || (closed && n === lastLine.number)
        out.push(lineDeco(fence ? 'mdo-codefence' : 'mdo-codeblock').range(l.from))
      }
      return false
    }
    case 'CodeBlock':
      cx.lines(ref.from, ref.to, lineDeco('mdo-codeblock'))
      return false
    case 'Table': {
      const firstLine = doc.lineAt(ref.from).number
      const lastLine = doc.lineAt(Math.max(ref.from, ref.to - 1)).number
      // Away from the cursor, tableField (Task 6) shows the PDF-like widget instead.
      if (!cx.touches(doc.line(firstLine).from, doc.line(lastLine).to)) return false
      for (let n = firstLine; n <= lastLine; n++) {
        const idx = n - firstLine
        const cls =
          idx === 0
            ? 'mdo-table-head'
            : idx === 1
              ? 'mdo-table-delim'
              : (idx - 2) % 2 === 1
                ? 'mdo-table-row mdo-table-stripe'
                : 'mdo-table-row'
        out.push(lineDeco(cls).range(doc.line(n).from))
      }
      return
    }
    case 'TableDelimiter':
      out.push(faint.range(ref.from, ref.to))
      return
    case 'HorizontalRule':
      out.push(lineDeco('mdo-hr').range(doc.lineAt(ref.from).from))
      if (!cx.onLine(ref.from)) out.push(hide.range(ref.from, ref.to))
      return
  }
  return
}

/** Node handlers; every handler sees every node. If any returns false, the node's children are skipped. */
export const handlers: Array<(cx: PreviewCx, ref: SyntaxNodeRef) => boolean | undefined> = [
  visitInline,
  visitBlock,
]

export function buildPreview(
  state: EditorState,
  ranges: readonly PreviewRange[] = [{ from: 0, to: state.doc.length }],
): DecorationSet {
  const out: Range<Decoration>[] = []
  const cx = makeCx(state, out, ranges)
  const tree = syntaxTree(state)
  // Visible ranges may overlap: handle each node once, replaying its verdict.
  const seen = new Map<string, boolean>()
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        const key = `${ref.name}:${ref.from}:${ref.to}`
        const prior = seen.get(key)
        if (prior !== undefined) return prior ? undefined : false
        let skip = false
        // A widget already replaces this whole line: no decorations inside it.
        const startLine = state.doc.lineAt(ref.from)
        if (cx.replacedLines.has(startLine.from) && ref.to <= startLine.to) {
          seen.set(key, false)
          return false
        }
        for (const h of handlers) {
          if (h(cx, ref) === false) skip = true
        }
        seen.set(key, !skip)
        return skip ? false : undefined
      },
    })
  }
  showTypography(state, tree, ranges, out)
  keepHiddenMarksAttached(state, out)
  markNobreakPhrases(state, tree, ranges, out)
  return Decoration.set(out, true)
}

const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff
const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff

/**
 * A hidden mark renders as an empty span between two `<img class="cm-widgetBuffer">`, and an
 * `<img>` is an atomic inline: Chromium may wrap before or after it, so `**fett**,` could start
 * a line with the comma (findings step2 §3 M). Typst sees no mark there. Each run of adjacent
 * hidden marks with text on both sides gets a nowrap span from the character before to the
 * character after; the widget buffers themselves stay untouched (CodeMirror needs them for
 * the cursor). A mark revealed at the cursor has no `hide` range, so it gets no span either.
 */
function keepHiddenMarksAttached(state: EditorState, out: Range<Decoration>[]): void {
  const doc = state.doc
  const runs = out
    .filter((r) => r.value === hide)
    .map((r) => ({ from: r.from, to: r.to }))
    .sort((a, b) => a.from - b.from)
  for (let i = 0; i < runs.length; i++) {
    const from = runs[i]?.from ?? 0
    let to = runs[i]?.to ?? 0
    // `](url)` is four hidden ranges in a row: one run, one span.
    while (i + 1 < runs.length && runs[i + 1]?.from === to) to = runs[++i]?.to ?? to
    const line = doc.lineAt(from)
    if (from <= line.from || to >= line.to) continue
    const text = line.text
    let a = from - line.from - 1
    let b = to - line.from + 1
    if (!/\S/.test(text.charAt(a)) || !/\S/.test(text.charAt(b - 1))) continue
    // Never cut a surrogate pair (emoji) in half: the span would split its two code units.
    if (a > 0 && isLowSurrogate(text.charCodeAt(a))) a--
    if (b < text.length && isHighSurrogate(text.charCodeAt(b - 1))) b++
    out.push(nobreakMark.range(line.from + a, line.from + b))
  }
}

// Where a set's no-break phrases do not apply: code is shown verbatim, tables have their own
// layout, the front matter is the head block's source, a formula is TeX set by Typst.
const NOBREAK_SKIP = new Set([
  'InlineCode',
  'FencedCode',
  'CodeBlock',
  'Table',
  'Frontmatter',
  'InlineMath',
  'BlockMath',
])

function inSkipped(tree: Tree, pos: number, side: -1 | 1, skip = NOBREAK_SKIP): boolean {
  for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
    if (skip.has(n.name)) return true
  }
  return false
}

/**
 * The set's no-break phrases (`nobreak:` in its `.preview.yaml`, memo's lists for memo or no
 * set) as nowrap spans: `z. B.` or `5 mm` never break across lines, like the PDF's U+00A0
 * from memo.typ's show rules, without inserting a character into the note.
 */
function markNobreakPhrases(
  state: EditorState,
  tree: Tree,
  ranges: readonly PreviewRange[],
  out: Range<Decoration>[],
): void {
  const nb: PreviewSpec['nobreak'] = (state.field(previewSource, false)?.spec ?? MEMO_PREVIEW)
    .nobreak
  if (nb.words.length === 0 && nb.units.length === 0) return
  const doc = state.doc
  const done = new Set<number>()
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      pos = line.to + 1
      if (done.has(line.from)) continue
      done.add(line.from)
      for (const r of nobreakRanges(line.text, nb)) {
        const a = line.from + r.from
        const b = line.from + r.to
        if (inSkipped(tree, a, 1) || inSkipped(tree, b, -1)) continue
        out.push(nobreakMark.range(a, b))
      }
    }
  }
}

/**
 * A typographic character the PDF prints in place of the source characters (`„` for `"`, `–`
 * for `--`, …). Shown over them by a replace decoration, so the note keeps its bytes and the
 * cursor still steps over the source characters. Equal by text, so a rebuild reuses the DOM.
 */
class TypoWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  override eq(other: TypoWidget): boolean {
    return other.text === this.text
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.textContent = this.text
    return s
  }
}
// A handful of characters in all: one decoration each, shared by every rebuild.
const typoDecos = new Map<string, Decoration>()
function typoDeco(text: string): Decoration {
  let deco = typoDecos.get(text)
  if (!deco) {
    deco = Decoration.replace({ widget: new TypoWidget(text), rf: 'typo' })
    typoDecos.set(text, deco)
  }
  return deco
}

// The syntax tree's say on top of markdown.typ's own skip rules: code is verbatim, a table has
// its own widget, the front matter is the header's source, HTML is passed through untouched,
// a formula (via NOBREAK_SKIP) is TeX: no `–` or quotes are drawn over its source.
const TYPO_SKIP = new Set([
  ...NOBREAK_SKIP,
  'HTMLBlock',
  'HTMLTag',
  'CommentBlock',
  'Comment',
  'ProcessingInstructionBlock',
])

/**
 * The characters markdown.typ's smart-typography puts into the PDF (quotes per `lang`, dashes,
 * ellipsis), shown in rendered lines only (lineIsRendered: never the cursor line, never the
 * Code view). Nothing where another replace decoration already hides the source (link URLs,
 * marks), so two replacements never overlap.
 */
function showTypography(
  state: EditorState,
  tree: Tree,
  ranges: readonly PreviewRange[],
  out: Range<Decoration>[],
): void {
  const doc = state.doc
  const tm = typoMaskOf(state)
  // Sorted by start; the substitutions come in document order, so one sweep finds overlaps:
  // ranges ending before a substitution can never cover a later one.
  const replaced = out
    .filter((r) => r.from < r.to && (r.value === hide || r.value.spec.widget))
    .sort((x, y) => x.from - y.from)
  let next = 0
  const covered = (from: number, to: number): boolean => {
    while (next < replaced.length && (replaced[next]?.to ?? 0) <= from) next++
    // The first remaining range starts earliest: if it starts at or after `to`, all do.
    return next < replaced.length && (replaced[next]?.from ?? to) < to
  }
  const done = new Set<number>()
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      pos = line.to + 1
      if (done.has(line.from)) continue
      done.add(line.from)
      if (tm.mask[line.number - 1] || !lineIsRendered(state, line)) continue
      for (const sub of smartTypography(line.text, tm.lang)) {
        const a = line.from + sub.from
        const b = line.from + sub.to
        if (inSkipped(tree, a, 1, TYPO_SKIP) || covered(a, b)) continue
        out.push(typoDeco(sub.text).range(a, b))
      }
    }
  }
}

export const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildPreview(view.state, view.visibleRanges)
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        // another set description brings other no-break phrases
        u.startState.field(previewSource, false) !== u.state.field(previewSource, false)
      ) {
        this.decorations = buildPreview(u.state, u.view.visibleRanges)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
