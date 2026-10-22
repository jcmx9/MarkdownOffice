/**
 * A template set's `<name>.css` is untrusted input that reaches the editor. This module decides
 * what of it survives: plain `.mdo-*` rules with declarations that can load nothing (no `url(`,
 * `@import`, `@font-face`, CSS escapes) and cannot leave the editor (no `position: fixed`,
 * no `z-index`). The output is rebuilt from the parsed pieces, never passed through, so the
 * browser reads exactly the structure this scanner saw.
 */

export interface SetCssRule {
  selectors: string[]
  declarations: Array<[property: string, value: string]>
}

const SELECTOR_RE = /^\.mdo-[a-z0-9-]/
const TOKEN_PROP_RE = /^--mdo-[a-z0-9-]+$/
const PLAIN_PROP_RE = /^-?[a-z][a-z-]*$/
// Functions that fetch a resource or run code; matched with all whitespace removed.
const LOADING_FNS = ['url(', 'image(', 'image-set(', 'element(', 'expression(', 'src(']
const IMPORTANT_RE = /\s*!\s*important\s*$/i
const LENGTH_RE = /(^|[^\w.#-])(-?(?:\d+\.?\d*|\.\d+))(px|pt|pc|mm|cm|in|q)\b/gi

/** Index just past the string starting at `i` (a quote), or -1 if it never closes on its line. */
function skipString(s: string, i: number): number {
  const quote = s[i]
  for (let j = i + 1; j < s.length; j++) {
    const ch = s[j]
    if (ch === '\\') j++
    else if (ch === quote) return j + 1
    // CSS ends an unclosed string at the newline (bad-string); treat it as broken input.
    else if (ch === '\n' || ch === '\r' || ch === '\f') return -1
  }
  return -1
}

/** Comments become a space; comment-like text inside strings stays. */
function stripComments(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '"' || ch === "'") {
      const end = skipString(css, i)
      // An unclosed string swallows the rest; the rule parser drops it.
      const stop = end < 0 ? css.length : end
      out += css.slice(i, stop)
      i = stop
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      out += ' '
      i = end < 0 ? css.length : end + 2
    } else {
      out += ch
      i++
    }
  }
  return out
}

/**
 * True when every string closes and `()`/`[]` nest properly. A value or selector failing this
 * would make the browser read past our rule boundaries, so it is dropped instead.
 */
function balanced(s: string): boolean {
  const stack: string[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"' || ch === "'") {
      const end = skipString(s, i)
      if (end < 0) return false
      i = end - 1
    } else if (ch === '(' || ch === '[') stack.push(ch === '(' ? ')' : ']')
    else if (ch === ')' || ch === ']') {
      if (stack.pop() !== ch) return false
    }
  }
  return stack.length === 0
}

/** Splits at `sep` outside strings, `()` and `[]`; assumes `balanced(s)`. */
function splitTop(s: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"' || ch === "'") i = skipString(s, i) - 1
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === sep && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

interface Block {
  /** Index just past the block's closing `}`, or -1 if it never closes. */
  end: number
  nested: boolean
}

/** Scans the `{ … }` block opening at `open`, string-aware, tracking brace depth. */
function scanBlock(css: string, open: number): Block {
  let depth = 0
  let nested = false
  for (let i = open; i < css.length; i++) {
    const ch = css[i]
    if (ch === '"' || ch === "'") {
      const end = skipString(css, i)
      if (end < 0) return { end: -1, nested }
      i = end - 1
    } else if (ch === '{') {
      depth++
      if (depth > 1) nested = true
    } else if (ch === '}') {
      depth--
      if (depth === 0) return { end: i + 1, nested }
    }
  }
  return { end: -1, nested }
}

/**
 * Index of the first top-level `{` or `;` from `i` (strings skipped), or -1 at the end or
 * on an unclosed string.
 */
function findPreludeEnd(css: string, i: number): number {
  for (let j = i; j < css.length; j++) {
    const ch = css[j]
    if (ch === '"' || ch === "'") {
      const end = skipString(css, j)
      if (end < 0) return -1
      j = end - 1
    } else if (ch === '{' || ch === ';') return j
  }
  return -1
}

/** A declaration's verdict: the kept pair, or why it was dropped. */
function sanitizeDeclaration(raw: string): [string, string] | string {
  const colon = raw.indexOf(':')
  if (colon < 0) return `declaration ${raw}`
  const property = raw.slice(0, colon).trim().toLowerCase()
  let value = raw.slice(colon + 1).trim()
  if (!TOKEN_PROP_RE.test(property) && !PLAIN_PROP_RE.test(property)) return `property ${property}`
  // The app owns the zoom factor; a set overriding it would break the zoom contract.
  if (property === '--mdo-scale') return '--mdo-scale'
  if (property === 'z-index') return 'z-index'
  const lower = value.toLowerCase()
  if (property === 'position' && (lower === 'fixed' || lower === 'sticky'))
    return `position: ${lower}`
  // Escapes could spell `url(` past the check below (`u\72l(`), so no value may contain one.
  if (value.includes('\\')) return `${property}: escape`
  const squashed = lower.replace(/\s+/g, '')
  const fn = LOADING_FNS.find((f) => squashed.includes(f))
  if (fn) return `${property}: ${fn}…)`
  // `<` has no use in a value but could close a <style> element if the CSS is ever serialised
  // into HTML; unbalanced strings or brackets would make the browser read past the rule.
  if (value.includes('<') || !balanced(value)) return `${property}: malformed value`
  // The app's own `!important` (Present's 70ch measure) must always win.
  value = value.replace(IMPORTANT_RE, '')
  if (value === '') return `${property}: empty value`
  return [property, scaleLengths(value)]
}

/** The selector list's parts, or why the whole rule is dropped. */
function sanitizeSelectors(prelude: string): string[] | string {
  const text = prelude.trim()
  if (text.includes('\\') || text.includes('<') || !balanced(text)) return `selector ${text}`
  const parts = splitTop(text, ',').map((p) => p.trim())
  // One foreign part drops the whole list: the author meant the rule as a unit.
  const bad = parts.find((p) => !SELECTOR_RE.test(p))
  if (bad !== undefined) return `selector ${bad === '' ? text : bad}`
  return parts
}

/**
 * Parses a set's CSS into the `.mdo-*` rules that may reach the editor, with absolute lengths
 * scaled by `--mdo-scale`. `dropped` holds short English descriptions for the log.
 */
export function sanitizeSetCss(css: string): { rules: SetCssRule[]; dropped: string[] } {
  const src = stripComments(css)
  const rules: SetCssRule[] = []
  const dropped: string[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i] ?? ''
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const stop = findPreludeEnd(src, i)
    if (stop < 0) {
      dropped.push('unterminated rule')
      break
    }
    const prelude = src.slice(i, stop)
    if (src[stop] === ';') {
      dropped.push(ch === '@' ? (/^@[\w-]*/.exec(prelude)?.[0] ?? '@') : 'stray text')
      i = stop + 1
      continue
    }
    const block = scanBlock(src, stop)
    if (block.end < 0) {
      dropped.push('unterminated rule')
      break
    }
    i = block.end
    if (ch === '@') {
      // Every at-rule goes: @import/@font-face load, @media/@supports could carry
      // unscoped rules, and the preview has no use for the rest.
      dropped.push(/^@[\w-]*/.exec(prelude)?.[0] ?? '@')
      continue
    }
    if (block.nested) {
      dropped.push(`nested rule in ${prelude.trim()}`)
      continue
    }
    const selectors = sanitizeSelectors(prelude)
    if (typeof selectors === 'string') {
      dropped.push(selectors)
      continue
    }
    const declarations: SetCssRule['declarations'] = []
    for (const raw of splitTop(src.slice(stop + 1, block.end - 1), ';')) {
      if (raw.trim() === '') continue
      const verdict = sanitizeDeclaration(raw)
      if (typeof verdict === 'string') dropped.push(verdict)
      else declarations.push(verdict)
    }
    if (declarations.length > 0) rules.push({ selectors, declarations })
  }
  return { rules, dropped }
}

/**
 * Rewrites every absolute length outside strings to `calc(<len> * var(--mdo-scale, 1))`, so a
 * set's print units (`11pt`, `165mm`) follow the editor zoom and the Present factor while
 * relative units (`em`, `ch`, unitless) keep following them on their own.
 */
export function scaleLengths(value: string): string {
  let out = ''
  let start = 0
  const flush = (end: number) => {
    out += value.slice(start, end).replace(LENGTH_RE, '$1calc($2$3 * var(--mdo-scale, 1))')
  }
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch !== '"' && ch !== "'") continue
    const end = skipString(value, i)
    const stop = end < 0 ? value.length : end
    flush(i)
    out += value.slice(i, stop)
    start = stop
    i = stop - 1
  }
  flush(value.length)
  return out
}

/** One rule per line, every selector prefixed with `scope` as an ancestor. */
export function scopeSetCss(rules: readonly SetCssRule[], scope: string): string {
  return rules
    .map((r) => {
      const selectors = r.selectors.map((s) => `${scope} ${s}`).join(', ')
      const body = r.declarations.map(([p, v]) => `${p}: ${v};`).join(' ')
      return `${selectors} { ${body} }`
    })
    .join('\n')
}
