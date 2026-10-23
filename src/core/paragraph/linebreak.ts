/*
 * Portions ported from Typst v0.15.0 (https://github.com/typst/typst, commit 3ae5277):
 * `crates/typst-layout/src/inline/linebreak.rs` (fns `linebreak`, `linebreak_simple`,
 * `linebreak_optimized`, `linebreak_optimized_bounded`, `linebreak_optimized_approximate`,
 * `ratio_and_cost`, `raw_ratio`, `raw_cost`, `Breakpoint::trim`, structs `CostMetrics`,
 * `Estimates`) and `crates/typst-layout/src/inline/line.rs` (fns `line`, `commit`).
 * Copyright Typst contributors. Licensed under the Apache License, Version 2.0; see
 * vendor/typst/LICENSE and vendor/typst/README.md.
 * Modified: ported to TypeScript; a line is measured from x positions of one unwrapped line
 * instead of shaped glyphs; spaces are the only adjustable glyphs (no CJK, no tracking limits);
 * the available width may differ per line; justification is reduced to one adjustment per space.
 */

/**
 * Sets a paragraph into lines exactly like Typst 0.15.0 (`crates/typst-layout/src/inline/`), so
 * the preview breaks where the PDF does: first fit for ragged paragraphs, Knuth-Plass with
 * Typst's cost model (approximate pass as upper bound, then the bounded exact pass) for justified
 * ones — Typst's `linebreaks: auto`.
 *
 * Indices are UTF-16 offsets into `text`; Typst works in UTF-8 bytes, which only changes the
 * indexing, not the result.
 */
import type { BreakPoint } from './breaks'

export interface ParagraphInput {
  /** The display string of one paragraph (one source line). */
  text: string
  /** x[i] = left edge of char i, x[text.length] = right edge of the last char (px, unwrapped). */
  x: Float64Array
  /** Break opportunities from `breakPoints`, sorted, never at 0 or `text.length`. */
  breaks: BreakPoint[]
  /** Available width of line n (the first line may differ, e.g. after a list marker). */
  lineWidth: (line: number) => number
  /** Width of '-' in the font at that break. */
  hyphenWidth: (index: number) => number
  justify: boolean
  /** Typst's `text.costs` (1 = 100 %). */
  costs: { hyphenation: number; runt: number }
  /** Font size in px at that index (the em of the ratio > 1 formula and the hyphen estimate). */
  fontSize: (index: number) => number
}

export interface SetLine {
  from: number
  /** The next line's `from`; trailing spaces belong to the line but take no width. */
  to: number
  /** The line ends in a hyphen Typst adds (hyphenation point or soft hyphen). */
  hyphen: boolean
  /** Px added to every space of the line (negative when shrinking, 0 when not adjusted). */
  spaceAdjust: number
}

/** `Breakpoint`: the end of the text is Typst's `Mandatory`; `soft` is a `Normal` after U+00AD. */
export interface Breakpoint {
  kind: 'normal' | 'hyphen' | 'soft' | 'mandatory'
  left?: number
  right?: number
}

/** `CostMetrics` */
export interface CostMetrics {
  minRatio: number
  minApproxRatio: number
  hyphCost: number
  runtCost: number
}

// Cost parameters (higher than Knuth-Plass's 50, see linebreak.rs).
const DEFAULT_HYPH_COST = 135
const DEFAULT_RUNT_COST = 100
// Other parameters.
const MIN_RATIO = -1
const MIN_APPROX_RATIO = -0.5
const BOUND_EPS = 1e-3
/** Typst's `AbsUnit::EPS` (there in pt, here in px), used by `Abs::fits` and `approx_eq`. */
const ABS_EPS = 1e-4
/** `JustificationLimits` default: spaces may shrink to 2/3 and stretch to 3/2 of their width. */
const SPACE_SHRINK = 1 / 3
const SPACE_STRETCH = 1 / 2
/** `CostMetrics::approx_hyphen_width`: 0.33 em. */
const APPROX_HYPHEN_EM = 0.33

const SHY = '\u00AD'
const LINE_SEPARATOR = '\u2028'

/** `is_space` (shaping.rs) as the controller ruled: U+0020 and U+00A0 are the justifiables. */
const isSpace = (c: number) => c === 0x20 || c === 0xa0

/** Rust's `char::is_whitespace` (Unicode White_Space); JS `\s` adds U+FEFF, an ignorable anyway. */
const WHITESPACE = /\s/
/** `is_default_ignorable` (Unicode Default_Ignorable_Code_Point: SHY, ZWSP, bidi controls …). */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u

type Dash = 'soft' | 'hard' | 'other' | null

/** `Line`: only what cost and justification need. */
interface Line {
  from: number
  to: number
  /** The line's index (decides its available width). */
  n: number
  width: number
  justify: boolean
  dash: Dash
  justifiables: number
  stretch: number
  shrink: number
}

const EMPTY_LINE: Line = {
  from: 0,
  to: 0,
  n: -1,
  width: 0,
  justify: false,
  dash: null,
  justifiables: 0,
  stretch: 0,
  shrink: 0,
}

/** Prefix sums over the text, so a line's metrics cost O(1). */
interface Prepared {
  p: ParagraphInput
  bps: number[]
  kinds: Breakpoint[]
  /** Spaces in [0, i). */
  spaces: Int32Array
  /** Width of the spaces in [0, i). */
  spaceWidth: Float64Array
  /** End of [0, i) with trailing whitespace and ignorables trimmed (`Breakpoint::trim`). */
  trimLayout: Int32Array
  /** End of [0, i) with trailing whitespace trimmed (`str::trim_end`, approximate pass). */
  trimSpace: Int32Array
  metrics: CostMetrics
}

function prepare(p: ParagraphInput): Prepared {
  const { text, x } = p
  const len = text.length
  const spaces = new Int32Array(len + 1)
  const spaceWidth = new Float64Array(len + 1)
  const trimLayout = new Int32Array(len + 1)
  const trimSpace = new Int32Array(len + 1)
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i)
    const c = text[i] as string
    const space = isSpace(code)
    spaces[i + 1] = (spaces[i] as number) + (space ? 1 : 0)
    spaceWidth[i + 1] =
      (spaceWidth[i] as number) + (space ? (x[i + 1] as number) - (x[i] as number) : 0)
    const white = WHITESPACE.test(c)
    trimSpace[i + 1] = white ? (trimSpace[i] as number) : i + 1
    trimLayout[i + 1] = white || IGNORABLE.test(c) ? (trimLayout[i] as number) : i + 1
  }

  const bps: number[] = []
  const kinds: Breakpoint[] = []
  for (const b of p.breaks) {
    if (b.index <= 0 || b.index >= len) continue
    if (bps.length > 0 && b.index <= (bps[bps.length - 1] as number)) continue
    bps.push(b.index)
    kinds.push(b)
  }
  // `breakpoints`: the end of the text is the final Mandatory break (also for empty text).
  bps.push(len)
  kinds.push({ kind: 'mandatory' })

  // `CostMetrics::compute`
  const metrics: CostMetrics = {
    // When justifying, spaces may shrink below their natural width.
    minRatio: p.justify ? MIN_RATIO : 0,
    minApproxRatio: p.justify ? MIN_APPROX_RATIO : 0,
    hyphCost: DEFAULT_HYPH_COST * p.costs.hyphenation,
    runtCost: DEFAULT_RUNT_COST * p.costs.runt,
  }
  return { p, bps, kinds, spaces, spaceWidth, trimLayout, trimSpace, metrics }
}

/** `line` (line.rs): the line over from..to ending at `bp`, as line `n`. */
function line(r: Prepared, from: number, to: number, bp: Breakpoint, n: number): Line {
  const { p } = r
  const last = p.text[to - 1]
  // Whether the line is justified.
  const justify = last === LINE_SEPARATOR || (p.justify && bp.kind !== 'mandatory')
  // Process dashes.
  let dash: Dash = null
  if (bp.kind === 'hyphen' || last === SHY) dash = 'soft'
  else if (last === '-') dash = 'hard'
  else if (last === '\u2013' || last === '\u2014') dash = 'other'
  // `Breakpoint::trim`: a hyphenation point trims nothing; Normal trims trailing whitespace and
  // default ignorables. Mandatory (end of text) only trims newlines in Typst, but its paragraph
  // text never ends in spaces (markup trims them), so trimming them here gives the same layout.
  const end = bp.kind === 'hyphen' ? to : Math.max(from, r.trimLayout[to] as number)
  const spaceW = (r.spaceWidth[end] as number) - (r.spaceWidth[from] as number)
  // Typst's "repeat the hyphen at the next line start" (`should_repeat_hyphen`) only applies to
  // Lower Sorbian, Czech, Croatian, Polish, Portuguese, Slovak and Spanish: not ported.
  let width = (p.x[end] as number) - (p.x[from] as number)
  // Add a hyphen at the line end if we ended on a soft hyphen or hyphenation point.
  if (dash === 'soft') width += p.hyphenWidth(to)
  return {
    from,
    to,
    n,
    width,
    justify,
    dash,
    justifiables: (r.spaces[end] as number) - (r.spaces[from] as number),
    stretch: spaceW * SPACE_STRETCH,
    shrink: spaceW * SPACE_SHRINK,
  }
}

/** `linebreak`: `linebreaks: auto` is optimized for justified paragraphs, simple otherwise. */
export function setParagraph(p: ParagraphInput): SetLine[] {
  const r = prepare(p)
  const lines = p.justify ? linebreakOptimized(r) : linebreakSimple(r)
  return lines.map((l) => commit(p, l))
}

/** `linebreak_simple`: first fit, always taking the longest line that fits. */
function linebreakSimple(r: Prepared): Line[] {
  const { p, bps, kinds } = r
  const lines: Line[] = []
  let start = 0
  let last: Line | null = null
  for (let i = 0; i < bps.length; i++) {
    const end = bps[i] as number
    const bp = kinds[i] as Breakpoint
    let attempt = line(r, start, end, bp, lines.length)
    // If the line doesn't fit anymore, push the last fitting attempt and rebuild from its end.
    if (!fits(p.lineWidth(attempt.n), attempt.width) && last) {
      lines.push(last)
      start = last.to
      attempt = line(r, start, end, bp, lines.length)
      last = null
    }
    // Finish the line at a mandatory break or when it doesn't fit even alone.
    if (bp.kind === 'mandatory' || !fits(p.lineWidth(attempt.n), attempt.width)) {
      lines.push(attempt)
      start = end
      last = null
    } else {
      last = attempt
    }
  }
  if (last) lines.push(last)
  return lines
}

/** `Abs::fits` */
const fits = (available: number, width: number) => available + ABS_EPS >= width

/** `linebreak_optimized`: the approximate pass gives an upper bound for the exact one. */
function linebreakOptimized(r: Prepared): Line[] {
  const upperBound = linebreakOptimizedApproximate(r)
  return linebreakOptimizedBounded(r, upperBound)
}

/** `linebreak_optimized_bounded`: Knuth-Plass over the break points, pruned by `upperBound`. */
function linebreakOptimizedBounded(r: Prepared, upperBound: number): Line[] {
  const { p, bps, kinds, metrics } = r
  interface Entry {
    pred: number
    total: number
    line: Line
    end: number
  }
  const table: Entry[] = [{ pred: 0, total: 0, line: EMPTY_LINE, end: 0 }]
  let active = 0
  let prevEnd = 0

  for (let k = 0; k < bps.length; k++) {
    const end = bps[k] as number
    const bp = kinds[k] as Breakpoint
    let best: Entry | null = null
    // A lower bound for the cost of all following line attempts, and the width it was found at:
    // Typst's width is the same for every line; here a later predecessor's line may be narrower,
    // and only a line at least as wide is sure to be at least as underfull.
    let lowerBound: number | null = null
    let lowerBoundWidth = 0

    for (let i = active; i < table.length; i++) {
      const pred = table[i] as Entry
      const start = pred.end
      const unbreakable = prevEnd === start
      const n = pred.line.n + 1
      const available = p.lineWidth(n)

      // If the minimum cost of the line is already too much, skip this attempt.
      if (
        lowerBound !== null &&
        available >= lowerBoundWidth &&
        pred.total + lowerBound > upperBound + BOUND_EPS
      ) {
        continue
      }

      const attempt = line(r, start, end, bp, n)
      const [ratio, cost] = ratioAndCost(r, available, pred.line, attempt, bp, unbreakable)

      // An overfull line from the earliest active start: drop that start for good.
      if (ratio < metrics.minRatio && active === i) active++

      const total = pred.total + cost

      // An underfull line only gets worse for shorter slices (no negative spacing here).
      if (ratio > 0 && lowerBound === null) {
        lowerBound = cost
        lowerBoundWidth = available
      }

      if (total > upperBound + BOUND_EPS) continue

      if (best === null || best.total >= total) best = { pred: i, total, line: attempt, end }
    }

    if (bp.kind === 'mandatory') active = table.length
    if (best) table.push(best)
    prevEnd = end
  }

  // Retrace the best path. An incomplete table means the bound was faulty: Typst's release
  // build then retries without a bound.
  let idx = table.length - 1
  if ((table[idx] as Entry).end !== p.text.length) {
    return linebreakOptimizedBounded(r, Number.POSITIVE_INFINITY)
  }
  const lines: Line[] = []
  while (idx !== 0) {
    const entry = table[idx] as Entry
    lines.push(entry.line)
    idx = entry.pred
  }
  return lines.reverse()
}

/**
 * `linebreak_optimized_approximate`: Knuth-Plass with cheap estimated metrics (hyphen 0.33 em,
 * whitespace-only trim, stricter overfull limit); the exact cost of the layout it finds is an
 * upper bound for the exact pass, or infinity if that layout has an overfull line.
 */
function linebreakOptimizedApproximate(r: Prepared): number {
  const { p, bps, kinds, metrics } = r
  interface Entry {
    pred: number
    total: number
    end: number
    unbreakable: boolean
    bp: Breakpoint
    n: number
  }
  const table: Entry[] = [
    { pred: 0, total: 0, end: 0, unbreakable: false, bp: { kind: 'mandatory' }, n: -1 },
  ]
  let active = 0
  let prevEnd = 0

  for (let k = 0; k < bps.length; k++) {
    const end = bps[k] as number
    const bp = kinds[k] as Breakpoint
    let best: Entry | null = null
    for (let i = active; i < table.length; i++) {
      const pred = table[i] as Entry
      const start = pred.end
      const unbreakable = prevEnd === start
      const n = pred.n + 1
      // Whether the line is justified (not exactly `line`'s rule, good enough).
      const justify = p.justify && bp.kind !== 'mandatory'
      // We don't know whether the line naturally ends with a dash; only hyphens count.
      const consecutiveDash = pred.bp.kind === 'hyphen' && bp.kind === 'hyphen'
      // `Estimates`: trailing whitespace trimmed, hyphen estimated.
      const trimmed = Math.max(start, r.trimSpace[end] as number)
      const spaceW = (r.spaceWidth[trimmed] as number) - (r.spaceWidth[start] as number)
      const width =
        (p.x[trimmed] as number) -
        (p.x[start] as number) +
        (bp.kind === 'hyphen' ? APPROX_HYPHEN_EM * p.fontSize(end) : 0)
      const ratio = rawRatio(
        p.lineWidth(n),
        width,
        spaceW * SPACE_STRETCH,
        spaceW * SPACE_SHRINK,
        (r.spaces[trimmed] as number) - (r.spaces[start] as number),
        p.fontSize(start),
      )
      const cost = rawCost(metrics, bp, ratio, justify, unbreakable, consecutiveDash, true)

      if (ratio < metrics.minRatio && active === i) active++

      const total = pred.total + cost
      if (best === null || best.total >= total) {
        best = { pred: i, total, end, unbreakable, bp, n }
      }
    }
    if (bp.kind === 'mandatory') active = table.length
    if (best) table.push(best)
    prevEnd = end
  }

  // Retrace the best path.
  const indices: number[] = []
  let idx = table.length - 1
  while (idx !== 0) {
    indices.push(idx)
    idx = (table[idx] as Entry).pred
  }

  // Its exact cost is a sound upper bound, unless a line turns out overfull.
  let pred = EMPTY_LINE
  let start = 0
  let exact = 0
  for (let k = indices.length - 1; k >= 0; k--) {
    const { end, bp, unbreakable } = table[indices[k] as number] as Entry
    const attempt = line(r, start, end, bp, pred.n + 1)
    const [ratio, cost] = ratioAndCost(r, p.lineWidth(attempt.n), pred, attempt, bp, unbreakable)
    if (ratio < metrics.minRatio) return Number.POSITIVE_INFINITY
    pred = attempt
    start = end
    exact += cost
  }
  return exact
}

/** `ratio_and_cost` */
function ratioAndCost(
  r: Prepared,
  available: number,
  pred: Line,
  attempt: Line,
  bp: Breakpoint,
  unbreakable: boolean,
): [number, number] {
  const ratio = rawRatio(
    available,
    attempt.width,
    attempt.stretch,
    attempt.shrink,
    attempt.justifiables,
    r.p.fontSize(attempt.from),
  )
  const consecutiveDash = pred.dash !== null && attempt.dash !== null
  const cost = rawCost(r.metrics, bp, ratio, attempt.justify, unbreakable, consecutiveDash, false)
  return [ratio, cost]
}

/**
 * `raw_ratio`: how much the line's spaces must stretch (> 0) or shrink (< 0) to fill
 * `available`; below the minimum ratio the line is overfull. Past 1 the extra space per
 * justifiable counts in half ems. Clamped to [MIN_RATIO − 1, 10].
 */
export function rawRatio(
  available: number,
  lineWidth: number,
  stretchability: number,
  shrinkability: number,
  justifiables: number,
  fontSize: number,
): number {
  let delta = available - lineWidth
  // Avoid floating point errors (`Abs::approx_eq`).
  if (Math.abs(delta) < ABS_EPS) delta = 0
  const adjustability = delta >= 0 ? stretchability : shrinkability
  let ratio = delta / Math.max(adjustability, 0)
  // NaN: delta was zero, the line fits perfectly.
  if (Number.isNaN(ratio)) ratio = 0
  if (ratio > 1) {
    const extraStretch = (delta - adjustability) / Math.max(justifiables, 1)
    ratio = 1 + extraStretch / (fontSize / 2)
  }
  return Math.min(Math.max(ratio, MIN_RATIO - 1), 10)
}

/** `raw_cost`: Knuth-Plass's (1 + badness + penalty)², with Typst's adjustments. */
export function rawCost(
  metrics: CostMetrics,
  bp: Breakpoint,
  ratio: number,
  justify: boolean,
  unbreakable: boolean,
  consecutiveDash: boolean,
  approx: boolean,
): number {
  let badness: number
  if (ratio < (approx ? metrics.minApproxRatio : metrics.minRatio)) {
    // An overfull line always has maximum cost.
    badness = 1_000_000
  } else if (bp.kind !== 'mandatory' || justify || ratio < 0) {
    badness = 100 * Math.abs(ratio) ** 3
  } else {
    // A ragged last line that needs no shrinking costs nothing.
    badness = 0
  }

  let penalty = 0
  // Runts: a lone word on the last line.
  if (unbreakable && bp.kind === 'mandatory') penalty += metrics.runtCost
  // Hyphenation, 15 % more per char closer than 5 to either end of the word.
  if (bp.kind === 'hyphen') {
    const LIMIT = 5
    const steps = Math.max(0, LIMIT - (bp.left ?? LIMIT)) + Math.max(0, LIMIT - (bp.right ?? LIMIT))
    penalty += (1 + 0.15 * steps) * metrics.hyphCost
  }
  // Two dashes in a row (not necessarily hyphens).
  if (consecutiveDash) penalty += metrics.hyphCost

  return (1 + badness + penalty) ** 2
}

/** `commit` (line.rs): the space adjustment that fills the line to its width. */
function commit(p: ParagraphInput, l: Line): SetLine {
  let remaining = p.lineWidth(l.n) - l.width
  let adjust = 0
  if (remaining < 0 && l.shrink > 0) {
    // Shrink, at most to the spaces' minimum (also on ragged or last lines that overflow).
    adjust = Math.max(remaining / l.shrink, -1) * l.shrink
  } else if (l.justify) {
    // Stretch up to the spaces' maximum, then distribute the rest over the justifiables.
    if (l.stretch > 0) {
      adjust = Math.min(remaining / l.stretch, 1) * l.stretch
      remaining = Math.max(remaining - l.stretch, 0)
    }
    if (l.justifiables > 0 && remaining > 0) adjust += remaining
  }
  return {
    from: l.from,
    to: l.to,
    hyphen: l.dash === 'soft',
    // One value per line: spaces of equal width get equal shares, as Typst gives them.
    spaceAdjust: l.justifiables > 0 ? adjust / l.justifiables + 0 : 0,
  }
}
