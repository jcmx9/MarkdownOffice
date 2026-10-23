// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { Line } from '@codemirror/state'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ParagraphInput, SetLine } from '../../../src/core/paragraph/linebreak'
import { setParagraph } from '../../../src/core/paragraph/linebreak'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { requestTrie } from '../../../src/renderer/editor/hyphenation-tries'
import { presentMode } from '../../../src/renderer/editor/mode'
import type { ParagraphSettings } from '../../../src/renderer/editor/paragraph-settings'
import {
  domMeasurer,
  type LineMeasurer,
  lineElement,
  type Measured,
  onceWarner,
  paragraphs,
  walkLine,
} from '../../../src/renderer/editor/paragraphs'
import { previewPlugin } from '../../../src/renderer/editor/preview'
import { previewView } from '../../../src/renderer/editor/rendered'
import { typoMask } from '../../../src/renderer/editor/typo-mask'
import { parsed } from './parsed'

/** Every display character (widget text too) is 10 px wide in the fake layout. */
const ADV = 10

const RAGGED: ParagraphSettings = {
  justify: false,
  hyphenate: false,
  lang: 'de',
  costs: { hyphenation: 1, runt: 1 },
}
const JUSTIFIED: ParagraphSettings = { ...RAGGED, justify: true, hyphenate: true }

interface FakeOptions {
  /** Available width of the first line (from the first display char) and of the others. */
  first: number
  rest?: number
  /** Display chars whose text matches are reported as widget text (docPos -1). */
  widget?: string
  /** Report a broken layout: every x 0. */
  zero?: boolean
}

/**
 * The DOM walk of the real measurer (text, docPos as CodeMirror renders the line in
 * happy-dom), with fixed advances instead of a layout.
 */
function fakeMeasurer(o: FakeOptions): LineMeasurer {
  return {
    measure(view: EditorView, line: Line): Measured | null {
      const el = lineElement(view, line)
      if (!el) return null
      const { text, docPos } = walkLine(view, el)
      if (o.widget) {
        const at = text.indexOf(o.widget)
        for (let i = at; at >= 0 && i < at + o.widget.length; i++) docPos[i] = -1
      }
      const x = new Float64Array(text.length + 1)
      for (let i = 0; i <= text.length; i++) x[i] = o.zero ? 0 : i * ADV
      return {
        text,
        x,
        docPos,
        lineWidth: (n) => (n === 0 ? o.first : (o.rest ?? o.first)),
        hyphenWidth: () => ADV,
        fontSize: () => 16,
      }
    },
  }
}

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})

interface Made {
  view: EditorView
  calls: () => number
  decos: () => string[]
  warn: ReturnType<typeof vi.fn>
}

function make(
  doc: string,
  o: {
    cursor?: number
    anchor?: number
    settings?: ParagraphSettings
    measurer?: LineMeasurer
  } = {},
): Made {
  let calls = 0
  const engine = (p: ParagraphInput): SetLine[] => {
    calls++
    return setParagraph(p)
  }
  const warn = vi.fn()
  const plugin = paragraphs({
    measurer: o.measurer ?? fakeMeasurer({ first: 75 }),
    setParagraph: engine,
    settings: () => o.settings ?? RAGGED,
    warn,
  })
  const head = o.cursor ?? doc.length
  const state = parsed(
    EditorState.create({
      doc,
      selection: { anchor: o.anchor ?? head, head },
      extensions: [
        markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
        previewView.of(true),
        typoMask,
        previewPlugin,
        plugin,
        EditorView.lineWrapping,
      ],
    }),
  )
  const view = new EditorView({ state, parent: document.body })
  views.push(view)
  const decos = () => {
    const out: string[] = []
    view.plugin(plugin)?.decorations.between(0, view.state.doc.length, (from, to, d) => {
      out.push(`${(d.spec as { par: string }).par}@${from}${to > from ? `-${to}` : ''}`)
    })
    return out
  }
  return { view, calls: () => calls, decos, warn }
}

/** Runs CodeMirror's measure cycle and the plugin's follow-up dispatch until nothing changes. */
async function settle(view: EditorView): Promise<void> {
  for (let i = 0; i < 3; i++) {
    // EditorView.measure is public at runtime but internal in the typings.
    ;(view as unknown as { measure(): void }).measure()
    await new Promise((r) => setTimeout(r, 0))
  }
}

const breaks = (d: string[]) => d.filter((s) => /^(break|hyphen)@/.test(s))

beforeAll(async () => {
  await requestTrie('de')
})

describe('paragraphs set like Typst', () => {
  it("sets a rendered paragraph into the engine's lines", async () => {
    // 7.5 chars per line: first fit takes "aaa bbb" (70 px, the trailing space is free).
    const m = make('aaa bbb ccc ddd\n\nende')
    await settle(m.view)
    expect(m.decos()).toEqual(expect.arrayContaining(['line@0', 'break@8']))
    expect(breaks(m.decos())).toEqual(['break@8'])
    expect(m.view.dom.querySelectorAll('br.mdo-par-break')).toHaveLength(1)
    expect(m.view.dom.querySelector('.cm-line.mdo-par-set')).not.toBeNull()
    // the note's bytes never change
    expect(m.view.state.doc.toString()).toBe('aaa bbb ccc ddd\n\nende')
  })

  it('hyphenated break shows a hyphen widget', async () => {
    // "Silbentrennung" cannot fit 10 chars: first fit with hyphenation ends at a hyphen point.
    const m = make('Silbentrennung ist schwer\n\nende', {
      settings: { ...RAGGED, hyphenate: true },
      measurer: fakeMeasurer({ first: 100 }),
    })
    await settle(m.view)
    const b = breaks(m.decos())
    expect(b[0]).toBe('hyphen@6')
    const hy = m.view.dom.querySelector('.mdo-par-hyphen')
    expect(hy?.textContent).toBe('-')
    expect(hy?.nextElementSibling?.matches('br.mdo-par-break')).toBe(true)
  })

  it('justified line gets word-spacing mark, last line none', async () => {
    const m = make('aaa bbb ccc ddd eee\n\nende', {
      settings: { ...JUSTIFIED, hyphenate: false },
    })
    await settle(m.view)
    const d = m.decos()
    // Each of the first two lines holds 70 px of 75 with one space: +5 px per space. The mark
    // stops before the trailing space, which stays natural before the break.
    expect(d).toEqual(expect.arrayContaining(['adjust:5@0-7', 'adjust:5@8-15']))
    expect(d.filter((s) => s.startsWith('adjust'))).toHaveLength(2)
    const span = m.view.dom.querySelector('.mdo-par-adjust') as HTMLElement | null
    expect(span?.style.wordSpacing).toBe('5px')
  })

  it('cursor line has no paragraph decorations', async () => {
    const doc = 'aaa bbb ccc ddd\n\nfff ggg hhh iii'
    const m = make(doc, { cursor: 2 })
    await settle(m.view)
    const d = m.decos()
    expect(d.some((s) => /@([0-9]|1[0-5])(-|$)/.test(s))).toBe(false)
    expect(d).toEqual(expect.arrayContaining(['line@17', 'break@25']))
  })

  it('selection spanning two paragraphs leaves both unset', async () => {
    const doc = 'aaa bbb ccc ddd\n\nfff ggg hhh iii\n\njjj kkk lll mmm'
    const m = make(doc, { anchor: 3, cursor: 20 })
    await settle(m.view)
    expect(m.decos().filter((s) => s.startsWith('line'))).toEqual(['line@34'])
  })

  it('headings, tables and code lines are never set', async () => {
    const doc = [
      '# aaa bbb ccc ddd eee',
      '',
      '| aaa bbb ccc | ddd eee fff |',
      '|---|---|',
      '| ggg hhh iii | jjj kkk lll |',
      '',
      '```',
      'aaa bbb ccc ddd eee',
      '```',
      '',
      '    aaa bbb ccc ddd eee',
      '',
      'Titel aaa bbb ccc',
      '===',
      '',
      '> [!NOTE]',
      '> aaa bbb ccc ddd',
      '',
      'ende',
    ].join('\n')
    const m = make(doc)
    await settle(m.view)
    const alertBody = doc.indexOf('> aaa bbb ccc ddd')
    // only the alert's body line is a paragraph
    expect(m.decos().filter((s) => s.startsWith('line'))).toEqual([`line@${alertBody}`])
  })

  it('falls back when the measurer returns zero widths', async () => {
    const m = make('aaa bbb ccc ddd\n\nfff ggg hhh iii\n\nende', {
      measurer: fakeMeasurer({ first: 75, zero: true }),
    })
    await settle(m.view)
    expect(m.decos()).toEqual([])
    expect(m.calls()).toBe(0)
    expect(m.warn).toHaveBeenCalled()
    expect(String(m.warn.mock.calls[0]?.[0])).toMatch(/width/)
  })

  it('falls back when the measurer has no layout or the engine throws', async () => {
    const none = make('aaa bbb ccc ddd\n\nende', { measurer: { measure: () => null } })
    await settle(none.view)
    expect(none.decos()).toEqual([])
    expect(none.warn).toHaveBeenCalled()

    const warn = vi.fn()
    const plugin = paragraphs({
      measurer: fakeMeasurer({ first: 75 }),
      setParagraph: () => {
        throw new Error('boom')
      },
      settings: () => RAGGED,
      warn,
    })
    const view = new EditorView({
      state: parsed(
        EditorState.create({
          doc: 'aaa bbb ccc ddd\n\nende',
          selection: { anchor: 20 },
          extensions: [
            markdown({ base: markdownLanguage }),
            previewView.of(true),
            previewPlugin,
            plugin,
          ],
        }),
      ),
      parent: document.body,
    })
    views.push(view)
    await settle(view)
    expect(view.plugin(plugin)?.decorations.size).toBe(0)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/boom/)
  })

  it('typing in the cursor paragraph leaves other set lines cached', async () => {
    const doc = 'aaa bbb ccc ddd\n\nfff ggg hhh iii\n\njjj kkk lll mmm'
    const m = make(doc, { cursor: doc.length })
    await settle(m.view)
    const before = m.calls()
    expect(before).toBe(2)
    for (const ch of ' nnn') {
      m.view.dispatch({
        changes: { from: m.view.state.doc.length, insert: ch },
        selection: { anchor: m.view.state.doc.length + 1 },
      })
      await settle(m.view)
    }
    expect(m.calls()).toBe(before)
    expect(m.decos()).toEqual(expect.arrayContaining(['line@0', 'line@17']))
    // Leaving the paragraph sets it, once (the first one is now the cursor's).
    m.view.dispatch({ selection: { anchor: 0 } })
    await settle(m.view)
    expect(m.calls()).toBe(before + 1)
    // Back into the last one: the first paragraph's result comes from the cache.
    m.view.dispatch({ selection: { anchor: m.view.state.doc.length } })
    await settle(m.view)
    expect(m.calls()).toBe(before + 1)
    expect(m.decos()).toEqual(expect.arrayContaining(['line@0']))
  })

  it('sets a paragraph with marks, links, code and widgets', async () => {
    const doc =
      'Ein **fettes** Wort, ein [Link](https://example.com/pfad) und `code hier` sowie "Zitat" mit Ende.\n\nende'
    // "code hier" reported as one widget: never broken inside, although it does not fit.
    const m = make(doc, { measurer: fakeMeasurer({ first: 60, widget: 'code hier' }) })
    await settle(m.view)
    const at = breaks(m.decos()).map((s) => Number(s.split('@')[1]))
    expect(at.length).toBeGreaterThan(5)
    const code = doc.indexOf('code hier')
    expect(at.some((p) => p > code && p < code + 'code hier'.length)).toBe(false)
    // never inside hidden source (marks, the link's destination)
    const url = doc.indexOf('](')
    expect(at.some((p) => p > url && p <= doc.indexOf(') und'))).toBe(false)
    // every break starts a word: only hidden marks (`**`, `[`, a backtick) after the space
    for (const p of at) expect(doc.slice(0, p).replace(/[*`[]+$/, '')).toMatch(/ $/)
    // the typographic quotes are shown in the set paragraph too
    expect(m.view.dom.textContent).toContain('„Zitat“')
  })

  it('list item uses the narrower continuation width', async () => {
    // The first display char is the space after the bullet: the item's text starts 10 px in.
    const wide = make('- aaa bbb ccc ddd eee fff\n\nende', {
      measurer: fakeMeasurer({ first: 85, rest: 75 }),
    })
    await settle(wide.view)
    expect(breaks(wide.decos())).toEqual(['break@10', 'break@18'])
    const narrow = make('- aaa bbb ccc ddd eee fff\n\nende', {
      measurer: fakeMeasurer({ first: 85, rest: 45 }),
    })
    await settle(narrow.view)
    expect(breaks(narrow.decos())).toEqual(['break@10', 'break@14', 'break@18', 'break@22'])
  })

  it('Present sets the paragraph again under its own environment', async () => {
    const mode = new Compartment()
    let calls = 0
    const plugin = paragraphs({
      measurer: fakeMeasurer({ first: 75 }),
      setParagraph: (p) => {
        calls++
        return setParagraph(p)
      },
      settings: () => RAGGED,
      warn: () => {},
    })
    const view = new EditorView({
      state: parsed(
        EditorState.create({
          doc: 'aaa bbb ccc ddd\n\nende',
          selection: { anchor: 20 },
          extensions: [
            markdown({ base: markdownLanguage }),
            previewView.of(true),
            previewPlugin,
            plugin,
            mode.of([]),
          ],
        }),
      ),
      parent: document.body,
    })
    views.push(view)
    await settle(view)
    expect(calls).toBe(1)
    view.dispatch({ effects: mode.reconfigure(presentMode.of(true)) })
    // no result of the editor's environment is shown in Present's column
    expect(view.plugin(plugin)?.decorations.size).toBe(0)
    await settle(view)
    expect(calls).toBe(2)
    expect(view.plugin(plugin)?.decorations.size).toBeGreaterThan(0)
  })

  it('never breaks inside a no-break phrase', async () => {
    // "aaaa z." fits 7.5 chars, but memo's `z. B.` must stay together: it moves down whole.
    const m = make('aaaa z. B. cccc\n\nende', { measurer: fakeMeasurer({ first: 75 }) })
    await settle(m.view)
    expect(breaks(m.decos())).toEqual(['break@5', 'break@11'])
  })

  it('task items and quotes start at their text', async () => {
    // The task's display starts with the space after the box: its text starts 10 px in.
    const m = make('- [ ] aaa bbb ccc ddd\n\n> eee fff ggg hhh\n\nende', {
      measurer: fakeMeasurer({ first: 85, rest: 75 }),
    })
    await settle(m.view)
    const quote = '- [ ] aaa bbb ccc ddd\n\n'.length
    expect(breaks(m.decos())).toEqual(['break@14', `break@${quote + 10}`])
  })
})

describe('domMeasurer', () => {
  /** Index of a text position among the display chars of its `.cm-line` (clone or original). */
  function indexIn(node: Node, offset: number): number {
    const line = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('.cm-line')
    if (!line) return 0
    if (node === line) return offset === 0 ? 0 : (line.textContent ?? '').length
    let i = 0
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n === node) return i + offset
      if (!n.parentElement?.closest('.mdo-par-eol')) i += (n as Text).data.length
    }
    return i
  }

  it('reads text, doc offsets and x positions from a clone of the drawn line', async () => {
    const doc = 'Ein **fettes** "Wort" und mehr Text hier\n\nende'
    const m = make(doc, { measurer: fakeMeasurer({ first: 75 }) })
    await settle(m.view)
    // the line is set now: its break widgets must not show up in the measurement
    expect(m.view.dom.querySelectorAll('.mdo-par-eol').length).toBeGreaterThan(0)
    const line = m.view.state.doc.line(1)
    const rect = (left: number, width: number) =>
      ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 10,
        height: 10,
        x: left,
        y: 0,
      }) as DOMRect
    const ranges = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Range,
    ) {
      const a = indexIn(this.startContainer, this.startOffset)
      const b = indexIn(this.endContainer, this.endOffset)
      return rect(a * ADV, (b - a) * ADV)
    })
    const els = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return rect(0, this.textContent === '-' ? 4 : 800)
    })
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    try {
      const measured = domMeasurer().measure(m.view, line)
      expect(measured).not.toBeNull()
      if (!measured) return
      expect(measured.text).toBe('Ein fettes „Wort“ und mehr Text hier')
      const q = measured.text.indexOf('„')
      expect(measured.docPos[q]).toBe(-1)
      expect(measured.docPos[q + 1]).toBe(doc.indexOf('Wort'))
      expect(measured.docPos[4]).toBe(doc.indexOf('fettes'))
      expect([...measured.x.slice(0, 4)]).toEqual([0, 10, 20, 30])
      expect(measured.x[measured.text.length]).toBe(measured.text.length * ADV)
      expect(measured.hyphenWidth(3)).toBe(4)
      // Continuation lines: the content box (800 minus CodeMirror's 6 + 2 px line padding) minus
      // the space advance the trailing space keeps (0.2em fallback at 16 px). Line 0 counts
      // from the first char, which this fake layout puts 6 px left of the content box.
      expect(measured.lineWidth(1)).toBeCloseTo(800 - 8 - 0.2 * 16)
      expect(measured.lineWidth(0) - measured.lineWidth(1)).toBeCloseTo(6)
      // the measuring copy is gone again
      expect(m.view.dom.querySelectorAll('.mdo-par-measure')).toHaveLength(0)
    } finally {
      ranges.mockRestore()
      els.mockRestore()
      width.mockRestore()
    }
  })

  it('returns null without a layout (all widths zero)', async () => {
    const m = make('aaa bbb ccc ddd\n\nende', { measurer: fakeMeasurer({ first: 75 }) })
    await settle(m.view)
    expect(domMeasurer().measure(m.view, m.view.state.doc.line(1))).toBeNull()
    // a line that is not drawn (here: out of range of the DOM lookup) is null too
    const measurer = domMeasurer()
    measurer.begin?.(m.view, [m.view.state.doc.line(1), m.view.state.doc.line(3)])
    expect(measurer.measure(m.view, m.view.state.doc.line(3))).toBeNull()
    measurer.end?.()
  })
})

describe('onceWarner', () => {
  it('warns only once per session', () => {
    const sink = vi.fn()
    const warn = onceWarner(sink)
    warn('a')
    warn('b')
    expect(sink).toHaveBeenCalledTimes(1)
    expect(String(sink.mock.calls[0]?.[0])).toContain('a')
  })
})
