import { isolateHistory } from '@codemirror/commands'
import { Prec } from '@codemirror/state'
import { type Command, type EditorView, keymap } from '@codemirror/view'
import { refused } from './format'

/** The pipeline's page break: an HTML comment on its own line. */
export const PAGEBREAK = '<!-- pagebreak -->'

/** Every line the pipeline reads as a page break (lib/markdown.typ pagebreaks()). */
export const PAGEBREAK_LINE = /^\s*(?:<!--\s*pagebreak\s*-->|\\newpage|\\pagebreak|\\clearpage)\s*$/

const isBlank = (text: string): boolean => /^\s*$/.test(text)

/**
 * Inserts `<!-- pagebreak -->` as its own paragraph (blank line before and after, none doubled).
 * A selection is replaced; a cursor inside a line splits it. The cursor ends on the line after
 * the break. One undo step, and typing right after it is a step of its own. Refuses (returns
 * false) where the line formats refuse (spec „Refused contexts“): Present, a frozen editor, and
 * any selection range touching the front matter, a code block, an HTML block or comment, a
 * display formula or a table (the comment line would break the table or land in the code).
 * Checked here, not by the callers, so Mod+Enter, the menu and the toolbar refuse alike.
 */
export const insertPageBreak: Command = (view: EditorView): boolean => {
  const { state } = view
  if (refused(state, 'line')) return false
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
    // Like every format command: text typed right after the break must not join its undo step.
    annotations: isolateHistory.of('full'),
  })
  return true
}

/**
 * Mod+Enter beats CodeMirror's `insertBlankLine`. Always claims the key (even when refused, e.g.
 * in the front matter or a table) so neither the default binding nor, via preventDefault, the native menu
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
