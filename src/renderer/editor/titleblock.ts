import type { Text } from '@codemirror/state'
import { frontmatterFields } from './frontmatter'

export interface TitleBlock {
  client: string
  title: string
  subtitle: string
  /** "date · author", only when author is set (as in the PDF). */
  meta: string
}

const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** The memo set's date-display: ISO or D.M.YYYY parsed, anything else verbatim. */
export function formatDate(raw: string, lang: string): string {
  const s = raw.trim()
  let ymd: [number, number, number] | null = null
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s)
  if (iso) ymd = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (de) ymd = [Number(de[3]), Number(de[2]), Number(de[1])]
  if (!ymd) return s
  const [y, m, d] = ymd
  if (m < 1 || m > 12 || d < 1 || d > 31) return s
  return lang.startsWith('de') ? `${d}. ${MONTHS_DE[m - 1]} ${y}` : `${MONTHS_EN[m - 1]} ${d}, ${y}`
}

export function titleBlockData(doc: Text): TitleBlock | null {
  const f = frontmatterFields(doc)
  const client = f.client ?? ''
  const title = f.title ?? ''
  const subtitle = f.subtitle ?? ''
  const author = f.author ?? ''
  if (!client && !title && !subtitle && !author) return null
  const date = formatDate(f.date ?? '', f.lang || 'de')
  return { client, title, subtitle, meta: author ? [date, author].filter(Boolean).join(' · ') : '' }
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
  part('mdo-tb-client', tb.client)
  part('mdo-tb-title', tb.title)
  part('mdo-tb-subtitle', tb.subtitle)
  part('mdo-tb-meta', tb.meta)
  return el
}
