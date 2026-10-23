import { describe, expect, it } from 'vitest'
import type { BreakPoint } from '../../../../src/core/paragraph/breaks'
import {
  type ParagraphInput,
  rawCost,
  rawRatio,
  type SetLine,
  setParagraph,
} from '../../../../src/core/paragraph/linebreak'

// A fixed-advance "font": every char 10 px, a space 5 px, the hyphen 10 px, font size 20 px
// (so half an em, the unit of Typst's ratio > 1 formula, is 10 px). Expected layouts below are
// computed by hand with Typst 0.15.0's cost formulas; the report of task 3 lists the arithmetic.
const CHAR = 10
const SPACE = 5
const HYPHEN = 10
const FONT_SIZE = 20

interface Options {
  width?: number | ((line: number) => number)
  justify?: boolean
  runt?: number
  hyphenation?: number
}

/**
 * `src` with `~` at hyphenation points (removed from the text). Breaks after every space, like
 * UAX #14; a hyphen point carries its code points before/after within the run of letters.
 */
function para(src: string, o: Options = {}): ParagraphInput {
  let text = ''
  const breaks: BreakPoint[] = []
  for (const c of src) {
    if (c === '~') breaks.push({ index: text.length, kind: 'hyphen' })
    else text += c
  }
  for (const b of breaks) {
    let l = b.index
    while (l > 0 && /\p{L}/u.test(text[l - 1] as string)) l--
    let r = b.index
    while (r < text.length && /\p{L}/u.test(text[r] as string)) r++
    b.left = b.index - l
    b.right = r - b.index
  }
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === ' ') breaks.push({ index: i + 1, kind: 'normal' })
  }
  breaks.sort((a, b) => a.index - b.index)
  const x = new Float64Array(text.length + 1)
  for (let i = 0; i < text.length; i++) {
    x[i + 1] = (x[i] as number) + (text[i] === ' ' || text[i] === '\u00A0' ? SPACE : CHAR)
  }
  const width = o.width ?? 100
  return {
    text,
    x,
    breaks,
    lineWidth: typeof width === 'number' ? () => width : width,
    hyphenWidth: () => HYPHEN,
    justify: o.justify ?? false,
    costs: { hyphenation: o.hyphenation ?? 1, runt: o.runt ?? 1 },
    fontSize: () => FONT_SIZE,
  }
}

const spans = (lines: SetLine[]) => lines.map((l) => [l.from, l.to])

/** Natural width of a set line (trailing spaces trimmed, hyphen added) and its space count. */
function measure(p: ParagraphInput, l: SetLine): { width: number; spaces: number } {
  let end = l.to
  while (end > l.from && /\s/.test(p.text[end - 1] as string)) end--
  let spaces = 0
  for (let i = l.from; i < end; i++) if (/[ \u00A0]/.test(p.text[i] as string)) spaces++
  const width =
    (p.x[end] as number) - (p.x[l.from] as number) + (l.hyphen ? p.hyphenWidth(l.to) : 0)
  return { width, spaces }
}

describe('setParagraph', () => {
  it('simple fits greedily when not justified', () => {
    // 'aaaa bbb ccc' = 40+5+30+5+30 = 110 fits exactly; 'ddddd eeeeee' = 115 does not.
    const lines = setParagraph(para('aaaa bbb ccc ddddd eeeeee fff', { width: 110 }))
    expect(spans(lines)).toEqual([
      [0, 13],
      [13, 19],
      [19, 29],
    ])
    expect(lines.every((l) => l.spaceAdjust === 0 && !l.hyphen)).toBe(true)
  })

  it('optimized prefers even lines over greedy', () => {
    // Greedy: 'aaaa bbb ccc' (ratio 0, cost 1) + 'ddddd' (no space, ratio 7, cost 34301²)
    // = 1 176 558 603. Optimum: 'aaaa bbb' (ratio 4.25) + 'ccc ddddd' (ratio 3.25) + last
    // = 58 944 965.94 + 11 791 068.29 + 1 = 70 736 035.23.
    const lines = setParagraph(para('aaaa bbb ccc ddddd eeeeee fff', { width: 110, justify: true }))
    expect(spans(lines)).toEqual([
      [0, 9],
      [9, 19],
      [19, 29],
    ])
    expect(lines.map((l) => l.spaceAdjust)).toEqual([35, 25, 0])
  })

  it('last line is not justified (spaceAdjust 0)', () => {
    const lines = setParagraph(para('aaaa bbb ccc ddddd eeeeee fff', { width: 110, justify: true }))
    expect(lines.at(-1)).toEqual({ from: 19, to: 29, hyphen: false, spaceAdjust: 0 })
  })

  it('shrinks spaces down to 2/3 but not below', () => {
    // 'aa bb cc' = 70 in 67 px: shrink 3 px over 2 spaces of 5/3 each, ratio -0.9 (0.3 of a
    // space each) → 73.9² + runt 101² = 15 662.21 beats 'aa bb' / 'cc dd' (2568.24² + 1).
    const fits = setParagraph(para('aa bb cc dd', { width: 67, justify: true }))
    expect(spans(fits)).toEqual([
      [0, 9],
      [9, 11],
    ])
    expect(fits[0]?.spaceAdjust).toBeCloseTo(-1.5, 10)
    // A no-break space is no break opportunity but shrinks like a space (a justifiable): with
    // only one shrinkable space the first line would need ratio −1.8 and be overfull.
    const nbsp = setParagraph(para('aa\u00A0bb cc dd', { width: 67, justify: true }))
    expect(spans(nbsp)).toEqual(spans(fits))
    expect(nbsp[0]?.spaceAdjust).toBeCloseTo(-1.5, 10)
    // In 66 px the line would need ratio -1.2 (0.4 of a space): overfull, so it is not chosen.
    const tooTight = setParagraph(para('aa bb cc dd', { width: 66, justify: true }))
    expect(spans(tooTight)).toEqual([
      [0, 6],
      [6, 11],
    ])
  })

  it('runt cost avoids a one-word last line', () => {
    // 'a b ccc d e' = 90 fits exactly (cost 1); the runt 'fffff' costs (1 + 100·runt)².
    // Alternative 'a b ccc d' (ratio 1.25, 196.3125² = 38 538.60) + 'e fffff' (1).
    // runt 1: 1 + 10 201 = 10 202 < 38 539.60; runt 2: 1 + 40 401 = 40 402 > 38 539.60.
    const src = 'a b ccc d e fffff'
    expect(spans(setParagraph(para(src, { width: 90, justify: true, runt: 1 })))).toEqual([
      [0, 12],
      [12, 17],
    ])
    expect(spans(setParagraph(para(src, { width: 90, justify: true, runt: 2 })))).toEqual([
      [0, 10],
      [10, 17],
    ])
  })

  it('hyphen cost and consecutive hyphens', () => {
    // Line 1 'aaaaaaa bbbbb-' = 135 exactly, hyphen l5/r5: (1 + 135)² = 18 496.
    // Line 2 'bbbbb w x y z c-' = 135 exactly, hyphen l1/r6 (+60 %): 1.6·135 = 216, plus 135
    // for the second dash in a row: (1 + 216 + 135)² = 123 904 (without the extra: 47 089).
    // Line 2 'bbbbb w x y z' = 110, ratio 1 + (25 − 10)/4/10 = 1.375: 260.96² = 68 100.61.
    const lines = setParagraph(
      para('aaaaaaa bbbbb~bbbbb w x y z c~cccccc tt', { width: 135, justify: true }),
    )
    expect(spans(lines)).toEqual([
      [0, 13],
      [13, 27],
      [27, 37],
    ])
    expect(lines.map((l) => l.hyphen)).toEqual([true, false, false])
    expect(lines.map((l) => l.spaceAdjust)).toEqual([0, 6.25, 0])
  })

  it('overfull word yields one overfull line', () => {
    for (const justify of [false, true]) {
      expect(spans(setParagraph(para('aaaaaaaaaa', { width: 50, justify })))).toEqual([[0, 10]])
    }
    expect(spans(setParagraph(para('aa bbbbbbbbbb cc', { width: 50 })))).toEqual([
      [0, 3],
      [3, 14],
      [14, 16],
    ])
  })

  it('trailing spaces do not count', () => {
    // 'aaa bbbb ' is 80 with its trailing space, 75 without: it fits 75 px.
    for (const justify of [false, true]) {
      const lines = setParagraph(para('aaa bbbb cc', { width: 75, justify }))
      expect(spans(lines)).toEqual([
        [0, 9],
        [9, 11],
      ])
      expect(lines[0]?.spaceAdjust).toBe(0)
    }
  })

  it('per-line widths: first line narrower', () => {
    const narrow = setParagraph(para('aaa bbb ccc ddd', { width: (n) => (n === 0 ? 40 : 100) }))
    expect(spans(narrow)).toEqual([
      [0, 4],
      [4, 15],
    ])
    expect(spans(setParagraph(para('aaa bbb ccc ddd', { width: 100 })))).toEqual([
      [0, 12],
      [12, 15],
    ])
  })

  it('spaceAdjust makes justified lines exactly lineWidth', () => {
    const p = para(longText(), { width: 600, justify: true })
    const lines = setParagraph(p)
    expect(lines.length).toBeGreaterThan(3)
    for (const l of lines.slice(0, -1)) {
      const { width, spaces } = measure(p, l)
      expect(Math.abs(width + spaces * l.spaceAdjust - 600)).toBeLessThan(0.01)
    }
    expect(lines.at(-1)?.spaceAdjust).toBe(0)
    // Lines tile the text.
    expect(lines[0]?.from).toBe(0)
    expect(lines.at(-1)?.to).toBe(p.text.length)
    for (let i = 1; i < lines.length; i++) expect(lines[i]?.from).toBe(lines[i - 1]?.to)
  })

  it('1000-char paragraph sets in under 8 ms', () => {
    const p = para(longText(), { width: 600, justify: true })
    expect(p.text.length).toBeGreaterThanOrEqual(1000)
    for (let i = 0; i < 5; i++) setParagraph(p) // warm up the JIT
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const t = performance.now()
      setParagraph(p)
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    const median = ((times[9] as number) + (times[10] as number)) / 2
    expect(median).toBeLessThan(process.env.CI ? 40 : 8)
  })

  it('empty text is one empty line', () => {
    expect(setParagraph(para(''))).toEqual([{ from: 0, to: 0, hyphen: false, spaceAdjust: 0 }])
  })
})

describe('rawRatio / rawCost (Typst fns raw_ratio, raw_cost)', () => {
  const metrics = { minRatio: -1, minApproxRatio: -0.5, hyphCost: 135, runtCost: 100 }

  it('stretches past 1 with the extra space per justifiable in half ems', () => {
    // delta 40, stretch 5 → 8 > 1: 1 + (40 − 5)/2 / (20/2) = 2.75.
    expect(rawRatio(100, 60, 5, 10 / 3, 2, 20)).toBeCloseTo(2.75, 12)
    expect(rawRatio(100, 100, 0, 0, 0, 20)).toBe(0)
    expect(rawRatio(100, 200, 5, 10, 3, 20)).toBe(-2) // clamped to MIN_RATIO − 1
    expect(rawRatio(100, 0, 0, 0, 0, 20)).toBe(10) // clamped to 10
  })

  it('penalises hyphens close to a word end by 15 % per char', () => {
    // l2/r6: 5−2 = 3 steps → 1.45·135 = 195.75; (1 + 0 + 195.75)².
    const bp = { kind: 'hyphen' as const, left: 2, right: 6 }
    expect(rawCost(metrics, bp, 0, true, false, false, false)).toBeCloseTo(196.75 ** 2, 6)
    // A second dash in a row adds another 135.
    expect(rawCost(metrics, bp, 0, true, false, true, false)).toBeCloseTo(331.75 ** 2, 6)
  })

  it('charges badness 100·|r|³, overfull 1e6, and nothing for a loose last line', () => {
    const normal = { kind: 'normal' as const }
    const end = { kind: 'mandatory' as const }
    expect(rawCost(metrics, normal, 0.5, true, false, false, false)).toBeCloseTo(13.5 ** 2, 9)
    expect(rawCost(metrics, normal, -1.1, true, false, false, false)).toBe(1_000_001 ** 2)
    // The approximate pass already calls a line overfull below −0.5.
    expect(rawCost(metrics, normal, -0.6, true, false, false, true)).toBe(1_000_001 ** 2)
    expect(rawCost(metrics, end, 3, false, false, false, false)).toBe(1)
    expect(rawCost(metrics, end, 3, false, true, false, false)).toBe(101 ** 2) // runt
    expect(rawCost(metrics, end, -0.5, false, false, false, false)).toBeCloseTo(13.5 ** 2, 9)
  })
})

/** A deterministic 1000+ char paragraph with hyphen points inside long words. */
function longText(): string {
  const words: string[] = []
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  let length = 0
  while (length <= 1000) {
    const n = 2 + Math.floor(rnd() * 9)
    let w = 'x'.repeat(n)
    if (n >= 6) w = `${'x'.repeat(3)}~${'x'.repeat(n - 3)}`
    words.push(w)
    length += n + 1
  }
  return words.join(' ')
}
