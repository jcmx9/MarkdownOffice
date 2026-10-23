import { type EditorState, Facet, type Line } from '@codemirror/state'

/**
 * True while the editor shows the Preview (Present always does): viewExtensions adds it with the
 * preview plugin. A facet, so state-only code (decorations, fields) can ask without a view.
 */
export const previewView = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

/**
 * Whether `line` shows as the PDF does (typographic characters, Typst's line breaks) instead of
 * its raw characters: in Preview or Present, and only while no selection range touches it. The
 * line with the cursor stays raw, so what is typed there is what is seen (the note's bytes never
 * change either way). "Touches" includes the line's ends, like the preview's mark reveal.
 */
export function lineIsRendered(state: EditorState, line: Line): boolean {
  return state.facet(previewView) && !selectionTouches(state, line.from, line.to)
}

/**
 * Whether a selection range touches `from`…`to`, ends included: a cursor right before or after
 * a mark reveals it, and the cursor at a line's end keeps that line raw.
 */
export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from)
}
