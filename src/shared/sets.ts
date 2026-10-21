/**
 * Allowed template-set and profile names: exactly the pipeline's rule
 * (`build.sh resolve_template` and the profile lookup), so the renderer can only name a set,
 * never a path.
 */
export const SET_NAME_RE = /^[a-z0-9_-]+$/

/** The pipeline's default set (empty `template:`); the only set name the UI may hard-code. */
export const DEFAULT_SET = 'memo'

/** Longest picker hint; a set's comment line is cut here so a long one cannot break the layout. */
const HINT_MAX = 80

/** `profile:` at column 0 (nested keys never count), like the pipeline's front-matter reader. */
const PROFILE_LINE_RE = /^profile:(.*)$/

/**
 * Lines of the leading front matter (between the opening `---` and the closing `---`/`...`),
 * or every line when the text has no opening fence. Indices refer to `text.split('\n')`.
 */
function frontMatterRange(lines: string[]): [number, number] {
  if (stripCr(lines[0] ?? '') !== '---') return [0, lines.length]
  for (let i = 1; i < lines.length; i++) {
    const l = stripCr(lines[i] ?? '')
    if (l === '---' || l === '...') return [1, i]
  }
  return [1, lines.length]
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Splits a `profile:` value into its value and the trailing part (padding + `# comment`),
 * mirroring `yaml_str` in build.sh: a quoted value ends at its closing quote, a plain value
 * at whitespace followed by `#`.
 */
export function splitValue(raw: string): { lead: string; value: string; tail: string } {
  const lead = raw.match(/^[ \t]*/)?.[0] ?? ''
  const rest = raw.slice(lead.length)
  const q = rest[0]
  if (q === '"' || q === "'") {
    const end = rest.indexOf(q, 1)
    if (end > 0) return { lead, value: rest.slice(1, end), tail: rest.slice(end + 1) }
    return { lead, value: rest.slice(1), tail: '' }
  }
  // Only a comment after the key (`profile:   # …`) is an empty value, as YAML reads it. The
  // padding then belongs to the comment, so a filled-in value starts one space after the colon.
  if (rest.startsWith('#')) {
    const one = lead.slice(0, 1)
    return { lead: one, value: '', tail: raw.slice(one.length) }
  }
  const c = rest.search(/[ \t]#/)
  const body = c < 0 ? rest : rest.slice(0, c)
  const value = body.replace(/[ \t]+$/, '')
  return { lead, value, tail: rest.slice(value.length) }
}

/**
 * The value of the header's column-0 `profile:` key (comment and quotes stripped), or null
 * when the header has no such key. A set whose header names a profile gets the profile
 * choice in the picker, so the set itself decides — no set name is hard-coded.
 */
export function headerProfile(header: string): string | null {
  const lines = header.split('\n')
  const [from, to] = frontMatterRange(lines)
  for (let i = from; i < to; i++) {
    const m = PROFILE_LINE_RE.exec(stripCr(lines[i] ?? ''))
    if (m) return splitValue(m[1] ?? '').value.trim()
  }
  return null
}

/**
 * The header with the `profile:` value replaced by `name`. The comment keeps its column
 * (padding shrinks or grows, at least one space stays) so the set's aligned header still
 * looks as designed. Unchanged when there is no `profile:` key or the name is invalid
 * (a name outside SET_NAME_RE could carry YAML syntax into the note).
 */
export function withProfile(header: string, name: string): string {
  if (!SET_NAME_RE.test(name)) return header
  return withValue(header, 'profile', name)
}

/** Keys `withValue` may set: only values the caller validated (set names, ISO dates). */
export type ValueKey = 'profile' | 'template' | 'date'

/**
 * The header with the first column-0 `<key>:` value replaced by `value` (plain, unquoted), the
 * comment kept in its column as `withProfile` describes; unchanged without such a key. Shared
 * by the profile choice and the template insert (src/shared/header-merge.ts), so every rewritten
 * header line looks the same. The caller validates `value`: it is written as is.
 */
export function withValue(header: string, key: ValueKey, value: string): string {
  const re = new RegExp(`^${key}:(.*)$`)
  const lines = header.split('\n')
  const [from, to] = frontMatterRange(lines)
  for (let i = from; i < to; i++) {
    const line = lines[i] ?? ''
    const cr = line.endsWith('\r') ? '\r' : ''
    const m = re.exec(stripCr(line))
    if (!m) continue
    const raw = m[1] ?? ''
    const { lead, tail } = splitValue(raw)
    const comment = tail.replace(/^[ \t]+/, '')
    let next: string
    if (comment.startsWith('#')) {
      // Old width from after `<key>:` up to the `#`; keep the comment there when it fits.
      const width = raw.length - comment.length
      const head = `${lead || ' '}${value}`
      next = `${head}${' '.repeat(Math.max(1, width - head.length))}${comment}`
    } else {
      next = `${lead || ' '}${value}`
    }
    lines[i] = `${key}:${next}${cr}`
    return lines.join('\n')
  }
  return header
}

/**
 * The picker hint of a set: its header's first `# …` comment line without the `#`, trimmed,
 * at most 80 characters. Empty when the header has no comment line.
 */
export function headerHint(header: string): string {
  const lines = header.split('\n')
  const [from, to] = frontMatterRange(lines)
  for (let i = from; i < to; i++) {
    const l = stripCr(lines[i] ?? '').trim()
    if (!l.startsWith('#')) continue
    const hint = l.replace(/^#+/, '').trim()
    const chars = Array.from(hint)
    return chars.length > HINT_MAX ? `${chars.slice(0, HINT_MAX - 1).join('')}…` : hint
  }
  return ''
}

/** The header of a set without a header file: just enough for the pipeline to pick the set. */
export function minimalHeader(name: string): string {
  return `---\ntemplate: ${name}\n---\n`
}
