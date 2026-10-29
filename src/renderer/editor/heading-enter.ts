import { syntaxTree } from '@codemirror/language'
import { Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'

/**
 * Enter at the start of a paragraph directly under a heading, in Preview and Present (owner,
 * 2026-10-29). The blank lines around a heading collapse there (preview.ts, like Typst), so a
 * plain newline added a line nobody saw and the cursor stayed on the text: Enter seemed to do
 * nothing. Here it opens a new paragraph above instead: a blank line for the cursor (visible,
 * since it holds the cursor) and one that separates it from the existing text. Typing then
 * writes the new paragraph; the Code view keeps the plain newline.
 */
export function enterBelowHeading(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection
  if (sel.ranges.length !== 1 || !sel.main.empty) return false
  const line = state.doc.lineAt(sel.main.head)
  if (sel.main.head !== line.from || line.text.trim() === '' || line.number === 1) return false
  let above = state.doc.line(line.number - 1)
  while (above.text.trim() === '' && above.number > 1) above = state.doc.line(above.number - 1)
  if (!isHeading(view, above.from) || isHeading(view, line.from)) return false
  view.dispatch({
    changes: { from: line.from, insert: '\n\n' },
    selection: { anchor: line.from },
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}

function isHeading(view: EditorView, pos: number): boolean {
  for (
    let n: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(view.state).resolveInner(
      pos,
      1,
    );
    n;
    n = n.parent
  )
    if (/^(ATX|Setext)Heading/.test(n.name)) return true
  return false
}

/** Before lang-markdown's Enter (list and quote continuation), which never applies here. */
export const headingEnter = Prec.high(keymap.of([{ key: 'Enter', run: enterBelowHeading }]))
