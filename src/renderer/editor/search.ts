import { findNext, findPrevious, getSearchQuery, openSearchPanel, search } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * German labels of CodeMirror's search panel (and its screen-reader messages); the app's UI
 * is German. Keys are the phrases @codemirror/search asks for.
 */
const PHRASES: Record<string, string> = {
  Find: 'Suchen',
  Replace: 'Ersetzen',
  next: 'Weiter',
  previous: 'Zurück',
  all: 'Alle',
  'match case': 'Groß/klein',
  regexp: 'Regulärer Ausdruck',
  'by word': 'Ganzes Wort',
  replace: 'Ersetzen',
  'replace all': 'Alle ersetzen',
  close: 'Schließen',
  'current match': 'aktueller Treffer',
  'replaced $ matches': '$ Treffer ersetzt',
  'replaced match on line $': 'Treffer in Zeile $ ersetzt',
  'on line': 'in Zeile',
}

/**
 * Find and replace (Bearbeiten → Suchen …/Ersetzen …): CodeMirror's search panel on top of
 * the note, in every tab kind and view. The menu owns the keys (Mod+F, Cmd+Alt+F / Ctrl+H,
 * Mod+G, Mod+Shift+G); the panel's fields handle Enter, Shift+Enter and Esc themselves.
 * Deliberately without CodeMirror's searchKeymap: it also binds Mod+D, Mod+Shift+L and
 * Mod+Alt+G, keys the editor does not have (format.test.ts guards the keymap).
 */
export const searchExtensions: Extension = [search({ top: true }), EditorState.phrases.of(PHRASES)]

/** Opens the panel with the find field focused (selected text becomes the query). */
export function openFind(view: EditorView): boolean {
  return openSearchPanel(view)
}

/** Opens the panel with the replace field focused; the find field keeps its query. */
export function openReplace(view: EditorView): boolean {
  openSearchPanel(view)
  const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')
  if (!field) return false
  field.focus()
  field.select()
  return true
}

/** Next/previous match; without a query yet the panel opens instead (as in browsers). */
export function findAgain(view: EditorView, back: boolean): boolean {
  if (!getSearchQuery(view.state).valid) return openSearchPanel(view)
  return back ? findPrevious(view) : findNext(view)
}
