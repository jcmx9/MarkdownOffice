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
  '--mdo-body-opsz',
  '--mdo-h1-opsz',
  '--mdo-h2-opsz',
  '--mdo-h3-opsz',
  '--mdo-word-spacing',
  '--mdo-numeric',
  '--mdo-table-numeric',
  '--mdo-list-indent',
  '--mdo-table-head-weight',
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
  it('lists the 39 tokens of the plan', () => {
    expect(new Set(TOKEN_NAMES).size).toBe(39)
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
    // the PDF's real weights (memo.typ weight-text 380, strong +180, weight-heading 470)
    expect(t.get('--mdo-body-weight')).toBe('380')
    expect(t.get('--mdo-bold-weight')).toBe('560')
    expect(t.get('--mdo-h1-weight')).toBe('470')
    expect(t.get('--mdo-h2-weight')).toBe('470')
    expect(t.get('--mdo-h3-weight')).toBe('380')
    expect(t.get('--mdo-table-head-weight')).toBe('680')
    // Typst sets opsz to the size in pt
    expect(t.get('--mdo-body-opsz')).toBe('10')
    expect(t.get('--mdo-h1-opsz')).toBe('14')
    expect(t.get('--mdo-h2-opsz')).toBe('12')
    expect(t.get('--mdo-h3-opsz')).toBe('10')
    expect(t.get('--mdo-list-indent')).toBe('1.12em')
    // the one token whose default is not memo's value: sets without it must not inherit it
    expect(t.get('--mdo-word-spacing')).toBe('0')
    // figure style: the second and third exception, sets without it keep the font's figures
    expect(t.get('--mdo-numeric')).toBe('normal')
    expect(t.get('--mdo-table-numeric')).toBe('normal')
    expect(t.get('--mdo-table-weight')).toBe('500')
    expect(t.get('--mdo-table-tracking')).toBe('-0.02em')
    expect(t.get('--mdo-h1-rule')).toBe('var(--mdo-hairline)')
    expect(t.get('--mdo-h3-decoration')).toBe('underline')
    expect(t.get('--mdo-titleblock-align')).toBe('center')
  })

  it('sets the optical size in pt on the scroller and the heading lines', () => {
    expect(theme).toMatch(
      /\.mdo-preview \.cm-scroller\s*{[^}]*font-variation-settings:\s*"opsz" var\(--mdo-body-opsz\)/,
    )
    for (const n of [1, 2, 3]) {
      expect(theme).toMatch(
        new RegExp(
          `\\.mdo-h${n}\\s*{[^}]*font-variation-settings:\\s*"opsz" var\\(--mdo-h${n}-opsz\\)`,
        ),
      )
    }
    expect(theme).not.toContain('font-optical-sizing: none')
  })

  it('applies the figure-style tokens to text and tables, never to code', () => {
    expect(theme).toMatch(
      /\.mdo-preview \.cm-scroller\s*{[^}]*font-variant-numeric:\s*var\(--mdo-numeric\)/,
    )
    expect(theme).toMatch(
      /\.mdo-table-head, \.mdo-table-row, \.mdo-table-delim\)\s*{[^}]*font-variant-numeric:\s*var\(--mdo-table-numeric\)/,
    )
    expect(theme).toMatch(
      /table\.mdo-table\s*{[^}]*font-variant-numeric:\s*var\(--mdo-table-numeric\)/,
    )
    expect(theme).toMatch(/\.mdo-code-inline\s*{[^}]*font-variant-numeric:\s*normal/)
    expect(theme).toMatch(
      /\.mdo-codeblock, \.mdo-codefence\)\s*{[^}]*font-variant-numeric:\s*normal/,
    )
    expect(theme).not.toMatch(/font-variant-numeric:\s*(oldstyle|lining)/)
  })

  it('widens the content box by one space advance (break-spaces counts the trailing space)', () => {
    expect(theme).toContain(
      'max-width: calc(var(--mdo-measure) + var(--mdo-space-advance, 0.2em) + 3em + 8px)',
    )
  })

  it('keeps word spacing off tables and code', () => {
    expect(theme).toMatch(
      /\.mdo-preview \.cm-line\s*{[^}]*word-spacing:\s*var\(--mdo-word-spacing\)/,
    )
    expect(theme).toMatch(
      /\.mdo-table-head, \.mdo-table-row, \.mdo-table-delim\)\s*{[^}]*word-spacing:\s*normal/,
    )
    expect(theme).toMatch(/\.mdo-codeblock, \.mdo-codefence\)\s*{[^}]*word-spacing:\s*normal/)
  })

  /** The declarations of the first rule whose selector ends exactly with `sel`. */
  function rule(sel: string): string {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`${esc}\\s*{([^}]*)}`).exec(theme)
    expect(m, sel).not.toBeNull()
    return (m?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  }

  it('hangs list items by the indent plus their own lead and number digits', () => {
    const r = rule('.mdo-preview .cm-line.mdo-list-item')
    expect(r).toContain(
      '--mdo-list-hang: calc( var(--mdo-list-indent) + var(--mdo-list-lead, 0) * var(--mdo-space-advance, 0.2em) + var(--mdo-list-extra, 0) * 1ch );',
    )
    // CodeMirror's 6px line padding stays: the marker lines up with the body text (I1)
    expect(r).toContain('padding-left: calc(6px + var(--mdo-list-hang));')
    expect(r).toContain('text-indent: calc(-1 * var(--mdo-list-hang));')
    // inline-blocks (marker slots) inherit text-indent and would shift their content
    expect(rule('.mdo-preview .cm-line.mdo-list-item *')).toContain('text-indent: 0;')
  })

  it('adds the hang to the padding of quotes and alerts (I2)', () => {
    expect(rule('.mdo-preview .cm-line.mdo-quote.mdo-list-item')).toContain(
      'padding-left: calc(2em + var(--mdo-list-hang));',
    )
    expect(rule('.mdo-preview .cm-line.mdo-alert.mdo-list-item')).toContain(
      'padding-left: calc(1em + var(--mdo-list-hang));',
    )
    // the combined rules come after the alert rule, so the alert one wins on alert lines
    const quote = theme.indexOf('.mdo-preview .cm-line.mdo-quote.mdo-list-item')
    const alert = theme.indexOf('.mdo-preview .cm-line.mdo-alert.mdo-list-item')
    expect(theme.indexOf('.mdo-preview .cm-line.mdo-alert {')).toBeLessThan(quote)
    expect(quote).toBeLessThan(alert)
  })

  it('fills the indent with marker + space for bullets, tasks and numbers', () => {
    const slot = 'calc(var(--mdo-list-indent) - 0.72em - var(--mdo-space-advance, 0.2em))'
    expect(rule('.mdo-preview .mdo-list-mark')).toContain(`margin-right: ${slot};`)
    expect(rule('.mdo-preview .mdo-task')).toContain(`margin: 0 ${slot} 0 0;`)
    expect(rule('.mdo-preview .mdo-ol-mark')).toContain(
      'min-width: calc( var(--mdo-list-indent) - var(--mdo-space-advance, 0.2em) + var(--mdo-list-extra, 0) * 1ch );',
    )
  })

  it('suppresses wrapping in no-break spans without collapsing their spaces', () => {
    const r = rule('.mdo-preview .mdo-nobreak')
    expect(r).toContain('text-wrap-mode: nowrap;')
    expect(r).not.toContain('white-space')
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
