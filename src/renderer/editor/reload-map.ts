import { ChangeSet, type EditorState } from '@codemirror/state'

/**
 * The change from `before` to `after` as one replaced middle: the common start and end stay.
 * An outside edit (another editor, another window) usually touches one place, so a cursor or
 * scroll position before or after it keeps its exact spot when mapped through this change.
 */
export function textChange(before: string, after: string): ChangeSet {
  const max = Math.min(before.length, after.length)
  let start = 0
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let end = 0
  while (
    end < max - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  )
    end++
  return ChangeSet.of(
    { from: start, to: before.length - end, insert: after.slice(start, after.length - end) },
    before.length,
  )
}

/**
 * A reloaded note keeps the place it was read at (owner, 2026-10-29): the old selection mapped
 * into the new text, so the outline's active entry and focus mode's section stay put instead of
 * jumping to the first heading.
 */
export function carrySelection(old: EditorState, fresh: EditorState): EditorState {
  const changes = textChange(old.doc.toString(), fresh.doc.toString())
  return fresh.update({ selection: old.selection.map(changes) }).state
}
