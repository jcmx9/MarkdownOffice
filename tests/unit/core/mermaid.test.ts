import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MEMO_MERMAID, type MermaidOptions, renderMermaid } from '../../../src/core/mermaid'
import { loadTypstPlugin, type TypstPlugin } from '../../../src/core/typst-plugin'

const WASM = join(__dirname, '../../../build/pipeline-assets/vendor/mmdr/typst_mmdr.wasm')
const skip = existsSync(WASM) ? false : `${WASM} missing – run npm run assets`
const dec = new TextDecoder()
const FLOW = 'flowchart LR\n  A[Start] --> B{Prüfen}\n  B -->|ja| C[Ende]'

/** Records the arguments and answers with a fixed SVG, to check what renderMermaid sends. */
function fakePlugin(svg: string) {
  const calls: { name: string; args: string[] }[] = []
  const plugin: TypstPlugin = {
    call(name, ...args) {
      calls.push({ name, args: args.map((a) => dec.decode(a)) })
      return new TextEncoder().encode(svg)
    },
  }
  return { plugin, calls }
}

describe('MEMO_MERMAID', () => {
  it('carries memo.typ’s mermaid arguments', () => {
    expect(MEMO_MERMAID.baseTheme).toBe('modern')
    expect(MEMO_MERMAID.layout).toEqual({ node_spacing: 25, rank_spacing: 35 })
    expect(MEMO_MERMAID.maxHeight).toBe('12cm')
    expect(MEMO_MERMAID.fontWeight).toBe(500)
    expect(Object.keys(MEMO_MERMAID.theme)).toHaveLength(17)
    expect(MEMO_MERMAID.theme.font_family).toBe('SourceSans3VF')
    expect(MEMO_MERMAID.theme.sequence_note_border).toBe('#e0c66a')
  })
})

describe('renderMermaid', () => {
  it('calls render(code, base_theme, theme_json, layout_json)', () => {
    const { plugin, calls } = fakePlugin('<svg></svg>')
    renderMermaid(plugin, FLOW, MEMO_MERMAID)
    expect(calls).toHaveLength(1)
    const [code, base, theme, layout] = calls[0]?.args ?? []
    expect(calls[0]?.name).toBe('render')
    expect(code).toBe(FLOW)
    expect(base).toBe('modern')
    expect(JSON.parse(theme ?? '')).toEqual(MEMO_MERMAID.theme)
    expect(JSON.parse(layout ?? '')).toEqual(MEMO_MERMAID.layout)
  })

  it('sends empty overrides for an empty theme or layout (mmdr: no override)', () => {
    const { plugin, calls } = fakePlugin('<svg></svg>')
    renderMermaid(plugin, 'pie', { ...MEMO_MERMAID, theme: {}, layout: {} })
    expect(calls[0]?.args.slice(2)).toEqual(['', ''])
  })

  it('puts the font weight before every font-family attribute, once each', () => {
    const { plugin } = fakePlugin('<svg font-family="a"><text font-family="b">x</text></svg>')
    expect(renderMermaid(plugin, FLOW, MEMO_MERMAID)).toBe(
      '<svg font-weight="500" font-family="a"><text font-weight="500" font-family="b">x</text></svg>',
    )
  })

  it('leaves the SVG alone without a font weight', () => {
    const svg = '<svg font-family="a"></svg>'
    const { plugin } = fakePlugin(svg)
    const opts: MermaidOptions = { ...MEMO_MERMAID, fontWeight: null }
    expect(renderMermaid(plugin, FLOW, opts)).toBe(svg)
  })

  it.skipIf(skip)('draws a flowchart with the real plugin, deterministically', async () => {
    const plugin = await loadTypstPlugin(new Uint8Array(readFileSync(WASM)))
    const a = renderMermaid(plugin, FLOW, MEMO_MERMAID)
    const b = renderMermaid(plugin, FLOW, MEMO_MERMAID)
    expect(a).toMatch(/^<svg/)
    expect(a).toContain('Prüfen')
    expect(a).toContain('font-weight="500" font-family=')
    expect(a).not.toContain('font-weight="500" font-weight="500"')
    expect(a).toBe(b)
  })
})
