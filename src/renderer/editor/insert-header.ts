import { isolateHistory } from '@codemirror/commands'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import {
  mergeHeader,
  setDate,
  type TemplateChoiceInput,
  type TextChange,
} from '../../core/header-merge'

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

/** Offset right after the line break of the closing fence in an inserted header. */
function afterFence(text: string): number {
  const lines = text.split('\n')
  let pos = (lines[0]?.length ?? 0) + 1
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    pos += line.length + 1
    if (/^(---|\.\.\.)\s*$/.test(line)) return Math.min(pos, text.length)
  }
  return text.length
}

export type InsertTemplateResult =
  | { kind: 'changed'; spec: TransactionSpec; inserted: boolean; added: string[] }
  | { kind: 'unchanged' }
  | { kind: 'unclosed' }

/**
 * Einfügen → „Vorlage …“: the set's header merged into the note by the pure rules of
 * src/core/header-merge.ts. The editor's doc joins lines with `\n` (a CRLF note gets its CRLF
 * back from serializeDoc, a mixed note keeps `\r` in its lines), which is exactly the text the
 * merge expects, so its changes apply as they are. The whole merge is one transaction and
 * isolated in the history: one undo step, never joined with typing right before or after it.
 * A header put on top places the cursor inside `title: ""` (as before with „YAML-Header …“);
 * a merge leaves the cursor where it was (mapped through the changes).
 */
export function insertTemplate(
  state: EditorState,
  header: string,
  choice: TemplateChoiceInput,
): InsertTemplateResult {
  const res = mergeHeader(state.doc.toString(), header, choice)
  if (res.kind === 'unclosed') return res
  if (res.changes.length === 0) return { kind: 'unchanged' }
  const inserted = res.kind === 'inserted'
  const spec: TransactionSpec = {
    changes: res.changes,
    userEvent: 'input',
    annotations: isolateHistory.of('full'),
    scrollIntoView: inserted,
  }
  if (inserted) {
    const text = (res.changes[0] as TextChange).insert
    const title = text.search(/^title: ""/m)
    // Inside the empty title, else on the line right after the header's closing fence.
    spec.selection = { anchor: title >= 0 ? title + 'title: "'.length : afterFence(text) }
  }
  return { kind: 'changed', spec, inserted, added: inserted ? [] : res.added }
}

/**
 * The date fix of the notice („In <heute> ändern“): every column-0 `date:` gets `iso`, comment
 * column kept. Its own undo step on purpose (isolated), so undo takes back only the date.
 * null when the note has no `date:` to change (any more).
 */
export function dateFixSpec(state: EditorState, iso: string): TransactionSpec | null {
  const changes = setDate(state.doc.toString(), iso)
  if (changes.length === 0) return null
  return { changes, userEvent: 'input', annotations: isolateHistory.of('full') }
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
