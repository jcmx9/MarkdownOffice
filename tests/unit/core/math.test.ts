import { describe, expect, it } from 'vitest'
import {
  MATH_MAX_ITEMS,
  MATH_MAX_TEX,
  MATH_PROGRAM,
  MATH_REF_PT,
  MATH_REFUSED,
  pagesPerItem,
  svgSizePt,
  validateMathBatch,
} from '../../../src/core/math'

describe('validateMathBatch', () => {
  it('accepts a well-formed batch and returns plain copies', () => {
    const input = [
      { tex: 'x', display: false },
      { tex: '\\frac{1}{2}', display: true },
    ]
    expect(validateMathBatch(input)).toEqual(input)
  })

  it('accepts an empty batch and the limits themselves', () => {
    expect(validateMathBatch([])).toEqual([])
    const full = Array.from({ length: MATH_MAX_ITEMS }, () => ({ tex: 'x', display: false }))
    expect(validateMathBatch(full)).toHaveLength(MATH_MAX_ITEMS)
    expect(validateMathBatch([{ tex: 'a'.repeat(MATH_MAX_TEX), display: true }])).not.toBeNull()
  })

  it.each<[string, unknown]>([
    ['non-array', { tex: 'x', display: false }],
    ['null', null],
    ['string', 'x'],
    ['501 entries', Array.from({ length: 501 }, () => ({ tex: 'x', display: false }))],
    ['tex of 10 001 chars', [{ tex: 'a'.repeat(10_001), display: false }]],
    ['extra key', [{ tex: 'x', display: false, font: 'Evil' }]],
    ['non-boolean display', [{ tex: 'x', display: 'false' }]],
    ['missing display', [{ tex: 'x' }]],
    ['non-string tex', [{ tex: 1, display: false }]],
    ['entry is null', [null]],
    ['entry is an array', [['x', false]]],
  ])('rejects %s', (_name, input) => {
    expect(validateMathBatch(input)).toBeNull()
  })

  it('pins the limits from the spec', () => {
    expect(MATH_MAX_ITEMS).toBe(500)
    expect(MATH_MAX_TEX).toBe(10_000)
  })
})

describe('MATH_PROGRAM', () => {
  it('is a fixed program that reads the formulas from formulas.json', () => {
    expect(MATH_PROGRAM).toContain('json("formulas.json")')
    expect(MATH_PROGRAM).toContain('#import "mitex/mitex.typ": mitex-convert, mitex-scope')
    expect(MATH_PROGRAM).not.toMatch(/\{\{|\$\{|%s|<placeholder>/)
  })

  it("sets each formula as mitex's mimath does, with an explicit block flag per kind", () => {
    expect(MATH_PROGRAM).toContain('let res = mitex-convert(tex)')
    expect(MATH_PROGRAM).toContain(
      'math.equation(block: block, eval("$" + res + "$", scope: scope))',
    )
    expect(MATH_PROGRAM).toContain('formula(item.tex, true)')
    expect(MATH_PROGRAM).toContain('formula(item.tex, false)')
  })

  it('refuses unknown # emissions and takes the evaluating commands out of the scope', () => {
    expect(MATH_PROGRAM).toContain(`panic(${JSON.stringify(MATH_REFUSED)})`)
    expect(MATH_PROGRAM).toContain('.contains("#") { refuse() }')
    expect(MATH_PROGRAM).toContain(
      'mitex-scope + (hspace: refuse, vspace: refuse, raisebox: refuse)',
    )
    // \includegraphics's emissions stay out of the allowlist (a file read).
    expect(MATH_PROGRAM).not.toMatch(/image|miteximage/)
  })

  it('sets tight transparent pages at the reference size', () => {
    expect(MATH_PROGRAM).toContain('page(width: auto, height: auto, margin: 0pt, fill: none)')
    expect(MATH_PROGRAM).toContain(`text(size: ${MATH_REF_PT}pt)`)
    expect(MATH_PROGRAM).toContain('top-edge: "bounds", bottom-edge: "bounds"')
    expect(MATH_PROGRAM).toContain('top-edge: "bounds", bottom-edge: "baseline"')
  })
})

describe('pagesPerItem', () => {
  it('gives inline formulas two pages (bounds + baseline) and display ones one', () => {
    expect(pagesPerItem({ tex: 'x', display: false })).toBe(2)
    expect(pagesPerItem({ tex: 'x', display: true })).toBe(1)
  })
})

describe('svgSizePt', () => {
  it('reads the root width and height in pt', () => {
    expect(
      svgSizePt('<svg viewBox="0 0 12.5 8" width="12.5pt" height="8pt" xmlns="x"></svg>'),
    ).toEqual({ width: 12.5, height: 8 })
  })

  it('reads Typst output as written (attribute order, long fractions)', () => {
    expect(svgSizePt('<svg width="24.099666667pt" height="25.545pt"><g/></svg>')).toEqual({
      width: 24.099666667,
      height: 25.545,
    })
  })

  it('ignores width/height of inner elements', () => {
    expect(
      svgSizePt('<svg height="3pt" width="4pt"><rect width="99pt" height="99pt"/></svg>'),
    ).toEqual({ width: 4, height: 3 })
  })

  it.each([
    ['empty', ''],
    ['no svg root', '<g width="1pt" height="2pt"/>'],
    ['missing height', '<svg width="1pt"></svg>'],
    ['other unit', '<svg width="10px" height="8px"></svg>'],
    ['not a number', '<svg width="apt" height="8pt"></svg>'],
    ['negative', '<svg width="-1pt" height="8pt"></svg>'],
    ['only an inner size', '<svg><rect width="1pt" height="2pt"/></svg>'],
  ])('returns null for %s', (_name, svg) => {
    expect(svgSizePt(svg)).toBeNull()
  })
})
