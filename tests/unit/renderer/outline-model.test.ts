// @vitest-environment happy-dom
import { foldEffect } from '@codemirror/language'
import { describe, expect, it } from 'vitest'
import { activeEntry, outlineEntries } from '../../../src/renderer/editor/outline'
import { createState } from '../../../src/renderer/editor/setup'

const st = (text: string) => createState(text, '\n', 'preview')
const flat = (text: string) =>
  outlineEntries(st(text)).map((e) => [e.level, e.text, e.children.map((c) => c.text)])

describe('outlineEntries', () => {
  it('lists H1 with nested H2, ignores H3', () => {
    expect(flat('# A\n## a1\n### x\n## a2\n# B\ntext\n')).toEqual([
      [1, 'A', ['a1', 'a2']],
      [1, 'B', []],
    ])
  })
  it('Setext headings count; closing hashes and spaces are stripped', () => {
    expect(flat('Titel\n=====\n\nSub\n---\n\n#  C  ##\n')).toEqual([
      [1, 'Titel', ['Sub']],
      [1, 'C', []],
    ])
  })
  it('skips the YAML front matter and fenced code', () => {
    expect(flat('---\ntitle: x\n---\n\n```\n# not\n```\n# Real\n')).toEqual([[1, 'Real', []]])
  })
  it('H2 before the first H1 is top-level', () => {
    expect(flat('## Vorab\n# A\n')).toEqual([
      [2, 'Vorab', []],
      [1, 'A', []],
    ])
  })
  it('Setext heading has a fold range', () => {
    const [a] = outlineEntries(st('Titel\n=====\ntext\n'))
    expect(a?.fold).not.toBeNull()
    expect(a?.from).toBe(0)
  })
  it('only top-level headings count; quotes, lists and #hashtags do not', () => {
    expect(flat('> # Q\n\n- # L\n\n#hashtag\n\n# Real\n')).toEqual([[1, 'Real', []]])
  })
  it('multi-line Setext heading shows its full text on one line', () => {
    expect(flat('line one\nline two\n===\n')).toEqual([[1, 'line one line two', []]])
  })
  it('a folded H1 keeps its children with their own fold state', () => {
    let state = st('# A\nx\n## a1\ny\n## a2\n')
    const [a] = outlineEntries(state)
    state = state.update({
      effects: [foldEffect.of(a?.fold as { from: number; to: number })],
    }).state
    const [folded] = outlineEntries(state)
    expect(folded?.folded).toBe(true)
    expect(folded?.children.map((c) => [c.text, c.folded, c.fold !== null])).toEqual([
      ['a1', false, true],
      ['a2', false, false],
    ])
  })
  it('empty heading text', () => {
    expect(flat('#\n')).toEqual([[1, '(ohne Titel)', []]])
  })
  it('fold range null for an empty section; folded flag follows the editor', () => {
    let state = st('# A\ntext\n# B\n')
    const [a, b] = outlineEntries(state)
    expect(a?.fold).not.toBeNull()
    expect(b?.fold).toBeNull()
    state = state.update({ effects: foldEffect.of(a?.fold as { from: number; to: number }) }).state
    expect(outlineEntries(state)[0]?.folded).toBe(true)
  })
})

describe('outlineEntries folded state follows CodeMirror after the section changes', () => {
  const foldA = (text: string) => {
    const state = st(text)
    const [a] = outlineEntries(state)
    return state.update({ effects: foldEffect.of(a?.fold as { from: number; to: number }) }).state
  }
  it('stays folded when text is typed right below the folded section', () => {
    const doc = '# A\ntext\n\n# B\nb\n'
    const state = foldA(doc)
    const next = state.update({ changes: { from: doc.indexOf('\n# B'), insert: 'more' } }).state
    expect(outlineEntries(next)[0]?.folded).toBe(true)
  })
  it('stays folded when the next heading is deleted', () => {
    const doc = '# A\ntext\n# B\nb\n'
    const state = foldA(doc)
    const at = doc.indexOf('# B')
    const next = state.update({ changes: { from: at, to: at + 4 } }).state
    expect(outlineEntries(next)[0]?.folded).toBe(true)
  })
  it('stays folded when a block is pasted below the fold', () => {
    const doc = '# A\ntext\n\n# B\n'
    const state = foldA(doc)
    const next = state.update({
      changes: { from: doc.indexOf('\n# B'), insert: 'p1\np2\n' },
    }).state
    expect(outlineEntries(next)[0]?.folded).toBe(true)
  })
  it('a folded H1 does not mark its children as folded', () => {
    const [a] = outlineEntries(foldA('# A\nx\n## a1\ny\n'))
    expect(a?.children[0]?.folded).toBe(false)
  })
})

describe('activeEntry', () => {
  it('is the last entry starting at or before pos, children included', () => {
    const entries = outlineEntries(st('# A\nx\n## a1\ny\n# B\n'))
    expect(activeEntry(entries, 0)?.text).toBe('A')
    expect(activeEntry(entries, 12)?.text).toBe('a1')
    expect(activeEntry(entries, 100)?.text).toBe('B')
  })
  it('null before the first heading', () => {
    expect(activeEntry(outlineEntries(st('intro\n# A\n')), 0)).toBeNull()
  })
})

describe('outlineEntries depth (settings: Ebenen in der Gliederung)', () => {
  const doc = '# A\n## a1\n### a1x\n#### a1x4\n## a2\n# B\n### b3\n'
  const tree = (text: string, depth: number) => {
    const walk = (list: ReturnType<typeof outlineEntries>): unknown[] =>
      list.map((e) => (e.children.length ? [e.text, walk(e.children)] : e.text))
    return walk(outlineEntries(st(text), depth))
  }
  it('default 2: H1 and H2, deeper headings left out', () => {
    expect(tree(doc, 2)).toEqual([['A', ['a1', 'a2']], 'B'])
    expect(outlineEntries(st(doc)).map((e) => e.text)).toEqual(['A', 'B'])
    expect(outlineEntries(st(doc))[0]?.children.map((c) => c.text)).toEqual(['a1', 'a2'])
  })
  it('1: only H1', () => {
    expect(tree(doc, 1)).toEqual(['A', 'B'])
  })
  it('3 and 4 nest each level under the nearest higher one; a skipped level nests directly', () => {
    expect(tree(doc, 3)).toEqual([
      ['A', [['a1', ['a1x']], 'a2']],
      ['B', ['b3']],
    ])
    expect(tree(doc, 4)).toEqual([
      ['A', [['a1', [['a1x', ['a1x4']]]], 'a2']],
      ['B', ['b3']],
    ])
  })
  it('counts from the highest level present: a note starting at H2 with 2 shows H2 and H3', () => {
    expect(tree('## A\n### a\n#### x\n## B\n', 2)).toEqual([['A', ['a']], 'B'])
  })
  it('out-of-range depths are clamped to 1–6', () => {
    expect(tree(doc, 0)).toEqual(['A', 'B'])
    expect(tree(doc, 9)).toEqual(tree(doc, 6))
  })
  it('activeEntry finds the deepest listed entry at or before pos', () => {
    const state = st(doc)
    const entries = outlineEntries(state, 3)
    const pos = doc.indexOf('#### a1x4')
    expect(activeEntry(entries, pos)?.text).toBe('a1x')
    expect(activeEntry(entries, doc.indexOf('## a2'))?.text).toBe('a2')
  })
})
