import { describe, expect, it } from 'vitest'
import {
  applySubstitutions,
  skipMask,
  smartTypography,
  smartTypographyLines,
} from '../../../src/core/typography'

const de = (line: string) => applySubstitutions(line, smartTypography(line, 'de'))
const en = (line: string) => applySubstitutions(line, smartTypography(line, 'en'))

describe('smartTypography quotes (markdown.typ smart-quotes)', () => {
  it('sets German quotes for de*', () => {
    expect(de('Er sagte "Hallo" und \'tschüss\'.')).toBe('Er sagte „Hallo“ und ‚tschüss‘.')
    expect(applySubstitutions('"x"', smartTypography('"x"', 'de-AT'))).toBe('„x“')
  })
  it('sets English quotes otherwise', () => {
    expect(en('He said "hi" and \'bye\'.')).toBe('He said “hi” and ‘bye’.')
  })
  it('opens after (, –, / and at the start, closes after letters', () => {
    expect(de('("a") –"b" /"c" "d"')).toBe('(„a“) –„b“ /„c“ „d“')
    expect(de('a -- "b"')).toBe('a – „b“')
  })
  it('turns the apostrophe between letters into ’', () => {
    expect(de("geht's")).toBe('geht’s')
    expect(en("it's the 90's")).toBe('it’s the 90’s')
  })
  it('leaves the second of two quotes in a row alone, as the regex does', () => {
    expect(de('a""')).toBe('a“"')
  })
})

describe('smartTypography dashes and ellipsis', () => {
  it('replaces ---, -- and ...', () => {
    expect(de('a --- b -- c...')).toBe('a — b – c…')
    expect(de('-----x')).toBe('—–x')
  })
  it('reports one substitution over the source characters', () => {
    expect(smartTypography('a -- b', 'de')).toEqual([{ from: 2, to: 4, text: '–' }])
    expect(smartTypography('x...', 'de')).toEqual([{ from: 1, to: 4, text: '…' }])
  })
})

describe('smartTypography leaves code, formulas and HTML alone', () => {
  it('skips inline code', () => {
    expect(de('a "b" `"c" -- d` "e"')).toBe('a „b“ `"c" -- d` „e“')
  })
  it('skips $…$ formulas', () => {
    expect(de('"a" $x -- "y"$ "b"')).toBe('„a“ $x -- "y"$ „b“')
  })
  it('skips HTML lines, HTML inside a line and rule lines', () => {
    expect(smartTypography('<div class="x">', 'de')).toEqual([])
    expect(smartTypography('a <span>"b"</span>', 'de')).toEqual([])
    expect(smartTypography('a <!-- "b" -->', 'de')).toEqual([])
    expect(smartTypography('---', 'de')).toEqual([])
    expect(smartTypography('| -- | -- |', 'de')).toEqual([])
  })
  it('starts a piece after a backtick as a line start', () => {
    expect(de('`x`"a"')).toBe('`x`„a“')
  })
  it('keeps surrogate pairs intact', () => {
    expect(de('😀"a" -- b')).toBe('😀“a“ – b')
  })
})

describe('smartTypographyLines (skip-mask)', () => {
  it('skips fences, $$ blocks and multi-line HTML comments', () => {
    const lines = ['```', '"a"', '```', '$$', 'x -- y', '$$', '<!--', '"c" -->', '"d"']
    const out = smartTypographyLines(lines, 'de').map((s, i) =>
      applySubstitutions(lines[i] ?? '', s),
    )
    expect(out).toEqual(['```', '"a"', '```', '$$', 'x -- y', '$$', '<!--', '"c" -->', '„d“'])
  })
  it('masks a one-line $$ block only on its own line', () => {
    expect(skipMask(['$$ x $$', 'a'])).toEqual([true, false])
  })
  it('masks indented code after a blank line, not list continuations or lazy lines', () => {
    expect(skipMask(['a', '', '    code', '\tcode', '', '    code', 'b'])).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      false,
    ])
    // In a list the indentation continues the item; a blank line and plain text close it.
    expect(skipMask(['- x', '', '    para', '', 'text', '', '    code'])).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ])
    // A heading closes the list too; a paragraph line is continued lazily, never code.
    expect(skipMask(['1. x', '# H', '', '    code', 'p', '    lazy'])).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
    ])
  })
})
