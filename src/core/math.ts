/**
 * Formulas for the preview as the PDF sets them: one fixed Typst program renders a whole batch
 * with the bundled mitex (one process per batch, the cost is process start), the request
 * validation main applies before writing that batch, and reading back the size of each page
 * Typst writes as SVG.
 *
 * No injection: formula text never enters Typst source. Main writes MATH_PROGRAM as main.typ and
 * the validated batch as formulas.json next to it; the program reads the JSON and hands each
 * string to mitex as data.
 *
 * Pure (no imports), so the app, the CLI and a later MCP server can share it.
 */

/** One formula of a render request: its TeX source and whether it is display math ($$…$$). */
export interface MathItem {
  tex: string
  display: boolean
}

/**
 * One rendered formula. width/height/depth are in em of MATH_REF_PT, so the preview sets them in
 * `em` and the formula follows the surrounding font size and zoom without re-rendering. depth is
 * the part below the baseline (0 for display formulas, which sit on their own).
 */
export type MathResult =
  | { ok: true; svg: string; width: number; height: number; depth: number }
  | { ok: false; error: string }

/** Reference size the program sets formulas at (New Computer Modern Math is static: exact scaling). */
export const MATH_REF_PT = 10

/** Most formulas per request: far beyond one note's visible formulas, bounds one Typst run. */
export const MATH_MAX_ITEMS = 500
/** Longest formula source accepted (characters). */
export const MATH_MAX_TEX = 10_000

/**
 * The request as main accepts it from the renderer: an array of at most MATH_MAX_ITEMS entries,
 * each exactly `{ tex: string (≤ MATH_MAX_TEX), display: boolean }`. Anything else (extra keys
 * included, they could smuggle settings in later) rejects the whole batch: null.
 */
export function validateMathBatch(x: unknown): MathItem[] | null {
  if (!Array.isArray(x) || x.length > MATH_MAX_ITEMS) return null
  const out: MathItem[] = []
  for (const entry of x) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
    const keys = Object.keys(entry)
    if (keys.length !== 2 || !keys.includes('tex') || !keys.includes('display')) return null
    const { tex, display } = entry as Record<string, unknown>
    if (typeof tex !== 'string' || tex.length > MATH_MAX_TEX) return null
    if (typeof display !== 'boolean') return null
    // Fresh plain objects: nothing of the caller's object (prototype, getters) reaches the JSON.
    out.push({ tex, display })
  }
  return out
}

/**
 * The batch program. Pages come out in item order: a display formula is one tight page with
 * `mitex(tex, block: true)`; an inline formula is two pages with `mitex(tex, block: false)` in a
 * text line (the calls cmarker makes to the set's `math:` function):
 * page 1 with top and bottom edge at the glyph bounds (full height), page 2 with the same top edge
 * but the bottom edge on the baseline, so depth below the baseline = height 1 − height 2.
 * Typst 0.15.0 has no per-element baseline in SVG output; this keeps it to one compile with no
 * formula text in the source. Checked against the real toolchain: page 1 draws the glyphs with
 * their baseline at exactly height 2 (`x\frac{1}{2}`: the `x` sits at 8.588pt, page 2 is 8.588pt).
 * Pages are transparent (fill: none) so the preview's background shows through.
 */
export const MATH_PROGRAM = `#import "mitex/lib.typ": mitex
#set page(width: auto, height: auto, margin: 0pt, fill: none)
#set text(size: ${MATH_REF_PT}pt)
#for (i, item) in json("formulas.json").enumerate() {
  if i > 0 { pagebreak() }
  if item.display {
    mitex(item.tex, block: true)
  } else {
    text(top-edge: "bounds", bottom-edge: "bounds", mitex(item.tex, block: false))
    pagebreak()
    text(top-edge: "bounds", bottom-edge: "baseline", mitex(item.tex, block: false))
  }
}
`

/** SVG pages MATH_PROGRAM writes for an item, to map Typst's pages back to the batch. */
export function pagesPerItem(item: MathItem): 1 | 2 {
  return item.display ? 1 : 2
}

const SVG_ROOT = /^\s*<svg\b([^>]*)>/
const PT_LENGTH = /^(\d+(?:\.\d+)?)pt$/

/**
 * Page size of one Typst SVG from the root element's `width`/`height` attributes (Typst writes
 * them in pt); null when the root or either length is missing or not a plain pt number.
 */
export function svgSizePt(svg: string): { width: number; height: number } | null {
  const root = SVG_ROOT.exec(svg)
  if (!root) return null
  const attrs = root[1] ?? ''
  const attr = (name: string): number | null => {
    const m = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)
    const len = m ? PT_LENGTH.exec(m[1] ?? '') : null
    return len ? Number(len[1]) : null
  }
  const width = attr('width')
  const height = attr('height')
  return width === null || height === null ? null : { width, height }
}
