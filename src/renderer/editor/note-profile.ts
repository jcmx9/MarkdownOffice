import type { EditorState, TransactionSpec } from '@codemirror/state'
import { SET_NAME_RE, withProfile } from '../../core/sets'
import { frontmatterRange } from './frontmatter'

/**
 * The change that sets `profile: <name>` in the note's front matter (one transaction = one undo
 * step), or null when there is nothing to change (no front matter, invalid name, same value).
 * An existing column-0 `profile:` line is rewritten in place by `withProfile`, so its comment
 * keeps its column; without one a line is added right after `template:` (else before the
 * closing fence). Only that one line changes, so the cursor and the rest of the note stay put.
 */
export function setNoteProfile(state: EditorState, name: string): TransactionSpec | null {
  if (!SET_NAME_RE.test(name)) return null
  const range = frontmatterRange(state.doc)
  if (!range) return null
  const first = state.doc.lineAt(range.from).number + 1
  const close = state.doc.lineAt(range.to).number
  let template: number | null = null
  for (let n = first; n < close; n++) {
    const line = state.doc.line(n)
    if (/^profile:/.test(line.text)) {
      // A single line has no fence, so withProfile treats it as the whole header. In a note with
      // mixed line endings the line text keeps its `\r`, which withProfile keeps too.
      const next = withProfile(line.text, name)
      return next === line.text ? null : { changes: { from: line.from, to: line.to, insert: next } }
    }
    if (template === null && /^template:/.test(line.text)) template = n
  }
  // New line in the note's own style: only a mixed-EOL note keeps `\r` in the line text (a
  // CRLF note is split into plain lines and written back with CRLF by serializeDoc).
  if (template !== null) {
    const line = state.doc.line(template)
    const cr = line.text.endsWith('\r') ? '\r' : ''
    return { changes: { from: line.to, insert: `${state.lineBreak}profile: ${name}${cr}` } }
  }
  const fence = state.doc.line(close)
  const cr = fence.text.endsWith('\r') ? '\r' : ''
  return { changes: { from: fence.from, insert: `profile: ${name}${cr}${state.lineBreak}` } }
}
