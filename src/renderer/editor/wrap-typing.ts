import { type Extension, StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { type WrapMarker, wrapSelection } from './format'

/**
 * Typing a marker over selected text wraps it instead of replacing it (owner request
 * 2026-10-27). Only with a selection: without one every key types as usual, so writing Markdown
 * never gets rewritten behind the writer's back (the project's „no typing automatisms“ rule).
 *
 * - `*` wraps at once: pressed one, two or three times it gives `*Text*`, `**Text**`,
 *   `***Text***` (the selection stays on the text between presses).
 * - `~` and `=` act as in Markdown, where only the pair means something (`~~`, `==`): the first
 *   press waits, the second one right after it wraps. Any other key after the first press types
 *   both characters over the selection, as without this extension; a click or arrow key forgets
 *   the waiting press.
 */

const PAIRED = new Set(['~', '='])

/** The `~` or `=` that waits for its second press, or null. */
const setPending = StateEffect.define<string | null>()

const pendingField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPending)) return e.value
    // Any other change of text or selection ends the wait.
    return tr.docChanged || tr.selection ? null : value
  },
})

/** Whether `text` typed over `from…to` is typed over the whole main selection. */
function overSelection(view: EditorView, from: number, to: number): boolean {
  const main = view.state.selection.main
  return !main.empty && main.from === from && main.to === to
}

const handler = EditorView.inputHandler.of((view, from, to, text) => {
  if (!overSelection(view, from, to)) return false
  const pending = view.state.field(pendingField, false) ?? null
  if (pending) {
    // The second press wraps; anything else (or a pair that cannot wrap here) types both keys.
    const spec =
      text === pending ? wrapSelection(view.state, `${pending}${pending}` as WrapMarker) : null
    view.dispatch(spec ?? view.state.replaceSelection(pending + text))
    return true
  }
  if (text === '*' || text === '~~' || text === '==') {
    // A dead-key layout may deliver `~~` in one input: wrap at once.
    const spec = wrapSelection(view.state, text)
    if (!spec) return false
    view.dispatch(spec)
    return true
  }
  // Wait only where the pair could wrap; elsewhere the key replaces the selection as usual.
  if (PAIRED.has(text) && wrapSelection(view.state, `${text}${text}` as WrapMarker)) {
    view.dispatch({ effects: setPending.of(text) })
    return true
  }
  return false
})

/** The wrap-on-type extension for Markdown tabs (setup.ts). */
export const wrapTyping: Extension = [pendingField, handler]
