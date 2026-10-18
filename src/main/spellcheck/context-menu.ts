import type { MenuItemConstructorOptions } from 'electron'

/** The fields of Electron's context-menu params the spell menu reads. */
export interface SpellParams {
  isEditable: boolean
  misspelledWord: string
  dictionarySuggestions: string[]
  x: number
  y: number
}

export interface SpellMenuHandlers {
  /** The renderer replaces exactly this word at (x, y) as an undoable edit. */
  replace(word: string, replacement: string, x: number, y: number): void
  addWord(word: string): void
}

const MAX_SUGGESTIONS = 5

/** Context menu of the editor: suggestions for a misspelled word, then the usual edit items. */
export function spellMenuTemplate(
  p: SpellParams,
  h: SpellMenuHandlers,
): MenuItemConstructorOptions[] {
  if (!p.isEditable) return [{ role: 'copy', label: 'Kopieren' }]
  const edit: MenuItemConstructorOptions[] = [
    { role: 'cut', label: 'Ausschneiden' },
    { role: 'copy', label: 'Kopieren' },
    { role: 'paste', label: 'Einfügen' },
  ]
  if (!p.misspelledWord) return edit
  const suggestions: MenuItemConstructorOptions[] = p.dictionarySuggestions.length
    ? p.dictionarySuggestions.slice(0, MAX_SUGGESTIONS).map((s) => ({
        label: s,
        click: () => h.replace(p.misspelledWord, s, p.x, p.y),
      }))
    : [{ label: 'Keine Vorschläge', enabled: false }]
  return [
    ...suggestions,
    { type: 'separator' },
    { label: 'Zum Wörterbuch hinzufügen', click: () => h.addWord(p.misspelledWord) },
    { type: 'separator' },
    ...edit,
  ]
}
