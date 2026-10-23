import type { EditorState } from '@codemirror/state'
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
    return renderBlocks(this.blocks, { part: 'foot', signature: this.signature, empty: 'none' })
  }
  // Not editable: clicks in the foot never place the cursor there or start a selection.
  override ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  // Exactly the head block's visibility (header hidden or Present, closed front matter with a
  // body, no selection keeping the header open), so a foot never shows under an open header.
  if (!headCollapsed(state)) return Decoration.none
  const blocks = noteBlocks(state, 'foot')
  if (!blocks.length) return Decoration.none
  const signature = state.field(previewSource, false)?.signature ?? null
  return Decoration.set([
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
    // the header; other cursor moves leave the foot alone.
    const flipped = headCollapsed(tr.startState) !== headCollapsed(tr.state)
    const sourced = tr.effects.some((e) => e.is(setPreviewSource))
    return tr.docChanged || flipped || sourced ? build(tr.state) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
