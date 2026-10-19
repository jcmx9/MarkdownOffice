import type { EditorState, TransactionSpec } from '@codemirror/state'
import { frontmatterRange } from './frontmatter'

export type InsertHeaderResult = { spec: TransactionSpec } | { refused: 'exists' }

/**
 * A template's header in the line break `nl` (trailing blank lines dropped) and where the
 * cursor belongs: inside `title: ""`, else right after the header's final line break. One rule
 * for inserting into a note and for starting a new note, so both put the cursor in the same spot.
 */
function headerParts(template: string, nl: string): { header: string; anchor: number } {
  const header = template.replace(/\s+$/, '').split(/\r?\n/).join(nl)
  const title = header.search(/^title: ""/m)
  const anchor = title >= 0 ? title + 'title: "'.length : header.length + nl.length
  return { header, anchor }
}

/**
 * Inserts a YAML header template (a template set's `<name>.header.md`) at the very top of the
 * note: front matter only counts there. The template's lines take the note's line break; a
 * blank line separates it from existing text. The cursor lands inside `title: ""`, else after
 * the header. Refused when the note already starts with a front matter.
 */
export function insertHeader(state: EditorState, template: string): InsertHeaderResult {
  if (frontmatterRange(state.doc)) return { refused: 'exists' }
  const nl = state.lineBreak
  const { header, anchor } = headerParts(template, nl)
  const first = state.doc.line(1).text
  const gap = state.doc.length === 0 ? '' : /^\s*$/.test(first) ? '' : nl
  const insert = header + nl + gap
  return {
    spec: {
      changes: { from: 0, insert },
      selection: { anchor },
      scrollIntoView: true,
      userEvent: 'input',
    },
  }
}

/**
 * The text and cursor of a new note that starts with a set's header. The text becomes the
 * tab's initial (clean) document instead of an insertion, so a new note that is never typed
 * into leaves no file behind; LF like every new note.
 */
export function headerNote(template: string): { text: string; anchor: number } {
  const { header, anchor } = headerParts(template, '\n')
  return { text: `${header}\n`, anchor }
}
