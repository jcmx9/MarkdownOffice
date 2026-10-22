import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const theme = read('src/renderer/theme.css')
const styles = read('src/renderer/styles.css')
const app = read('src/renderer/app.ts')

/** The set-token block: everything a set may override, with memo's values as defaults. */
function tokenBlock(): Map<string, string> {
  const begin = theme.indexOf('/* set tokens: begin */')
  const end = theme.indexOf('/* set tokens: end */')
  expect(begin).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(begin)
  const tokens = new Map<string, string>()
  const body = theme.slice(begin, end).replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of body.matchAll(/(--mdo-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(m[1] as string, (m[2] as string).trim().replace(/\s+/g, ' '))
  }
  return tokens
}

const TOKEN_NAMES = [
  '--mdo-body-font',
  '--mdo-body-size',
  '--mdo-body-weight',
  '--mdo-bold-weight',
  '--mdo-line-height',
  '--mdo-align',
  '--mdo-par-gap',
  '--mdo-measure',
  '--mdo-heading-font',
  '--mdo-heading-align',
  '--mdo-h1-font',
  '--mdo-h2-font',
  '--mdo-h3-font',
  '--mdo-h1-size',
  '--mdo-h2-size',
  '--mdo-h3-size',
  '--mdo-h1-weight',
  '--mdo-h2-weight',
  '--mdo-h3-weight',
  '--mdo-h1-color',
  '--mdo-h2-color',
  '--mdo-h3-color',
  '--mdo-h1-rule',
  '--mdo-h3-decoration',
  '--mdo-table-font',
  '--mdo-table-size',
  '--mdo-table-weight',
  '--mdo-table-tracking',
  '--mdo-code-size',
  '--mdo-titleblock-align',
]

const scaled = (len: string) => `calc(${len} * var(--mdo-scale, 1))`

describe('set tokens in theme.css', () => {
  it('lists the 30 tokens of the plan', () => {
    expect(new Set(TOKEN_NAMES).size).toBe(30)
  })

  it.each(TOKEN_NAMES)('declares %s in the set-token block', (name) => {
    expect(tokenBlock().has(name)).toBe(true)
  })

  it('declares the tokens on .cm-editor', () => {
    const begin = theme.indexOf('/* set tokens: begin */')
    const open = theme.lastIndexOf('{', begin)
    const selector = theme.slice(theme.lastIndexOf('}', open) + 1, open)
    expect(selector.replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('.cm-editor')
  })

  it('writes every absolute default as calc(<len> * var(--mdo-scale, 1))', () => {
    for (const [name, value] of tokenBlock()) {
      if (!/\d(pt|mm|px|cm|in)/.test(value)) continue
      expect(value, name).toMatch(/^calc\(-?[\d.]+(pt|mm|px|cm|in) \* var\(--mdo-scale, 1\)\)$/)
    }
  })

  it('keeps memo values: 145mm measure, 14/12/10pt headings, 9pt table and code', () => {
    const t = tokenBlock()
    expect(t.get('--mdo-body-size')).toBe(scaled('10pt'))
    expect(t.get('--mdo-measure')).toBe(scaled('145mm'))
    expect(t.get('--mdo-h1-size')).toBe(scaled('14pt'))
    expect(t.get('--mdo-h2-size')).toBe(scaled('12pt'))
    expect(t.get('--mdo-h3-size')).toBe(scaled('10pt'))
    expect(t.get('--mdo-table-size')).toBe(scaled('9pt'))
    expect(t.get('--mdo-code-size')).toBe(scaled('9pt'))
    expect(t.get('--mdo-body-font')).toBe('var(--mdo-font-sans)')
    expect(t.get('--mdo-heading-font')).toBe('var(--mdo-font-serif)')
    expect(t.get('--mdo-align')).toBe('justify')
    expect(t.get('--mdo-par-gap')).toBe('1.1em')
    expect(t.get('--mdo-line-height')).toBe('1.5')
    expect(t.get('--mdo-h1-weight')).toBe('560')
    expect(t.get('--mdo-h3-weight')).toBe('400')
    expect(t.get('--mdo-bold-weight')).toBe('600')
    expect(t.get('--mdo-table-weight')).toBe('500')
    expect(t.get('--mdo-table-tracking')).toBe('-0.02em')
    expect(t.get('--mdo-h1-rule')).toBe('var(--mdo-hairline)')
    expect(t.get('--mdo-h3-decoration')).toBe('underline')
    expect(t.get('--mdo-titleblock-align')).toBe('center')
  })

  it('never declares the app-owned scale', () => {
    expect(theme).not.toMatch(/--mdo-scale\s*:/)
  })

  it('Present keeps 70ch against set rules', () => {
    expect(theme).toMatch(/\.mdo-present \.cm-content\s*{[^}]*max-width:\s*70ch !important/)
  })

  it('no em measure and no inline body size left', () => {
    expect(theme).not.toContain('41.1em')
    expect(app).not.toContain("'--mdo-body-size'")
    expect(app).not.toContain("'--mdo-code-size'")
  })

  it('the editor host clips set styling', () => {
    expect(styles).toMatch(/#editor\s*{[^}]*contain:\s*paint/)
  })
})
