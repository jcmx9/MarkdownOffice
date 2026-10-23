// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, type WidgetType } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { MEMO_MERMAID, renderMermaid } from '../../../src/core/mermaid'
import { MEMO_PREVIEW } from '../../../src/core/preview-spec'
import { loadTypstPlugin, type TypstPlugin, TypstPluginError } from '../../../src/core/typst-plugin'
import {
  createDiagrams,
  DIAGRAM_EMPTY,
  DIAGRAM_FAILED,
  type DiagramsOptions,
  diagramsRefresh,
  fitDiagramWidth,
  lengthToPx,
} from '../../../src/renderer/editor/diagrams'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { presentMode } from '../../../src/renderer/editor/mode'
import { previewSource, setPreviewSource } from '../../../src/renderer/editor/preview-source'
import { previewView } from '../../../src/renderer/editor/rendered'
import { parsed } from './parsed'

const SVG_NS = 'http://www.w3.org/2000/svg'
const enc = new TextEncoder()
const dec = new TextDecoder()

/** A drawing with a background rect (as mmdr draws) and the source as its label. */
const drawing = (label: string, w = 200, h = 100) =>
  `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/><text x="10" y="20">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text></svg>`
/** What mmdr draws for a source it cannot lay out: only the background and the marker defs. */
const EMPTY = `<svg xmlns="${SVG_NS}" width="8" height="8" viewBox="0 0 8 8"><rect x="0" y="0" width="8" height="8" fill="#ffffff"/><defs><marker id="arrow-0"><path d="M 0 0 L 10 5 z"/></marker></defs></svg>`

const FLOW = 'flowchart TD\n  A --> B'
const NOTE = `Text davor\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nText danach`
const IN_BLOCK = NOTE.indexOf('A -->')
const AFTER = NOTE.length

interface Fake {
  plugin: TypstPlugin
  /** The source of every render call. */
  sources: string[]
}

function fakePlugin(draw: (source: string) => string = drawing): Fake {
  const sources: string[] = []
  return {
    sources,
    plugin: {
      call(_name, code) {
        const source = dec.decode(code)
        sources.push(source)
        return enc.encode(draw(source))
      },
    },
  }
}

function make(
  doc: string,
  cursor: number,
  options: DiagramsOptions,
  extra: Extension[] = [previewView.of(true)],
) {
  const d = createDiagrams({ warn: () => {}, ...options })
  const state = parsed(
    EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [
        markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
        previewSource,
        ...extra,
        d.extension,
      ],
    }),
  )
  return { d, state }
}

/** The state once the plugin has loaded (what the view plugin dispatches then). */
async function settled(d: ReturnType<typeof createDiagrams>, state: EditorState) {
  await d.ready()
  return state.update({ effects: diagramsRefresh.of(null) }).state
}

function shown(d: ReturnType<typeof createDiagrams>, state: EditorState) {
  const out: { range: string; widget: WidgetType }[] = []
  state.field(d.field).deco.between(0, state.doc.length, (from, to, deco) => {
    out.push({
      range: `${(deco.spec as { rf: string }).rf}@${from}-${to}`,
      widget: deco.spec.widget as WidgetType,
    })
  })
  return out
}

const blockFrom = NOTE.indexOf('```mermaid')
const blockTo = NOTE.indexOf('```\n\nText danach') + 3

/** A stub view for toDOM (no measuring: requestMeasure is missing, as in tables.test.ts). */
const stubView = {} as EditorView

describe('diagram widget', () => {
  it('replaces a rendered mermaid block by the diagram', async () => {
    const fake = fakePlugin()
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin })
    const next = await settled(d, state)
    expect(shown(d, next).map((s) => s.range)).toEqual([`diagram@${blockFrom}-${blockTo}`])
    const dom = shown(d, next)[0]?.widget.toDOM(stubView) as HTMLElement
    expect(dom.className).toBe('mdo-diagram')
    expect(dom.querySelector('svg text')?.textContent).toBe(FLOW)
  })

  it('passes the text between the fences, without a trailing newline, like Typst’s it.text', async () => {
    const fake = fakePlugin()
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin })
    await settled(d, state)
    expect(fake.sources).toEqual([FLOW])
  })

  it('reads a CRLF note as Typst does (\\n line ends)', async () => {
    const fake = fakePlugin()
    const crlf = 'x\r\n\r\n```mermaid\r\nflowchart TD\r\n  A --> B\r\n```\r\n'
    // Mixed-EOL notes keep \r in the lines (lineSeparator \n), see setup.ts.
    const { d, state } = make(crlf, 0, { load: async () => fake.plugin }, [
      previewView.of(true),
      EditorState.lineSeparator.of('\n'),
    ])
    await settled(d, state)
    expect(fake.sources).toEqual([FLOW])
  })

  it('draws an unclosed block up to the end of the note (the fence runs to the end)', async () => {
    const fake = fakePlugin()
    const { d, state } = make(`x\n\n\`\`\`mermaid\n${FLOW}`, 0, { load: async () => fake.plugin })
    await settled(d, state)
    expect(fake.sources).toEqual([FLOW])
  })

  it('draws only the language mermaid (memo.typ: raw.where(lang: "mermaid"))', async () => {
    const fake = fakePlugin()
    const doc = `x\n\n\`\`\`mmd\n${FLOW}\n\`\`\`\n\n\`\`\`js\nlet a\n\`\`\`\n\n\`\`\`mermaid title\n${FLOW}\n\`\`\``
    const { d, state } = make(doc, 0, { load: async () => fake.plugin })
    const next = await settled(d, state)
    expect(shown(d, next)).toHaveLength(1)
    expect(fake.sources).toEqual([FLOW])
  })

  it.each([
    ['the cursor is inside', IN_BLOCK, IN_BLOCK],
    ['the cursor is on the opening fence', blockFrom, blockFrom],
    ['a selection reaches into the block', 0, IN_BLOCK],
  ])('shows the source when %s', async (_name, anchor, head) => {
    const fake = fakePlugin()
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin })
    const next = await settled(d, state)
    const moved = next.update({ selection: { anchor, head } }).state
    expect(shown(d, moved)).toEqual([])
  })

  it('shows the source outside the Preview (Code view)', async () => {
    const fake = fakePlugin()
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin }, [])
    const next = await settled(d, state)
    expect(shown(d, next)).toEqual([])
    // Not even loaded: the plugin waits for the first diagram that is shown.
    expect(fake.sources).toEqual([])
  })

  it('draws in Present', async () => {
    const fake = fakePlugin()
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin }, [
      previewView.of(true),
      presentMode.of(true),
    ])
    expect(shown(d, await settled(d, state)).map((s) => s.range)).toEqual([
      `diagram@${blockFrom}-${blockTo}`,
    ])
  })

  it('loads the plugin once, on the first shown diagram', async () => {
    const fake = fakePlugin()
    const load = vi.fn(async () => fake.plugin)
    const { d, state } = make('kein Diagramm', 0, { load })
    await d.ready()
    expect(load).not.toHaveBeenCalled()
    const insert = `\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nx`
    // The cursor ends up after the block (on "x…"), not in it.
    const next = state.update({
      changes: { from: 0, insert },
      selection: { anchor: insert.length },
    })
    const after = await settled(d, parsed(next.state))
    expect(load).toHaveBeenCalledTimes(1)
    expect(shown(d, after)).toHaveLength(1)
  })

  it('typing elsewhere does not re-render a diagram', async () => {
    const fake = fakePlugin()
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin })
    let s = await settled(d, state)
    const first = shown(d, s)[0]?.widget
    for (const ch of 'abc') s = s.update({ changes: { from: s.doc.length, insert: ch } }).state
    s = s.update({ changes: { from: 0, insert: 'Neu ' } }).state
    expect(fake.sources).toHaveLength(1)
    const now = shown(d, s)[0]?.widget
    // Same drawing: CodeMirror keeps the widget's DOM (eq), nothing is redrawn.
    expect(first && now?.eq(first as never)).toBe(true)
  })

  it('draws a second block with the same source from the cache', async () => {
    const fake = fakePlugin()
    const doc = `${NOTE}\n\n\`\`\`mermaid\n${FLOW}\n\`\`\``
    const { d, state } = make(doc, 0, { load: async () => fake.plugin })
    const next = await settled(d, state)
    expect(shown(d, next)).toHaveLength(2)
    expect(fake.sources).toHaveLength(1)
  })

  it('keeps the source when the set draws no diagrams (valid .preview.yaml without mermaid:)', async () => {
    const fake = fakePlugin()
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin })
    const spec = { ...MEMO_PREVIEW, mermaid: null }
    const next = state.update({
      effects: setPreviewSource.of({ set: 'plain', spec, profile: {}, signature: null }),
    }).state
    expect(shown(d, await settled(d, next))).toEqual([])
    expect(fake.sources).toEqual([])
  })

  it('redraws with the set’s options when the set changes', async () => {
    const fake = fakePlugin()
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin })
    const first = await settled(d, state)
    const spec = { ...MEMO_PREVIEW, mermaid: { ...MEMO_MERMAID, baseTheme: 'default' } }
    const next = first.update({
      effects: setPreviewSource.of({ set: 'other', spec, profile: {}, signature: null }),
    }).state
    expect(shown(d, next)).toHaveLength(1)
    expect(fake.sources).toHaveLength(2)
  })

  it('falls back to the source when the plugin cannot be loaded', async () => {
    const warn = vi.fn()
    const doc = `${NOTE}\n\n\`\`\`mermaid\npie\n\`\`\`\n`
    const { d, state } = make(doc, 0, {
      load: async () => {
        throw new Error('no wasm')
      },
      warn,
    })
    const next = await settled(d, state)
    const ranges = shown(d, next).map((s) => s.range.split('@')[0])
    // No diagram replaces the source; a notice line follows each block.
    expect(ranges).toEqual(['diagram-notice', 'diagram-notice'])
    const notice = shown(d, next)[0]?.widget.toDOM(stubView) as HTMLElement
    expect(notice.textContent).toBe(DIAGRAM_FAILED)
    // Typing on: still one warning per session.
    const later = next.update({ changes: { from: 0, insert: 'x' } }).state
    shown(d, later)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('keeps the instance after the plugin’s own error, drops it after a trap', async () => {
    let instances = 0
    const load = vi.fn(async (): Promise<TypstPlugin> => {
      instances++
      return {
        call(_name, code) {
          const source = dec.decode(code)
          if (source === 'error') throw new TypstPluginError('parse error')
          if (source === 'trap') throw new WebAssembly.RuntimeError('unreachable')
          return enc.encode(drawing(source))
        },
      }
    })
    const warn = vi.fn()
    const block = (s: string) => `\`\`\`mermaid\n${s}\n\`\`\``
    const doc = [block('error'), block('pie'), block('trap'), 'x'].join('\n\n')
    const { d, state } = make(doc, doc.length, { load, warn })
    let s = await settled(d, state)
    // After the trap the next diagram needs a fresh instance.
    s = s.update({ changes: { from: s.doc.length, insert: `\n\n${block('gantt')}\n\ny` } }).state
    s = await settled(d, parsed(s))
    expect(instances).toBe(2)
    const kinds = shown(d, s).map((x) => x.range.split('@')[0])
    expect(kinds).toEqual(['diagram-notice', 'diagram', 'diagram-notice', 'diagram'])
    // One warning per reason: the plugin's error and the trap.
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('falls back to the source when the sanitiser throws or rejects the SVG', async () => {
    const fake = fakePlugin()
    const sanitize = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new RangeError('Maximum call stack size exceeded')
      })
      .mockImplementationOnce(() => null)
    const doc = `\`\`\`mermaid\na\n\`\`\`\n\n\`\`\`mermaid\nb\n\`\`\`\n\nx`
    const { d, state } = make(doc, doc.length, { load: async () => fake.plugin, sanitize })
    const next = await settled(d, state)
    expect(shown(d, next).map((x) => x.range.split('@')[0])).toEqual([
      'diagram-notice',
      'diagram-notice',
    ])
  })

  it('shows an empty drawing like the PDF, with a quiet notice', async () => {
    const fake = fakePlugin(() => EMPTY)
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin })
    const next = await settled(d, state)
    const dom = shown(d, next)[0]?.widget.toDOM(stubView) as HTMLElement
    expect(dom.querySelector('svg')).not.toBeNull()
    expect(dom.querySelector('.mdo-diagram-notice')?.textContent).toBe(DIAGRAM_EMPTY)
  })

  it('gives the shown SVG a deterministic id prefix', async () => {
    const fake = fakePlugin(
      () =>
        `<svg xmlns="${SVG_NS}" width="20" height="10" viewBox="0 0 20 10"><defs><marker id="m"><path d="M0 0"/></marker></defs><path d="M0 0 L5 5" marker-end="url(#m)"/></svg>`,
    )
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin })
    const dom = shown(d, await settled(d, state))[0]?.widget.toDOM(stubView) as HTMLElement
    expect(dom.querySelector('marker')?.getAttribute('id')).toMatch(/^mdo-dg\d+-m$/)
  })

  it('gives every shown copy of a cached drawing its own ids (two identical blocks)', async () => {
    const fake = fakePlugin(
      () =>
        `<svg xmlns="${SVG_NS}" width="20" height="10" viewBox="0 0 20 10"><defs><marker id="m"><path d="M0 0"/></marker><linearGradient id="g"><stop offset="0"/></linearGradient></defs><path id="e" d="M0 0 L5 5" marker-end="url(#m)" stroke="url(#g)"/></svg>`,
    )
    const block = `\`\`\`mermaid\n${FLOW}\n\`\`\``
    const doc = `${block}\n\n${block}\n\nx`
    const { d, state } = make(doc, doc.length, { load: async () => fake.plugin })
    const widgets = shown(d, await settled(d, state)).map((s) => s.widget)
    expect(widgets).toHaveLength(2)
    // One drawing for both blocks, two DOM copies.
    expect(fake.sources).toHaveLength(1)
    const doms = widgets.map((w) => w.toDOM(stubView) as HTMLElement)
    const idsOf = (dom: HTMLElement) =>
      Array.from(dom.querySelectorAll('[id]')).map((e) => e.getAttribute('id') as string)
    const [a, b] = doms.map(idsOf)
    expect(a).toHaveLength(3)
    expect(b).toHaveLength(3)
    expect(a?.filter((id) => b?.includes(id))).toEqual([])
    for (const id of [...(a ?? []), ...(b ?? [])]) expect(id).toMatch(/^mdo-dg\d+-[meg]$/)
    // Every url(#…) points at an id of its own copy.
    for (const dom of doms) {
      const own = new Set(idsOf(dom))
      const refs = Array.from(dom.querySelectorAll('*')).flatMap((el) =>
        Array.from(el.attributes)
          .map((attr) => /^url\(#(.+)\)$/.exec(attr.value)?.[1])
          .filter((v) => v !== undefined),
      )
      expect(refs).toHaveLength(2)
      for (const ref of refs) expect(own.has(ref)).toBe(true)
    }
    // A redraw of the same widget gets fresh ids too (CodeMirror may call toDOM again).
    const again = idsOf(widgets[0]?.toDOM(stubView) as HTMLElement)
    expect(again.filter((id) => a?.includes(id))).toEqual([])
  })

  it('reads a px size as its number (natural size for the fit and the height estimate)', async () => {
    const fake = fakePlugin(
      () =>
        `<svg xmlns="${SVG_NS}" width="400px" height="200px" viewBox="0 0 400 200"><text x="1" y="1">x</text></svg>`,
    )
    const { d, state } = make(NOTE, AFTER, { load: async () => fake.plugin })
    const widget = shown(d, await settled(d, state))[0]?.widget as WidgetType
    // 200px is below memo's 12cm max-height: the natural height plus the spacing.
    expect(widget.estimatedHeight).toBeCloseTo(200 + 2 * 18.7)
  })

  it('click on the diagram moves the cursor into the block (source for editing)', async () => {
    const fake = fakePlugin()
    const d = createDiagrams({ load: async () => fake.plugin, warn: () => {} })
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: parsed(
        EditorState.create({
          doc: NOTE,
          selection: { anchor: AFTER },
          extensions: [
            markdown({ base: markdownLanguage }),
            previewSource,
            previewView.of(true),
            d.extension,
          ],
        }),
      ),
    })
    // The view plugin redraws once the plugin is there.
    await d.ready()
    await Promise.resolve()
    const wrap = view.dom.querySelector('.mdo-diagram') as HTMLElement
    expect(wrap).not.toBeNull()
    wrap.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    expect(view.state.selection.main.head).toBe(blockFrom)
    expect(view.dom.querySelector('.mdo-diagram')).toBeNull()
    view.destroy()
    parent.remove()
  })
})

describe('lengthToPx', () => {
  it.each([
    ['12cm', (12 * 96) / 2.54],
    ['120mm', (120 * 96) / 25.4],
    ['300pt', 400],
    ['2.5in', 240],
    ['12', null],
    ['1em', null],
  ])('%s', (len, px) => {
    const got = lengthToPx(len)
    if (px === null) expect(got).toBeNull()
    else expect(got).toBeCloseTo(px, 9)
  })
})

describe('fitDiagramWidth (memo.typ: min(1, width / natural, max-height / natural))', () => {
  const maxH = (12 * 96) / 2.54 // 453.5 px
  it('keeps a small diagram at its natural size (never enlarged)', () => {
    expect(fitDiagramWidth({ width: 200, height: 100 }, 548, maxH, 1)).toBe(200)
  })
  it('narrows a wide diagram to the text width', () => {
    expect(fitDiagramWidth({ width: 1096, height: 100 }, 548, maxH, 1)).toBe(548)
  })
  it('scales a tall diagram down to the max height', () => {
    // 1000 high -> factor 453.5 / 1000
    expect(fitDiagramWidth({ width: 300, height: 1000 }, 548, maxH, 1)).toBeCloseTo(
      300 * (maxH / 1000),
      9,
    )
  })
  it('takes the smaller factor when both limits apply', () => {
    const w = fitDiagramWidth({ width: 2000, height: 2000 }, 548, maxH, 1)
    expect(w).toBeCloseTo(2000 * Math.min(548 / 2000, maxH / 2000), 9)
  })
  it('scales natural size and max height with the zoom, the text width is measured', () => {
    // At zoom 2 a 300 px diagram is 600 px wide; the text width (measured) is 1096.
    expect(fitDiagramWidth({ width: 300, height: 100 }, 1096, maxH, 2)).toBe(600)
    expect(fitDiagramWidth({ width: 300, height: 1000 }, 1096, maxH, 2)).toBeCloseTo(
      600 * ((maxH * 2) / 2000),
      9,
    )
  })
  it('caps the width only when the set has no max-height (0)', () => {
    expect(fitDiagramWidth({ width: 300, height: 1000 }, 548, 0, 1)).toBe(300)
    expect(fitDiagramWidth({ width: 1096, height: 3000 }, 548, 0, 1)).toBe(548)
  })
  it('ignores an unmeasured text width', () => {
    expect(fitDiagramWidth({ width: 300, height: 100 }, 0, maxH, 1)).toBe(300)
  })
})

const WASM = join(__dirname, '../../../build/pipeline-assets/vendor/mmdr/typst_mmdr.wasm')
const ROOT = join(__dirname, '../../..')

describe.skipIf(!existsSync(WASM))(
  'the e2e reference (tests/fixtures/mermaid/flowchart.svg)',
  () => {
    it('is what the block’s it.text draws (the fixture file’s trailing newline changes nothing)', async () => {
      // The parity script draws the whole fixture file, newline included; the preview and Typst
      // draw the block's text without it. tests/e2e/diagrams.spec.ts relies on both being equal.
      const plugin = await loadTypstPlugin(new Uint8Array(readFileSync(WASM)))
      const file = readFileSync(join(ROOT, 'pipeline/tests/fixtures/mermaid/flowchart.mmd'), 'utf8')
      const ref = readFileSync(join(ROOT, 'tests/fixtures/mermaid/flowchart.svg'), 'utf8')
      expect(file.endsWith('\n')).toBe(true)
      expect(renderMermaid(plugin, file.replace(/\n$/, ''), MEMO_MERMAID)).toBe(ref)
    })
  },
)
