import { EditorState, type Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { skipMask } from '../../../src/core/typography'
import { frontmatterFields } from '../../../src/renderer/editor/frontmatter'
import { typoMask, typoMaskWork } from '../../../src/renderer/editor/typo-mask'

/** The mask built from scratch, as markdown.typ does it: front matter stripped first. */
function fresh(doc: Text): boolean[] {
  const lines: string[] = []
  for (const l of doc.iterLines()) lines.push(l)
  let start = 0
  if (/^---\s*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l))
    if (end > 0) start = end + 1
  }
  return [...lines.slice(0, start).map(() => true), ...skipMask(lines.slice(start))]
}

const make = (doc: string) => EditorState.create({ doc, extensions: typoMask })
const mask = (s: EditorState) => s.field(typoMask).mask

describe('typoMask (incremental skip-mask)', () => {
  it('rescans only near an edit below a long prefix', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `Absatz "${i}" -- text`)
    let s = make(lines.join('\n'))
    const before = typoMaskWork.lines
    const pos = s.doc.line(1990).from
    s = s.update({ changes: { from: pos, insert: 'x' } }).state
    expect(typoMaskWork.lines - before).toBeLessThan(5)
    expect(mask(s)).toEqual(fresh(s.doc))
  })
  it('an opened fence above masks the lines below, closing it unmasks them', () => {
    let s = make(['a', '"b"', '"c"', '"d"'].join('\n'))
    s = s.update({ changes: { from: 2, insert: '```\n' } }).state
    expect(mask(s)).toEqual([false, true, true, true, true])
    s = s.update({ changes: { from: s.doc.length, insert: '\n```\n"e"' } }).state
    expect(mask(s)).toEqual([false, true, true, true, true, true, false])
    expect(mask(s)).toEqual(fresh(s.doc))
  })
  it('follows the front matter and its lang', () => {
    let s = make('---\nlang: de\n---\n"a"')
    expect(s.field(typoMask)).toMatchObject({ start: 3, lang: 'de' })
    s = s.update({ changes: { from: 10, to: 12, insert: 'en' } }).state
    expect(s.field(typoMask)).toMatchObject({ start: 3, lang: 'en' })
    // Breaking the closing line turns the block into body text.
    s = s.update({ changes: { from: 14, to: 15, insert: 'x' } }).state
    expect(s.field(typoMask)).toMatchObject({ start: 0, lang: 'de' })
    expect(mask(s)).toEqual(fresh(s.doc))
    // A `---` below the unclosed block closes it again.
    s = s.update({ changes: { from: s.doc.length, insert: '\n---' } }).state
    expect(s.field(typoMask).start).toBe(5)
    expect(mask(s)).toEqual(fresh(s.doc))
  })
  it('matches a fresh scan after random edits', () => {
    const pieces = ['```', '~~~', '$$', '<!--', '-->', '"q"', 'text', '$$ x $$', '---', '', '\n']
    let seed = 7
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    let s = make('---\nlang: en\n---\n```\n"a"\n```\n$$\nb\n$$\n"c"')
    for (let i = 0; i < 400; i++) {
      const from = rnd(s.doc.length + 1)
      const to = Math.min(s.doc.length, from + rnd(6))
      const insert = `${pieces[rnd(pieces.length)]}${rnd(2) ? '\n' : ''}`
      s = s.update({ changes: { from, to, insert } }).state
      expect(mask(s)).toEqual(fresh(s.doc))
      expect(s.field(typoMask).carry.length).toBe(s.doc.lines + 1)
      expect(s.field(typoMask).lang).toBe(frontmatterFields(s.doc).lang || 'de')
    }
  })
})
