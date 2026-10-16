const pad = (n: number): string => String(n).padStart(2, '0')

const VARS: Record<string, (d: Date) => string> = {
  CURRENT_YEAR: (d) => String(d.getFullYear()),
  CURRENT_MONTH: (d) => pad(d.getMonth() + 1),
  CURRENT_DATE: (d) => pad(d.getDate()),
  CURRENT_HOUR: (d) => pad(d.getHours()),
  CURRENT_MINUTE: (d) => pad(d.getMinutes()),
  CURRENT_SECOND: (d) => pad(d.getSeconds()),
}

/** Replaces `$CURRENT_*` / `${CURRENT_*}`; every other `$` stays as it is. */
export function expandVariables(text: string, now: Date): string {
  return text.replace(/\$(?:\{([A-Z_]+)\}|([A-Z_]+))/g, (m, braced?: string, bare?: string) => {
    const fn = VARS[braced ?? bare ?? '']
    return fn ? fn(now) : m
  })
}

/**
 * Escapes literal text for CodeMirror's template. CM 6.20 un-escapes only `\{` and `\}`, so
 * braces get a backslash and everything else (also `\`, `$`, `#`) passes unchanged:
 * source `\{` -> `\\{` -> CM yields `\{`; source `${x}` -> `$\{x\}` -> no field.
 */
const lit = (s: string): string => s.replace(/[{}]/g, (c) => `\\${c}`)

type Token = { kind: 'text'; text: string } | { kind: 'stop'; n: string; def: string | null }

/**
 * Escape rule (VS Code): `\$` is a literal `$`, `\\` is a literal `\`, and inside a default `\}` is
 * a literal `}`. Every other backslash stays as written (so `\{` and `\}` in plain text round-trip).
 */
const DEFAULT_ESC = /\\([\\$}])|\$(?:\{([A-Z_]+)\}|([A-Z_]+))/g

function expandDefault(raw: string, now: Date): string {
  return raw.replace(DEFAULT_ESC, (m, esc?: string, braced?: string, bare?: string) =>
    esc !== undefined ? esc : expandVariables(`$${braced ? `{${braced}}` : bare}`, now) || m,
  )
}

/** Splits a body into literal text and tab stops; variables are expanded here. */
function tokenize(body: string, now: Date): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < body.length) {
    const rest = body.slice(i)
    if (/^\\[$\\]/.test(rest)) {
      tokens.push({ kind: 'text', text: rest[1] as string })
      i += 2
      continue
    }
    let m = /^\$(\d+)/.exec(rest)
    if (m) {
      tokens.push({ kind: 'stop', n: m[1] as string, def: null })
      i += m[0].length
      continue
    }
    m = /^\$\{(\d+)(?::|\})/.exec(rest)
    if (m) {
      const n = m[1] as string
      if (m[0].endsWith('}')) {
        tokens.push({ kind: 'stop', n, def: null })
        i += m[0].length
        continue
      }
      // The default runs to the matching `}` (nested braces counted).
      let depth = 1
      let j = i + m[0].length
      for (; j < body.length && depth > 0; j++) {
        if (body[j] === '\\' && /[\\$}]/.test(body[j + 1] ?? '')) j++
        else if (body[j] === '{') depth++
        else if (body[j] === '}') depth--
      }
      if (depth === 0) {
        const def = expandDefault(body.slice(i + m[0].length, j - 1), now)
        tokens.push({ kind: 'stop', n, def })
        i = j
        continue
      }
    }
    m = /^\$(?:\{[A-Z_]+\}|[A-Z_]+)/.exec(rest)
    if (m) {
      tokens.push({ kind: 'text', text: expandVariables(m[0], now) })
      i += m[0].length
      continue
    }
    tokens.push({ kind: 'text', text: body[i] as string })
    i++
  }
  return tokens
}

/**
 * Translates VS Code / Zettlr snippet syntax into a CodeMirror `snippet()` template.
 * Date variables are expanded now; everything that is not a tab stop stays literal.
 */
export function toCmTemplate(body: string, now: Date): string {
  const tokens = tokenize(body, now)
  // CodeMirror gives every occurrence its own default; VS Code mirrors the first one.
  const firstDefault = new Map<string, string>()
  for (const t of tokens) {
    if (t.kind === 'stop' && t.def !== null && !firstDefault.has(t.n)) firstDefault.set(t.n, t.def)
  }
  let out = ''
  for (const t of tokens) {
    if (t.kind === 'text') {
      out += lit(t.text)
      continue
    }
    const def = t.def ?? firstDefault.get(t.n) ?? null
    if (def === null || def === '') out += `\${${t.n}}`
    else if (/[{}\n]/.test(def)) out += `${lit(def)}\${${t.n}}`
    else out += `\${${t.n}:${def}}`
  }
  return out
}
