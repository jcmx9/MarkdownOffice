import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { highlightTree } from '@lezer/highlight'
import { describe, expect, it } from 'vitest'
import { mdoHighlightStyle } from '../../../src/renderer/editor/highlight'
import { mdoMarkdown } from '../../../src/renderer/editor/markdown'
import { mermaid } from '../../../src/renderer/editor/mermaid'

/** Highlighted pieces as `text → classes`, in document order. */
function tokens(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: mdoMarkdown([mermaid]) })
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)
  if (!tree) throw new Error('no tree')
  const out: string[] = []
  highlightTree(tree, mdoHighlightStyle, (from, to, cls) => {
    out.push(`${doc.slice(from, to)} → ${cls}`)
  })
  return out
}

const has = (doc: string, piece: string, cls: string) =>
  expect(tokens(doc).filter((t) => t.startsWith(`${piece} → `) && t.includes(cls))).not.toEqual([])

describe('YAML front matter', () => {
  const doc = '---\ntitle: "Notiz" # Titel\ntoc: auto\n---\n\nText\n'
  it('keys, quoted values and comments get their own classes', () => {
    has(doc, 'title', 'mdo-tok-function')
    has(doc, 'toc', 'mdo-tok-function')
    has(doc, '"Notiz"', 'mdo-tok-string')
    has(doc, '# Titel', 'mdo-tok-comment')
  })
  it('the --- lines stay marks', () => {
    expect(tokens(doc)[0]).toBe('--- → mdo-tok-mark')
  })
  it('body text after the header is not YAML', () => {
    expect(tokens(doc).some((t) => t.startsWith('Text'))).toBe(false)
  })
})

describe('Mermaid code blocks', () => {
  const doc = [
    '```mermaid',
    'flowchart LR',
    '  A["Start"] -->|ja| B[Ende]',
    '  %% Notiz',
    '```',
    '',
  ].join('\n')
  it('diagram type and direction are keywords', () => {
    has(doc, 'flowchart', 'mdo-tok-keyword')
    has(doc, 'LR', 'mdo-tok-keyword')
  })
  it('arrows, labels and comments are coloured', () => {
    has(doc, '-->', 'mdo-tok-function')
    has(doc, '|ja|', 'mdo-tok-string')
    has(doc, '["Start"]', 'mdo-tok-string')
    has(doc, '[Ende]', 'mdo-tok-string')
    has(doc, '%% Notiz', 'mdo-tok-comment')
  })
  it('the alias mmd works too', () => {
    has('```mmd\nsequenceDiagram\n```\n', 'sequenceDiagram', 'mdo-tok-keyword')
  })
})
