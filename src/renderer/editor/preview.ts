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
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'
import { frontmatterFields } from './frontmatter'

export type PreviewRange = { from: number; to: number }

const hide = Decoration.replace({ rf: 'hide' })
const lineDeco = (cls: string) => Decoration.line({ class: cls, rf: `line:${cls}` })
const markDeco = (cls: string) => Decoration.mark({ class: cls, rf: `mark:${cls}` })
const faint = markDeco('mdo-mark')
const listMark = markDeco('mdo-mark mdo-list-mark')

const INLINE: Record<string, { cls: string; marks: string[] }> = {
  Emphasis: { cls: 'mdo-em', marks: ['EmphasisMark'] },
  StrongEmphasis: { cls: 'mdo-strong', marks: ['EmphasisMark'] },
  Strikethrough: { cls: 'mdo-strike', marks: ['StrikethroughMark'] },
  InlineCode: { cls: 'mdo-code-inline', marks: ['CodeMark'] },
  Link: { cls: 'mdo-link', marks: ['LinkMark', 'URL', 'LinkTitle', 'LinkLabel'] },
}

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
}

function makeCx(
  state: EditorState,
  out: Range<Decoration>[],
  ranges: readonly PreviewRange[] = [{ from: 0, to: state.doc.length }],
): PreviewCx {
  const doc = state.doc
  const touches = (from: number, to: number) =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from)
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
  const inline = INLINE[name]
  if (inline) {
    cx.out.push(markDeco(inline.cls).range(ref.from, ref.to))
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
    cx.out.push(markDeco('mdo-link').range(ref.from, ref.to))
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
const ALERT_RE = /^\s*>\s*\[!(note|tip|important|warning|caution)\]\s*$/i

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
      if (item?.parent?.name !== 'BulletList') return
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
  return Decoration.set(out, true)
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
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = buildPreview(u.state, u.view.visibleRanges)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
