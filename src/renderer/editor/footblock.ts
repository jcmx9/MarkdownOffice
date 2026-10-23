import type { EditorState, Range } from '@codemirror/state'
import { StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import type { PreviewBlock } from '../../core/preview-spec'
import { headCollapsed } from './header'
import { noteBlocks, previewSource, setPreviewSource } from './preview-source'
import { renderBlocks } from './titleblock'

class FootBlockWidget extends WidgetType {
  constructor(
    readonly blocks: readonly PreviewBlock[],
    readonly signature: string | null,
  ) {
    super()
  }
  override eq(other: FootBlockWidget): boolean {
    // `===` compares the signature by value; cheap because a source keeps one data URL instance.
    return (
      other.signature === this.signature &&
      JSON.stringify(other.blocks) === JSON.stringify(this.blocks)
    )
  }
  override toDOM(): HTMLElement {
    const el = renderBlocks(this.blocks, { part: 'foot', signature: this.signature, empty: 'none' })
    // The PDF starts the foot one paragraph gap below the text (din5008a.typ: parbreak()),
    // however the note ends; the trailing blank lines collapse (gapLines), so this carries it.
    if (!el.classList.contains('mdo-footblock-none')) {
      const gap = document.createElement('div')
      gap.className = 'mdo-footblock-gap'
      el.prepend(gap)
    }
    return el
  }
  // Not editable: clicks in the foot never place the cursor there or start a selection.
  override ignoreEvent(): boolean {
    return true
  }
}

const trailingGap = Decoration.line({ class: 'mdo-foot-gap' })

/**
 * Blank lines at the end of the note, which Markdown and the PDF ignore: collapsed like the
 * blank lines around a heading, so the gap above the foot does not depend on whether the note
 * ends with a line break. A blank line holding the cursor or selection keeps its height.
 */
function gapLines(state: EditorState): Range<Decoration>[] {
  const out: Range<Decoration>[] = []
  const { doc, selection } = state
  for (let n = doc.lines; n > 1; n--) {
    const l = doc.line(n)
    if (l.text.trim() !== '') break
    if (selection.ranges.some((r) => r.from <= l.to && r.to >= l.from)) continue
    out.push(trailingGap.range(l.from))
  }
  return out.reverse()
}

function build(state: EditorState): DecorationSet {
  // Exactly the head block's visibility (header hidden or Present, closed front matter with a
  // body, no selection keeping the header open), so a foot never shows under an open header.
  if (!headCollapsed(state)) return Decoration.none
  const blocks = noteBlocks(state, 'foot')
  if (!blocks.length) return Decoration.none
  const signature = state.field(previewSource, false)?.signature ?? null
  return Decoration.set([
    ...gapLines(state),
    // side 1 after the last position: the cursor at doc.length stays before it, never inside.
    Decoration.widget({
      widget: new FootBlockWidget(blocks, signature),
      block: true,
      side: 1,
    }).range(state.doc.length),
  ])
}

/** Preview-only: the set-described blocks after the body (closing, signature, attachments …). */
export const footBlock: StateField<DecorationSet> = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    // Covers header toggle, mode switch, snippet session end and selection moves onto or off
    // the header; a selection change also moves the cursor onto or off a trailing blank line.
    const flipped = headCollapsed(tr.startState) !== headCollapsed(tr.state)
    const sourced = tr.effects.some((e) => e.is(setPreviewSource))
    return tr.docChanged || flipped || sourced || tr.selection ? build(tr.state) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
