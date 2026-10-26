import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { linkAt } from '../../../src/renderer/editor/link-at'
import { mdoMarkdown } from '../../../src/renderer/editor/markdown'
import { linkModifier } from '../../../src/renderer/ui/link-open'

const state = (doc: string) => {
  const s = EditorState.create({ doc, extensions: mdoMarkdown() })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}
/** linkAt at the first occurrence of `at` (plus `offset`). */
const at = (doc: string, needle: string, offset = 1) => {
  const s = state(doc)
  return linkAt(s, doc.indexOf(needle) + offset)
}

describe('linkAt', () => {
  it('inline link: on its text, brackets and destination', () => {
    const doc = 'Siehe [die Seite](https://example.org/a?b=1) hier.'
    expect(at(doc, 'die Seite')).toBe('https://example.org/a?b=1')
    expect(at(doc, '[die', 0)).toBe('https://example.org/a?b=1')
    expect(at(doc, 'example')).toBe('https://example.org/a?b=1')
    expect(at(doc, 'Siehe')).toBeNull()
    expect(at(doc, 'hier')).toBeNull()
  })

  it('reference links (full, collapsed, shortcut) take the definition, case-insensitive', () => {
    const doc = '[A][Ref], [ref][] und [Ref].\n\n[REF]: https://example.org/r\n'
    expect(at(doc, 'A]')).toBe('https://example.org/r')
    expect(at(doc, 'ref][]')).toBe('https://example.org/r')
    expect(at(doc, 'Ref].')).toBe('https://example.org/r')
    expect(at('[x][nirgends]\n', 'x')).toBeNull()
  })

  it('autolinks, bare URLs and mailto', () => {
    expect(at('Mail: <mailto:a@b.de>', 'mailto')).toBe('mailto:a@b.de')
    expect(at('Web: <https://example.org>', 'example')).toBe('https://example.org')
    expect(at('Web: https://example.org/x weiter', 'example')).toBe('https://example.org/x')
  })

  it('never opens files, scripts, anchors or images', () => {
    expect(at('[a](datei.md)', 'a]')).toBeNull()
    expect(at('[a](file:///etc/passwd)', 'a]')).toBeNull()
    expect(at('[a](javascript:alert(1))', 'a]')).toBeNull()
    expect(at('[a](#kapitel)', 'a]')).toBeNull()
    expect(at('![Bild](https://example.org/b.png)', 'Bild')).toBeNull()
  })

  it('code is no link', () => {
    expect(at('`[a](https://example.org)`', 'a]')).toBeNull()
  })
})

describe('linkModifier', () => {
  it('Cmd on macOS, Ctrl elsewhere', () => {
    const e = (meta: boolean, ctrl: boolean) => ({ metaKey: meta, ctrlKey: ctrl }) as MouseEvent
    expect(linkModifier(e(true, false), true)).toBe(true)
    expect(linkModifier(e(false, true), true)).toBe(false)
    expect(linkModifier(e(false, true), false)).toBe(true)
    expect(linkModifier(e(true, false), false)).toBe(false)
  })
})
