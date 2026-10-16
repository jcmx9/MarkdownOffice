import type { EditorState, TransactionSpec } from '@codemirror/state'
import { frontmatterRange } from './frontmatter'

export type InsertHeaderResult = { spec: TransactionSpec } | { refused: 'exists' }

/**
 * Inserts a YAML header template (the memo set's memo.header.md) at the very top of the note: front
 * matter only counts there. The template's lines take the note's line break; a blank line
 * separates it from existing text. The cursor lands inside `title: ""`, else after the header.
 * Refused when the note already starts with a front matter.
 */
export function insertHeader(state: EditorState, template: string): InsertHeaderResult {
  if (frontmatterRange(state.doc)) return { refused: 'exists' }
  const nl = state.lineBreak
  const header = template.replace(/\s+$/, '').split(/\r?\n/).join(nl)
  const first = state.doc.line(1).text
  const gap = state.doc.length === 0 ? '' : /^\s*$/.test(first) ? '' : nl
  const insert = header + nl + gap
  const title = header.search(/^title: ""/m)
  const anchor = title >= 0 ? title + 'title: "'.length : header.length + nl.length
  return {
    spec: {
      changes: { from: 0, insert },
      selection: { anchor },
      scrollIntoView: true,
      userEvent: 'input',
    },
  }
}
