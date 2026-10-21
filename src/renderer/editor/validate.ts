import { isolateHistory } from '@codemirror/commands'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import {
  selectedChanges,
  type ValidationContext,
  validateFrontmatter,
} from '../../core/frontmatter-validate'
import type { TextChange } from '../../core/header-merge'

/**
 * The fixes of „YAML prüfen …“ as one transaction: one undo step, never joined with typing
 * right before or after it (like the template insert). The validator's changes refer to the
 * editor's doc as it is (lines joined with `\n`, a mixed note keeps `\r` inside its lines), so
 * they apply as they are; the cursor is mapped through them. null when there is nothing to do.
 */
export function validationSpec(
  state: EditorState,
  changes: readonly TextChange[],
): TransactionSpec | null {
  if (changes.length === 0) return null
  // Changes computed on another text would make dispatch throw a RangeError: refuse them.
  if (changes.some((c) => c.from > c.to || c.to > state.doc.length)) return null
  return {
    changes: [...changes],
    userEvent: 'input',
    annotations: isolateHistory.of('full'),
  }
}

/**
 * The user's choice applied to the note as it is now. The dialog showed findings of the text
 * at the time it opened; the note may have changed since (an external reload), so the current
 * text is validated again with the same context and only the chosen ids that still exist are
 * applied, with offsets of today's text (an id names code, line and key, so a shifted or
 * corrected finding no longer matches and is left alone).
 */
export function choiceSpec(
  state: EditorState,
  ctx: ValidationContext,
  choice: { ids: ReadonlySet<string>; addMissing: boolean },
): TransactionSpec | null {
  const result = validateFrontmatter(state.doc.toString(), ctx)
  return validationSpec(state, selectedChanges(result, choice.ids, choice.addMissing))
}
