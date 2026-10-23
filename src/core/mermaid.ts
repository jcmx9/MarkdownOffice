/**
 * Mermaid diagrams as the PDF draws them: the bundled mmdr plugin (typst_mmdr.wasm, run through
 * ./typst-plugin) with a set's arguments, plus the font-weight rule memo.typ applies to the SVG.
 * pipeline/tests/test-mermaid.sh compares the result byte for byte with Typst's.
 *
 * The only import is a type (erased by Node's type stripping), so pipeline/tests/mermaid-core.mts
 * can run this file directly.
 */
import type { TypstPlugin } from './typst-plugin'

export interface MermaidOptions {
  /** mmdr's base theme: "default" (Mermaid's) or anything else for mmdr's modern theme. */
  baseTheme: string
  /** Theme overrides merged into the base theme (mmdr field names); empty = none. */
  theme: Record<string, string>
  /** Layout overrides (node_spacing, rank_spacing, …); empty = none. */
  layout: Record<string, number>
  /**
   * Largest height the set scales a diagram to (a CSS/Typst length, e.g. "12cm"), or null when
   * the set's .typ caps only the width.
   */
  maxHeight: string | null
  /** font-weight written before every font-family attribute, or null to leave the SVG as is. */
  fontWeight: number | null
}

/** memo.typ's arguments (mermaid-theme, mermaid-layout, mermaid-max-height, the "500" rule). */
export const MEMO_MERMAID: MermaidOptions = {
  baseTheme: 'modern',
  theme: {
    font_family: 'SourceSans3VF',
    primary_color: '#f4f2ee',
    primary_text_color: '#2b2b2b',
    primary_border_color: '#b9b2a6',
    secondary_color: '#fbeab0',
    tertiary_color: '#fdfcfa',
    line_color: '#6b6b6b',
    text_color: '#2b2b2b',
    edge_label_background: '#ffffff',
    cluster_background: '#fdfcfa',
    cluster_border: '#e4e1dc',
    background: '#ffffff',
    sequence_actor_fill: '#f4f2ee',
    sequence_actor_border: '#b9b2a6',
    sequence_actor_line: '#b9b2a6',
    sequence_note_fill: '#fbeab0',
    sequence_note_border: '#e0c66a',
  },
  layout: { node_spacing: 25, rank_spacing: 35 },
  maxHeight: '12cm',
  // The variable Source Sans 3 falls back to ExtraLight for weight 400 in Typst; 500 (Medium)
  // hits a real named instance and stays readable (memo.typ).
  fontWeight: 500,
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** mmdr reads an empty override as "none" (lib.typ passes "" for `none`). */
const overrides = (o: Record<string, unknown>) =>
  Object.keys(o).length === 0 ? '' : JSON.stringify(o)

/** Renders `source` to an SVG string exactly as the set's Typst show rule does. */
export function renderMermaid(plugin: TypstPlugin, source: string, opts: MermaidOptions): string {
  const svg = decoder.decode(
    plugin.call(
      'render',
      encoder.encode(source),
      encoder.encode(opts.baseTheme),
      encoder.encode(overrides(opts.theme)),
      encoder.encode(overrides(opts.layout)),
    ),
  )
  if (opts.fontWeight === null) return svg
  // Typst's str.replace: every occurrence, left to right, never rescanning inserted text.
  return svg.replaceAll('font-family=', `font-weight="${opts.fontWeight}" font-family=`)
}
