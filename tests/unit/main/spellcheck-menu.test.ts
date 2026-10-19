import { describe, expect, it, vi } from 'vitest'
import { spellMenuTemplate } from '../../../src/main/spellcheck/context-menu'

const base = {
  isEditable: true,
  misspelledWord: '',
  dictionarySuggestions: [] as string[],
  x: 10,
  y: 20,
}
const h = () => ({ replace: vi.fn(), addWord: vi.fn() })

describe('spellMenuTemplate', () => {
  it('suggestions (max 5), add to dictionary, then the edit roles', () => {
    const handlers = h()
    const t = spellMenuTemplate(
      {
        ...base,
        misspelledWord: 'Fehlr',
        dictionarySuggestions: ['Fehler', 'Fehl', 'a', 'b', 'c', 'd'],
      },
      handlers,
    )
    expect(t.slice(0, 5).map((i) => i.label)).toEqual(['Fehler', 'Fehl', 'a', 'b', 'c'])
    expect(t[5]?.type).toBe('separator')
    expect(t[6]?.label).toBe('Zum Wörterbuch hinzufügen')
    expect(t.slice(-3).map((i) => i.role)).toEqual(['cut', 'copy', 'paste'])
    t[0]?.click?.({} as never, undefined, {} as never)
    expect(handlers.replace).toHaveBeenCalledWith('Fehlr', 'Fehler', 10, 20)
    t[6]?.click?.({} as never, undefined, {} as never)
    expect(handlers.addWord).toHaveBeenCalledWith('Fehlr')
  })
  it('misspelled without suggestions says so', () => {
    const t = spellMenuTemplate({ ...base, misspelledWord: 'Xyzq' }, h())
    expect(t[0]).toMatchObject({ label: 'Keine Vorschläge', enabled: false })
  })
  it('correct word or not editable: only the edit roles (never a stale suggestion)', () => {
    expect(spellMenuTemplate(base, h()).map((i) => i.role)).toEqual(['cut', 'copy', 'paste'])
    expect(
      spellMenuTemplate({ ...base, isEditable: false, misspelledWord: 'Fehlr' }, h()).map(
        (i) => i.role,
      ),
    ).toEqual(['copy'])
  })
})
