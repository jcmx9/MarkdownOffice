import { splitValue } from './sets'

export type FlatValue = string | string[]

const KEY_RE = /^([A-Za-z0-9_-]+):(.*)$/
const NULL_RE = /^(null|Null|NULL|~)$/

/** Items of a flow list `[a, "b, c"]`; commas inside quotes stay, empty items drop. */
function flowItems(inner: string): string[] {
  const items: string[] = []
  let cur = ''
  let quote = ''
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = ''
      else cur += ch
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === ',') {
      items.push(cur)
      cur = ''
    } else cur += ch
  }
  items.push(cur)
  return items.map((s) => s.trim()).filter((s) => s !== '')
}

const indentOf = (s: string) => s.length - s.trimStart().length

/**
 * Reads the column-0 `key: value` entries of a flat YAML document (set profiles, note headers)
 * as source text — `zip: 01067` stays `01067`. Nested keys are ignored, the last duplicate wins.
 * Deliberately not a YAML parser: scalars, flow/block lists and `|`/`>` block scalars are all
 * a set's profile or preview file needs, and the app must read them without a dependency.
 */
export function readFlatYaml(yaml: string): Record<string, FlatValue> {
  const lines = yaml.split('\n').map((l) => l.replace(/\r$/, ''))
  const out: Record<string, FlatValue> = {}
  for (let i = 0; i < lines.length; i++) {
    const m = KEY_RE.exec(lines[i] ?? '')
    if (!m) continue
    const key = m[1] as string
    const { value: raw } = splitValue(m[2] ?? '')
    const quoted = /^["']/.test((m[2] ?? '').trimStart())
    const value = raw.trim()
    // Indented lines belonging to this key (blank lines inside are kept for block scalars).
    let end = i + 1
    while (end < lines.length) {
      const l = lines[end] as string
      if (l.trim() === '' || indentOf(l) > 0) end++
      else break
    }
    const body = lines.slice(i + 1, end)
    if (!quoted && /^[|>][+-]?$/.test(value)) {
      const ind = body.filter((l) => l.trim() !== '').map(indentOf)
      const min = ind.length ? Math.min(...ind) : 0
      const text = body.map((l) => (l.trim() === '' ? '' : l.slice(min)))
      while (text.length && text[text.length - 1] === '') text.pop()
      out[key] = text.join(value.startsWith('|') ? '\n' : ' ')
      i = end - 1
    } else if (!quoted && value === '') {
      const items = body
        .map((l) => /^\s+-(?:\s+(.*))?$/.exec(l))
        .filter((x): x is RegExpExecArray => x !== null)
        .map((x) => splitValue(x[1] ?? '').value.trim())
      out[key] = items.length ? items : ''
      i = end - 1
    } else if (!quoted && value.startsWith('[') && value.endsWith(']')) {
      out[key] = flowItems(value.slice(1, -1))
    } else {
      out[key] = !quoted && NULL_RE.test(value) ? '' : raw
    }
  }
  return out
}

/** Profile values as plain strings; lists are joined like `frontmatterFields` does. */
export function flattenProfile(values: Record<string, FlatValue>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) out[k] = Array.isArray(v) ? v.join(', ') : v
  return out
}
