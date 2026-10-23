/**
 * Paragraph-setting inputs of the preview, read from the set tokens and the note's front matter.
 * They mirror what memo.typ hands Typst (`par.justify`, `text.hyphenate`, `text.lang`,
 * `par.costs`), so the preview breaks lines under the same rules as the PDF.
 */

export interface ParagraphSettings {
  justify: boolean
  hyphenate: boolean
  lang: string
  /** Typst's par.costs hyphenation and runt as factors (100 % = 1). */
  costs: { hyphenation: number; runt: number }
}

/** `NNN%` -> NNN/100; anything else falls back to Typst's default 100 %. */
function cost(raw: string): number {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(raw.trim())
  return m?.[1] === undefined ? 1 : Number(m[1]) / 100
}

export function paragraphSettings(
  style: CSSStyleDeclaration,
  frontmatterLang: string | undefined,
): ParagraphSettings {
  const token = (name: string): string => style.getPropertyValue(name).trim()
  const justify = token('--mdo-align') === 'justify'
  const h = token('--mdo-hyphenate')
  // Typst's `hyphenate: auto` hyphenates exactly when the text is justified; unknown -> auto.
  const hyphenate = h === 'true' ? true : h === 'false' ? false : justify
  const lang = (frontmatterLang ?? '').toLowerCase().split(/[-_]/)[0] || 'de'
  return {
    justify,
    hyphenate,
    lang,
    costs: {
      hyphenation: cost(token('--mdo-hyphenation-cost')),
      runt: cost(token('--mdo-runt-cost')),
    },
  }
}
