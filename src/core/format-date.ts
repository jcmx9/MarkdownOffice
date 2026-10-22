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

/** Local calendar date as `YYYY-MM-DD` (not UTC, so "today" matches the user's clock). */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
