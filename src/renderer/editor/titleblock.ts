import type { Text } from '@codemirror/state'
import { formatDate } from '../../core/format-date'
import { frontmatterFields } from './frontmatter'

export { formatDate } from '../../core/format-date'

export interface TitleBlock {
  /** Front matter `toptitle:`: the small letter-spaced line above the title (memo set). */
  toptitle: string
  title: string
  subtitle: string
  /** "date · author", only when author is set (as in the PDF). */
  meta: string
}

export function titleBlockData(doc: Text): TitleBlock | null {
  const f = frontmatterFields(doc)
  const toptitle = f.toptitle ?? ''
  const title = f.title ?? ''
  const subtitle = f.subtitle ?? ''
  const author = f.author ?? ''
  if (!toptitle && !title && !subtitle && !author) return null
  const date = formatDate(f.date ?? '', f.lang || 'de')
  return {
    toptitle,
    title,
    subtitle,
    meta: author ? [date, author].filter(Boolean).join(' · ') : '',
  }
}

export function renderTitleBlock(
  tb: TitleBlock | null,
  doc: Document = document,
  empty: 'marker' | 'none' = 'marker',
): HTMLElement {
  const el = doc.createElement('div')
  el.className = 'mdo-titleblock'
  if (empty !== 'none' || tb) el.title = 'YAML-Header ausgeblendet'
  if (!tb) {
    if (empty === 'none') {
      el.classList.add('mdo-titleblock-none')
      return el
    }
    el.classList.add('mdo-titleblock-empty')
    el.textContent = '⋯ YAML-Header'
    return el
  }
  const part = (cls: string, text: string) => {
    if (!text) return
    const d = doc.createElement('div')
    d.className = cls
    d.textContent = text
    el.append(d)
  }
  part('mdo-tb-toptitle', tb.toptitle)
  part('mdo-tb-title', tb.title)
  part('mdo-tb-subtitle', tb.subtitle)
  part('mdo-tb-meta', tb.meta)
  return el
}
