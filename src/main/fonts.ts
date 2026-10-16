import path from 'node:path'

/** The bundled fonts (pipeline/fonts) the editor registers; nothing else is served. */
export const FONT_FILES: readonly string[] = [
  'SourceSans3VF-Upright.otf',
  'SourceSans3VF-Italic.otf',
  'SourceSerif4Variable-Roman.otf',
  'SourceSerif4Variable-Italic.otf',
  'SourceCodeVF-Upright.otf',
  'SourceCodeVF-Italic.otf',
  'NotoEmoji[wght].ttf',
  'NotoSansSymbols2-Regular.ttf',
]

/** Only whitelisted file names are served; anything else (paths, traversal) is refused. */
export function fontFileFor(dir: string, urlPath: string): string | null {
  let name: string
  try {
    name = decodeURIComponent(urlPath.replace(/^\/+/, ''))
  } catch {
    return null
  }
  return FONT_FILES.includes(name) ? path.join(dir, name) : null
}
