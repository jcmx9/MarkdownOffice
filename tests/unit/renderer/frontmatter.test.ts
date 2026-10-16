// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  Frontmatter,
  frontmatterFields,
  frontmatterRange,
} from '../../../src/renderer/editor/frontmatter'

const doc = (s: string) => Text.of(s.split('\n'))

function topNodes(text: string): string[] {
  const state = EditorState.create({
    doc: text,
    extensions: markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const names: string[] = []
  const c = syntaxTree(state).topNode.firstChild
  for (let n = c; n; n = n.nextSibling) names.push(n.name)
  return names
}

describe('frontmatterRange', () => {
  it('finds a closed header', () => {
    const t = '---\ntitle: "X"\n---\n\n# Body'
    expect(frontmatterRange(doc(t))).toEqual({ from: 0, to: t.indexOf('\n\n') })
  })
  it('accepts ... as closing delimiter and trailing spaces', () => {
    expect(frontmatterRange(doc('---  \na: 1\n...\nrest'))).toEqual({ from: 0, to: 14 })
  })
  it.each(['title: x\n---', '\n---\na: 1\n---', '---\na: 1', '--- \n', '# x'])(
    'is null for %j',
    (t) => {
      expect(frontmatterRange(doc(t))).toBeNull()
    },
  )
})

describe('frontmatterFields', () => {
  it('cleans values like the pipeline', () => {
    const t = [
      '---',
      'title: "Kickoff Firma X"   # Titel',
      "subtitle: 'Protokoll'",
      'client: Muster GmbH  # Kunde',
      'author: [Anna, "Ben"]',
      'date: 2026-10-14',
      'leer:',
      '---',
    ].join('\n')
    expect(frontmatterFields(doc(t))).toEqual({
      title: 'Kickoff Firma X',
      subtitle: 'Protokoll',
      client: 'Muster GmbH',
      author: 'Anna, Ben',
      date: '2026-10-14',
      leer: '',
    })
  })
  it('reads fields from CRLF lines', () => {
    const t = Text.of(['---\r', 'title: "X"\r', 'b: y\r', '---\r', 'rest'])
    expect(frontmatterFields(t)).toEqual({ title: 'X', b: 'y' })
  })
  it('handles comment-only and unclosed-quote values', () => {
    expect(frontmatterFields(doc('---\nk: # nur Kommentar\nq: "abc\n---'))).toEqual({
      k: '',
      q: 'abc',
    })
  })
  it('is empty without front matter', () => {
    expect(frontmatterFields(doc('# kein header'))).toEqual({})
  })
})

describe('Frontmatter parser', () => {
  it('parses the header as one block, never as a setext heading', () => {
    expect(topNodes('---\ntitle: x\n---\n\n# Body\n')).toEqual(['Frontmatter', 'ATXHeading1'])
  })
  it('does not treat a later --- block as front matter', () => {
    expect(topNodes('Text\n\n---\na: 1\n---\n')).not.toContain('Frontmatter')
  })
  it('consumes an unclosed header as Frontmatter while frontmatterRange is null', () => {
    const t = '---\ntitle: x\n'
    expect(topNodes(t)).toEqual(['Frontmatter'])
    expect(frontmatterRange(doc(t))).toBeNull()
  })
  it('closes on ...', () => {
    expect(topNodes('---\na: 1\n...\n\n# H\n')).toEqual(['Frontmatter', 'ATXHeading1'])
  })
  it('agrees with frontmatterRange on the node range', () => {
    const t = '---\ntitle: x\n---\n\n# Body'
    const state = EditorState.create({
      doc: t,
      extensions: markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
    })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const node = syntaxTree(state).topNode.firstChild
    expect({ from: node?.from, to: node?.to }).toEqual(frontmatterRange(doc(t)))
  })
})
