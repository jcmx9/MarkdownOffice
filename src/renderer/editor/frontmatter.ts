import { yamlLanguage } from '@codemirror/lang-yaml'
import type { Text } from '@codemirror/state'
import { parseMixed } from '@lezer/common'
import type { MarkdownConfig } from '@lezer/markdown'
import {
  FRONTMATTER_CLOSE as CLOSE,
  FrontmatterSyntax,
  FRONTMATTER_OPEN as OPEN,
} from '../../core/markdown-syntax'

/**
 * YAML front matter: only at the very start, `---` … `---`/`...` (pipeline/pandoc rule). The
 * block parser lives in core (the CLI parses notes like the editor); here only the highlighting.
 */
export const Frontmatter: MarkdownConfig = {
  ...FrontmatterSyntax,
  // The lines between the marks are parsed as YAML (keys, strings, comments get colours).
  wrap: parseMixed((node) => {
    if (node.name !== 'Frontmatter') return null
    const open = node.node.firstChild
    const close = open?.nextSibling
    const from = open ? open.to + 1 : node.from
    const to = close ? close.from - 1 : node.to
    return to > from ? { parser: yamlLanguage.parser, overlay: [{ from, to }] } : null
  }),
}

export function frontmatterRange(doc: Text): { from: number; to: number } | null {
  if (doc.lines < 2 || !OPEN.test(doc.line(1).text)) return null
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (CLOSE.test(line.text)) return { from: 0, to: line.to }
  }
  return null
}

/** Flat `key: value` pairs, cleaned like the pipeline's yaml_str (build.sh). */
export function frontmatterFields(doc: Text): Record<string, string> {
  const range = frontmatterRange(doc)
  const out: Record<string, string> = {}
  if (!range) return out
  const lines = doc.sliceString(range.from, range.to).split('\n').slice(1, -1)
  for (const raw of lines) {
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(raw.replace(/\r$/, ''))
    if (!m?.[1]) continue
    out[m[1]] = cleanValue(m[2] ?? '')
  }
  return out
}

function cleanValue(raw: string): string {
  const v = raw.trim()
  const quoted = /^(["'])(.*?)\1/.exec(v)
  if (quoted) return quoted[2] ?? ''
  if (/^["']/.test(v)) return v.slice(1).trim()
  if (v.startsWith('[')) {
    const inner = v.slice(1).split(']')[0] ?? ''
    return inner
      .replace(/["']/g, '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .join(', ')
  }
  return v.replace(/(^|\s)#.*$/, '').trim()
}
