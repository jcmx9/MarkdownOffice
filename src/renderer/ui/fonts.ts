export const FONT_FACES: ReadonlyArray<{
  family: string
  file: string
  style: 'normal' | 'italic'
  weight: string
}> = [
  { family: 'mdo Sans', file: 'SourceSans3VF-Upright.otf', style: 'normal', weight: '200 900' },
  { family: 'mdo Sans', file: 'SourceSans3VF-Italic.otf', style: 'italic', weight: '200 900' },
  {
    family: 'mdo Serif',
    file: 'SourceSerif4Variable-Roman.otf',
    style: 'normal',
    weight: '200 900',
  },
  {
    family: 'mdo Serif',
    file: 'SourceSerif4Variable-Italic.otf',
    style: 'italic',
    weight: '200 900',
  },
  { family: 'mdo Code', file: 'SourceCodeVF-Upright.otf', style: 'normal', weight: '200 900' },
  { family: 'mdo Code', file: 'SourceCodeVF-Italic.otf', style: 'italic', weight: '200 900' },
  { family: 'mdo Emoji', file: 'NotoEmoji[wght].ttf', style: 'normal', weight: '300 700' },
  { family: 'mdo Symbols', file: 'NotoSansSymbols2-Regular.ttf', style: 'normal', weight: '400' },
]

export function fontUrl(file: string): string {
  return `mdo-font://fonts/${encodeURIComponent(file)}`
}

/** Registers the bundled fonts; a file that fails to load falls back to system fonts. */
export function registerFonts(doc: Document): void {
  for (const f of FONT_FACES) {
    const face = new FontFace(f.family, `url("${fontUrl(f.file)}")`, {
      style: f.style,
      weight: f.weight,
      display: 'swap',
    })
    doc.fonts.add(face)
  }
}
