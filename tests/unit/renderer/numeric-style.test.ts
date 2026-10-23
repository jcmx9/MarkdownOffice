import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '../../..')
const theme = readFileSync(join(root, 'src/renderer/theme.css'), 'utf8')
const paragraphs = readFileSync(join(root, 'src/renderer/editor/paragraphs.ts'), 'utf8')

/**
 * The measuring clone (paragraphs.ts) sits in a copy of the scroller and content inside the
 * editor, so it must resolve the same figure style as the rendered line. happy-dom does not
 * resolve var() in computed styles, so this checks the mechanism: the style comes from the
 * scroller by inheritance, and neither the clone's rules nor its code set one of their own.
 */
describe('figure style of the measuring clone', () => {
  it('inherits the scroller rule: the copy has the scroller class and the editor scope', () => {
    expect(paragraphs).toContain('scroller.className = view.scrollDOM.className')
    expect(paragraphs).toContain('view.dom.append(scroller)')
    expect(theme).toMatch(
      /\.mdo-preview \.cm-scroller\s*{[^}]*font-variant-numeric:\s*var\(--mdo-numeric\)/,
    )
  })

  it('sets no figure style of its own on the clone', () => {
    expect(paragraphs).not.toMatch(/font-variant-numeric/)
    const cloneRules = [...theme.matchAll(/([^{}]*\.mdo-par-measure[^{}]*){([^}]*)}/g)]
    expect(cloneRules.length).toBeGreaterThan(0)
    for (const [, , body] of cloneRules) expect(body).not.toContain('font-variant-numeric')
  })
})
