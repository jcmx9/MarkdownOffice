import { hasNextSnippetField, hasPrevSnippetField } from '@codemirror/autocomplete'
import {
  EditorSelection,
  EditorState,
  type SelectionRange,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import { frontmatterRange } from './frontmatter'
import { presentMode } from './mode'
import { renderTitleBlock, type TitleBlock, titleBlockData } from './titleblock'

export const setHeaderHidden = StateEffect.define<boolean>()

export const headerHidden = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHeaderHidden)) value = e.value
    return value
  },
})

class TitleBlockWidget extends WidgetType {
  constructor(
    readonly data: TitleBlock | null,
    readonly present: boolean,
  ) {
    super()
  }
  override eq(other: TitleBlockWidget): boolean {
    return (
      other.present === this.present && JSON.stringify(other.data) === JSON.stringify(this.data)
    )
  }
  override toDOM(): HTMLElement {
    return renderTitleBlock(this.data, document, this.present ? 'none' : 'marker')
  }
}

/** True while a snippet session (Tab/Shift+Tab between fields) is active. */
function snippetActive(state: EditorState): boolean {
  return hasNextSnippetField(state) || hasPrevSnippetField(state)
}

function build(state: EditorState): DecorationSet {
  const present = state.facet(presentMode)
  if (!present && !state.field(headerHidden, false)) return Decoration.none
  const range = frontmatterRange(state.doc)
  // A header-only note stays open: there is nothing to type into otherwise.
  if (!range || range.to >= state.doc.length) return Decoration.none
  // A selection on the header keeps it visible: outside Present always (e.g. just retyped),
  // in Present only while a snippet session has its active field there (e.g. `:meeting`).
  // An active session's selection always lies in its active field.
  const onHeader = state.selection.ranges.some((r) => r.from <= range.to && r.to >= range.from)
  if (onHeader && (!present || snippetActive(state))) {
    return Decoration.none
  }
  return Decoration.set([
    Decoration.replace({
      widget: new TitleBlockWidget(titleBlockData(state.doc), present),
      block: true,
      rf: 'header-fold',
    }).range(range.from, range.to),
  ])
}

/** The collapsed header's range, or null when nothing is collapsed (or in Code view). */
function collapsedRange(state: EditorState): { from: number; to: number } | null {
  const deco = state.field(headerFold, false)
  if (!deco || deco.size === 0) return null
  const cur = deco.iter()
  return { from: cur.from, to: cur.to }
}

/** While collapsed, the header and the line break after it are read-only (undo/redo excepted). */
function protectHeader(tr: Transaction): boolean {
  const range = collapsedRange(tr.startState)
  if (!range || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return true
  let touched = false
  tr.changes.iterChangedRanges((from) => {
    if (from <= range.to) touched = true
  })
  return !touched
}

/** While collapsed, no selection end may sit on the header or before the line break after it. */
function clampSelection(tr: Transaction): Transaction | readonly (Transaction | TransactionSpec)[] {
  if (!tr.selection || !collapsedRange(tr.startState)) return tr
  const range = frontmatterRange(tr.newDoc)
  if (!range) return tr
  const min = Math.min(range.to + 1, tr.newDoc.length)
  const sel = tr.newSelection
  if (sel.ranges.every((r) => r.anchor >= min && r.head >= min)) return tr
  // Shift+Tab back to a snippet field in the header: the session keeps it open (see build).
  if (snippetActive(tr.state)) return tr
  const clamp = (r: SelectionRange) =>
    EditorSelection.range(Math.max(r.anchor, min), Math.max(r.head, min))
  const selection = EditorSelection.create(sel.ranges.map(clamp), sel.mainIndex)
  return [tr, { selection, sequential: true }]
}

function cursorInCollapsedHeader(state: EditorState): boolean {
  const range = collapsedRange(state)
  return !!range && state.selection.ranges.some((r) => r.anchor <= range.to || r.head <= range.to)
}

/** Undo/redo bypass the clamp filter; this moves a cursor that landed in the collapsed header. */
const keepCursorOut = ViewPlugin.fromClass(
  class {
    private destroyed = false
    update(u: { view: EditorView; state: EditorState }): void {
      if (!cursorInCollapsedHeader(u.state)) return
      const view = u.view
      queueMicrotask(() => {
        // The view (or this plugin) may be gone by now: never dispatch to a destroyed view.
        if (this.destroyed) return
        if (cursorInCollapsedHeader(view.state)) view.dispatch(moveOutOfHeader(view.state))
      })
    }
    destroy(): void {
      this.destroyed = true
    }
  },
)

/** Preview-only: the collapsed header, atomic and read-only so it is never edited unseen. */
export const headerFold: StateField<DecorationSet> = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    const flipped = tr.startState.field(headerHidden, false) !== tr.state.field(headerHidden, false)
    const modeFlipped = tr.startState.facet(presentMode) !== tr.state.facet(presentMode)
    // Esc ends a snippet session without moving the selection: rebuild so the header collapses.
    const sessionEnded = snippetActive(tr.startState) !== snippetActive(tr.state)
    return tr.docChanged || tr.selection || flipped || modeFlipped || sessionEnded
      ? build(tr.state)
      : deco
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f)),
    EditorState.changeFilter.of(protectHeader),
    EditorState.transactionFilter.of(clampSelection),
    keepCursorOut,
  ],
})

/** Selection-only spec: a cursor inside the front matter moves to the line after it. */
export function moveOutOfHeader(state: EditorState): TransactionSpec {
  const range = frontmatterRange(state.doc)
  if (!range) return {}
  const inside = state.selection.ranges.some((r) => r.from <= range.to && r.to >= range.from)
  if (!inside) return {}
  return {
    selection: EditorSelection.cursor(Math.min(range.to + 1, state.doc.length)),
    scrollIntoView: true,
  }
}

export function headerToggleSpec(state: EditorState, hide: boolean): TransactionSpec {
  const effects = setHeaderHidden.of(hide)
  return hide ? { ...moveOutOfHeader(state), effects } : { effects }
}
