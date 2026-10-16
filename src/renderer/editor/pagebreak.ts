import { type EditorState, Prec } from '@codemirror/state'
import { type Command, type EditorView, keymap } from '@codemirror/view'
import { frontmatterRange } from './frontmatter'

/** The pipeline's page break: an HTML comment on its own line. */
export const PAGEBREAK = '<!-- pagebreak -->'

const isBlank = (text: string): boolean => /^\s*$/.test(text)

/** Whether the selection touches the YAML front matter (a break there would corrupt it). */
function inFrontmatter(state: EditorState): boolean {
  const range = frontmatterRange(state.doc)
  if (!range) return false
  return state.selection.ranges.some((r) => r.from <= range.to && r.to >= range.from)
}

/**
 * Inserts `<!-- pagebreak -->` as its own paragraph (blank line before and after, none doubled).
 * A selection is replaced; a cursor inside a line splits it. The cursor ends on the line after
 * the break. One undo step. Refuses (returns false) inside the front matter.
 */
export const insertPageBreak: Command = (view: EditorView): boolean => {
  const { state } = view
  if (inFrontmatter(state)) return false
  const nl = state.lineBreak
  const { from, to } = state.selection.main
  const startLine = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to)
  const before = from > startLine.from
  const prev = startLine.number > 1 ? state.doc.line(startLine.number - 1) : null

  // Break must start on its own line, preceded by a blank line.
  const prefix = before ? nl + nl : !prev || isBlank(prev.text) ? '' : nl

  const tailEmpty = to === endLine.to
  const next = endLine.number < state.doc.lines ? state.doc.line(endLine.number + 1) : null
  let suffix: string
  if (!tailEmpty) suffix = nl + nl
  else if (next) suffix = isBlank(next.text) ? '' : nl
  else suffix = before || from !== to ? nl + nl : nl

  const insert = prefix + PAGEBREAK + suffix
  const cursor = from + prefix.length + PAGEBREAK.length + nl.length
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor },
    scrollIntoView: true,
    userEvent: 'input.pagebreak',
  })
  return true
}

/**
 * Mod+Enter beats CodeMirror's `insertBlankLine`. Always claims the key (even when refused in the
 * front matter) so neither the default binding nor, via preventDefault, the native menu
 * accelerator fires a second time.
 */
export const pageBreakKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Mod-Enter',
      run: (view) => {
        insertPageBreak(view)
        return true
      },
    },
  ]),
)
