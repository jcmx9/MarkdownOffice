// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { Line } from '@codemirror/state'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ParagraphInput, SetLine } from '../../../src/core/paragraph/linebreak'
import { setParagraph } from '../../../src/core/paragraph/linebreak'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { requestTrie } from '../../../src/renderer/editor/hyphenation-tries'
import { mdoMarkdown } from '../../../src/renderer/editor/markdown'
import { createMath } from '../../../src/renderer/editor/math'
import { presentMode } from '../../../src/renderer/editor/mode'
import type { ParagraphSettings } from '../../../src/renderer/editor/paragraph-settings'
import {
  domMeasurer,
  type LineMeasurer,
  lineElement,
  type Measured,
  onceWarner,
  type ParagraphsOptions,
  paragraphs,
  walkLine,
} from '../../../src/renderer/editor/paragraphs'
import { previewPlugin } from '../../../src/renderer/editor/preview'
import { previewView } from '../../../src/renderer/editor/rendered'
import { typoMask } from '../../../src/renderer/editor/typo-mask'
import { SET_ATTR, SetStyles } from '../../../src/renderer/ui/set-styles'
import { okEntry, stubService } from './math-stub'
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
    extra?: ParagraphsOptions
    /** The Markdown language (default: lang-markdown with front matter) and more extensions. */
    lang?: Extension
    extensions?: Extension[]
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
    ...o.extra,
  })
  const head = o.cursor ?? doc.length
  const state = parsed(
    EditorState.create({
      doc,
      selection: { anchor: o.anchor ?? head, head },
      extensions: [
        o.lang ?? markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
        previewView.of(true),
        typoMask,
        previewPlugin,
        ...(o.extensions ?? []),
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

  it('a line not drawn yet is silent and retried on the next measure', async () => {
    let tries = 0
    const real = fakeMeasurer({ first: 75 })
    const m = make('aaa bbb ccc ddd\n\nende', {
      measurer: {
        // The first measure finds no layout (fonts loading, line not drawn): expected.
        measure: (view, line) => (++tries === 1 ? null : real.measure(view, line)),
      },
    })
    await settle(m.view)
    expect(m.decos()).toEqual([])
    expect(m.warn).not.toHaveBeenCalled()
    // Not remembered as failed: the next measure (any update) sets it.
    m.view.dispatch({ selection: { anchor: m.view.state.doc.length } })
    await settle(m.view)
    expect(tries).toBe(2)
    expect(breaks(m.decos())).toEqual(['break@8'])
  })

  it('an engine error is warned even after transient failures, once per kind', async () => {
    const sink = vi.fn()
    let tries = 0
    const real = fakeMeasurer({ first: 75 })
    const m = make('aaa bbb ccc ddd\n\nfff ggg hhh iii\n\nende', {
      measurer: { measure: (view, line) => (++tries <= 2 ? null : real.measure(view, line)) },
      extra: {
        warn: onceWarner(sink),
        setParagraph: () => {
          throw new Error('boom')
        },
      },
    })
    await settle(m.view)
    m.view.dispatch({ selection: { anchor: m.view.state.doc.length } })
    await settle(m.view)
    expect(m.decos()).toEqual([])
    expect(sink).toHaveBeenCalledTimes(1)
    expect(String(sink.mock.calls[0]?.[0])).toMatch(/boom/)
    // Remembered as failed under this environment: not run again on the next update.
    const before = tries
    m.view.dispatch({ selection: { anchor: m.view.state.doc.length } })
    await settle(m.view)
    expect(tries).toBe(before)
  })

  it('falls back when the engine throws', async () => {
    const m = make('aaa bbb ccc ddd\n\nende', {
      extra: {
        setParagraph: () => {
          throw new Error('boom')
        },
      },
    })
    await settle(m.view)
    expect(m.decos()).toEqual([])
    expect(m.warn).toHaveBeenCalledWith(expect.stringMatching(/boom/), 'engine')
  })

  it('sets without hyphenation when the patterns cannot be loaded', async () => {
    const m = make('Silbentrennung ist schwer\n\nende', {
      settings: { ...RAGGED, hyphenate: true, lang: 'en' },
      measurer: fakeMeasurer({ first: 100 }),
      extra: {
        tries: {
          trieFor: () => undefined,
          requestTrie: () => Promise.reject(new Error('gone')),
        },
      },
    })
    await settle(m.view)
    expect(m.warn).toHaveBeenCalledWith(expect.stringMatching(/gone/), 'trie')
    // overfull word, then a normal break: no hyphen
    expect(breaks(m.decos())).toEqual(['break@15'])
    expect(m.calls()).toBe(1)
  })

  describe('width hysteresis', () => {
    let width = 500
    let t = 0
    // The fake's line width follows the content width: 500 -> 100 px, 480 -> 80 px.
    const measurer: LineMeasurer = {
      measure: (view, line) => {
        const m = fakeMeasurer({ first: 0 }).measure(view, line)
        return m && { ...m, lineWidth: () => width - 400 }
      },
    }
    const WIDE = ['break@10']
    const NARROW = ['break@5', 'break@10', 'break@15']

    async function run(body: (m: Made, poke: () => Promise<void>) => Promise<void>) {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const spy = vi
        .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
        .mockImplementation(() => width)
      try {
        const m = make('aaaa bbbb cccc dddd\n\nende', { measurer, extra: { now: () => t } })
        const flush = async () => {
          for (let i = 0; i < 3; i++) {
            ;(m.view as unknown as { measure(): void }).measure()
            await vi.advanceTimersByTimeAsync(0)
          }
        }
        await flush()
        await body(m, async () => {
          m.view.dispatch({ selection: { anchor: m.view.state.doc.length } })
          await flush()
        })
      } finally {
        spy.mockRestore()
        vi.useRealTimers()
      }
    }

    it('a wider width flipping back is held for the burst, then followed', async () => {
      width = 500
      t = 0
      await run(async (m, poke) => {
        expect(breaks(m.decos())).toEqual(WIDE)
        width = 480 // a scrollbar appeared: re-set
        t = 100
        await poke()
        expect(breaks(m.decos())).toEqual(NARROW)
        expect(m.calls()).toBe(2)
        width = 500 // vanished again within the burst: an oscillation, keep the setting
        t = 200
        await poke()
        expect(breaks(m.decos())).toEqual(NARROW)
        // Burst over without any interaction: the width that stayed is followed (cache).
        t = 1200
        await vi.advanceTimersByTimeAsync(1000)
        ;(m.view as unknown as { measure(): void }).measure()
        await vi.advanceTimersByTimeAsync(0)
        expect(breaks(m.decos())).toEqual(WIDE)
        expect(m.calls()).toBe(2)
      })
    })

    it('a lasting oscillation latches on the narrow setting; a real resize is followed', async () => {
      width = 500
      t = 0
      await run(async (m, poke) => {
        width = 480 // W -> N: followed
        t = 100
        await poke()
        width = 500 // N -> W within the burst: held, a timer is armed
        t = 200
        await poke()
        t = 1200 // the timer releases: set for W
        await vi.advanceTimersByTimeAsync(1000)
        ;(m.view as unknown as { measure(): void }).measure()
        await vi.advanceTimersByTimeAsync(0)
        expect(breaks(m.decos())).toEqual(WIDE)
        width = 480 // which brings N back: followed (narrower)
        t = 1300
        await poke()
        expect(breaks(m.decos())).toEqual(NARROW)
        const timers = vi.getTimerCount()
        width = 500 // and W again right after the release: an oscillation
        t = 1400
        await poke()
        expect(vi.getTimerCount()).toBe(timers) // no second timer
        expect(breaks(m.decos())).toEqual(NARROW)
        t = 5000
        await vi.advanceTimersByTimeAsync(5000)
        await poke()
        expect(breaks(m.decos())).toEqual(NARROW) // stable on N, also later
        const calls = m.calls()
        width = 460 // a real resize to a third width ends the latch
        t = 5100
        await poke()
        expect(m.calls()).toBe(calls + 1)
        width = 500 // and W is then followed again
        t = 9000
        await poke()
        expect(breaks(m.decos())).toEqual(WIDE)
      })
    })

    it('a narrower width is never held (the lines would be overfull)', async () => {
      width = 480
      t = 0
      await run(async (m, poke) => {
        expect(breaks(m.decos())).toEqual(NARROW)
        width = 500 // outline closed
        t = 100
        await poke()
        expect(breaks(m.decos())).toEqual(WIDE)
        width = 480 // and opened again at once: followed, not held
        t = 200
        await poke()
        expect(breaks(m.decos())).toEqual(NARROW)
      })
    })
  })

  it('counts measure passes, not lines, and never while fonts load', async () => {
    const doc = Array.from({ length: 12 }, (_, i) => `aaa bbb ccc ${i}`).join('\n\n')
    // One pass with 12 unmeasurable lines is one pass, not twelve.
    const one = make(`${doc}\n\nende`, { measurer: { measure: () => null } })
    await settle(one.view)
    expect(one.warn).not.toHaveBeenCalled()
    // Fonts still loading: transient by definition, never counted.
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { status: 'loading', addEventListener() {}, removeEventListener() {} },
    })
    try {
      const loading = make('aaa bbb ccc ddd\n\nende', { measurer: { measure: () => null } })
      for (let i = 0; i < 12; i++) {
        loading.view.dispatch({ selection: { anchor: loading.view.state.doc.length } })
        await settle(loading.view)
      }
      expect(loading.warn).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('warns once when the measurer keeps returning no layout', async () => {
    const m = make('aaa bbb ccc ddd\n\nende', { measurer: { measure: () => null } })
    for (let i = 0; i < 12; i++) {
      m.view.dispatch({ selection: { anchor: m.view.state.doc.length } })
      await settle(m.view)
    }
    expect(m.warn.mock.calls.filter((c) => c[1] === 'measure')).toHaveLength(1)
    expect(String(m.warn.mock.calls.find((c) => c[1] === 'measure')?.[0])).toMatch(/in a row/)
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

  /** A view of a shared plugin (a tab of the one editor), counting the engine's calls. */
  function shared(measurer: LineMeasurer) {
    let calls = 0
    const plugin = paragraphs({
      measurer,
      setParagraph: (p) => {
        calls++
        return setParagraph(p)
      },
      settings: () => RAGGED,
      warn: () => {},
    })
    const open = (doc: string, parent: HTMLElement = document.body) => {
      const view = new EditorView({
        state: parsed(
          EditorState.create({
            doc,
            selection: { anchor: doc.length },
            extensions: [
              markdown({ base: markdownLanguage }),
              previewView.of(true),
              previewPlugin,
              plugin,
            ],
          }),
        ),
        parent,
      })
      views.push(view)
      return view
    }
    const decos = (view: EditorView) => {
      const out: string[] = []
      view.plugin(plugin)?.decorations.between(0, view.state.doc.length, (from, to, d) => {
        out.push(`${(d.spec as { par: string }).par}@${from}${to > from ? `-${to}` : ''}`)
      })
      return out
    }
    return { open, decos, calls: () => calls }
  }

  it("a set's CSS reloaded under the same name sets the lines again", async () => {
    document.head.querySelectorAll('style[data-mdo-set-css]').forEach((el) => {
      el.remove()
    })
    const host = document.createElement('div')
    host.setAttribute(SET_ATTR, 'fx-brief')
    document.body.append(host)
    const styles = new SetStyles(document, host)
    const css = (size: string) => [
      {
        selectors: ['.mdo-preview'],
        declarations: [['--mdo-body-size', size]] as [string, string][],
      },
    ]
    try {
      styles.load('fx-brief', css('11pt'))
      const t = shared(fakeMeasurer({ first: 75 }))
      const view = t.open('aaa bbb ccc ddd\n\nende', host)
      await settle(view)
      expect(t.calls()).toBe(1)
      // The same rules again (a tab switch): the results stay.
      styles.load('fx-brief', css('11pt'))
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      await settle(view)
      expect(t.calls()).toBe(1)
      // Changed rules under the same name: the widths may differ, the line is measured again.
      styles.load('fx-brief', css('12pt'))
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      await settle(view)
      expect(t.calls()).toBe(2)
    } finally {
      host.remove()
      styles.load('fx-brief', [])
    }
  })

  it('a tab opened after fonts loaded reuses the results set with them', async () => {
    const fonts = Object.assign(new EventTarget(), { status: 'loaded' })
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    try {
      // Before the font: 7.5 chars per line; after it: 4.5 (other widths, other breaks).
      const geometry = { first: 75 }
      const t = shared({
        measure: (view, line) => fakeMeasurer({ first: geometry.first }).measure(view, line),
      })
      const doc = 'aaa bbb ccc ddd\n\nende'
      const a = t.open(doc)
      await settle(a)
      expect(breaks(t.decos(a))).toEqual(['break@8'])
      geometry.first = 45
      fonts.dispatchEvent(new Event('loadingdone'))
      await settle(a)
      expect(breaks(t.decos(a))).toEqual(['break@4', 'break@8', 'break@12'])
      const calls = t.calls()
      // Another tab of the same editor: same generation, the result comes from the cache.
      a.destroy()
      const b = t.open(doc)
      await settle(b)
      expect(t.calls()).toBe(calls)
      expect(breaks(t.decos(b))).toEqual(['break@4', 'break@8', 'break@12'])
    } finally {
      Reflect.deleteProperty(document, 'fonts')
    }
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

describe('inline formulas in set paragraphs', () => {
  /** A 3 em formula at the fake layout's 10 px em: 30 px, as wide as three display chars. */
  const FORMULA = okEntry('mdo-mxT', 3, 0.8, 0.1)
  const OBJ = '￼'

  function makeMath(
    doc: string,
    service = stubService({ 'I:x': FORMULA }),
    measurer?: LineMeasurer,
  ) {
    return make(doc, {
      lang: mdoMarkdown(),
      extensions: [createMath({ service }).extension],
      measurer: measurer ?? fakeMeasurer({ first: 75 }),
    })
  }

  it('walks a formula widget as one object char outside the note', async () => {
    const doc = 'aaa $x$ bbb\n\nende'
    const m = makeMath(doc)
    await settle(m.view)
    const el = lineElement(m.view, m.view.state.doc.line(1))
    expect(el?.querySelector('.mdo-math-inline svg')).not.toBeNull()
    const walk = walkLine(m.view, el as HTMLElement)
    expect(walk.text).toBe(`aaa ${OBJ} bbb`)
    expect(walk.docPos[4]).toBe(-1)
    expect(walk.docPos[5]).toBe(doc.indexOf(' bbb'))
  })

  it('never breaks inside a formula; a break before it falls at its start', async () => {
    // 'aaa bbb' fills the 75 px line (the fake layout gives the object char one advance).
    const doc = 'aaa bbb $x$ ccc\n\nende'
    const inputs: ParagraphInput[] = []
    const m = make(doc, {
      lang: mdoMarkdown(),
      extensions: [createMath({ service: stubService({ 'I:x': FORMULA }) }).extension],
      extra: {
        setParagraph: (p) => {
          inputs.push(p)
          return setParagraph(p)
        },
      },
    })
    await settle(m.view)
    const input = inputs.at(-1)
    const obj = input?.text.indexOf(OBJ) ?? -1
    expect(obj).toBeGreaterThan(0)
    // The engine's break opportunities (display index where the next line starts): before the
    // object char (after the space), never right after it (glued to the formula's end), and
    // the formula is one char, so nothing in its source can be one.
    const at = input?.breaks.map((b) => b.index) ?? []
    expect(at).toContain(obj)
    expect(at).not.toContain(obj + 1)
    // The break taken lands at the formula's start in the doc.
    const from = doc.indexOf('$x$')
    expect(breaks(m.decos()).map((s) => Number(s.split('@')[1]))).toContain(from)
  })

  it('a formula settling (pending -> shown) sets its line again', async () => {
    const service = stubService()
    const doc = 'aaa $x$ bbb ccc ddd\n\nende'
    const m = makeMath(doc, service)
    await settle(m.view)
    const before = m.calls()
    expect(m.decos()).toContain('line@0')
    service.entries.set('I:x', FORMULA)
    service.emit()
    await settle(m.view)
    // The pending source was set with its own widths; the widget has others.
    expect(m.calls()).toBe(before + 1)
    expect(m.decos()).toContain('line@0')
  })

  it('domMeasurer advances x by the formula widget’s rendered width', async () => {
    const doc = 'aa $x$ bb\n\nende'
    const m = makeMath(doc)
    await settle(m.view)
    const line = m.view.state.doc.line(1)
    const W = 30
    /** x of a DOM position in its line: ADV per char, W per formula widget. */
    function xAt(node: Node, offset: number): number {
      const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('.cm-line')
      if (!el) return 0
      let x = 0
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n === node) return x + offset * ADV
        if (n.nodeType === 1 && (n as Element).classList.contains('mdo-math-inline')) {
          if ((n as Element).contains(node)) return x
          x += W
        } else if (n.nodeType === 3 && !n.parentElement?.closest('.mdo-math-inline')) {
          x += (n as Text).data.length * ADV
        }
      }
      return x
    }
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
      const a = xAt(this.startContainer, this.startOffset)
      const b = xAt(this.endContainer, this.endOffset)
      return rect(a, b - a)
    })
    const els = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.classList.contains('mdo-math-inline')) return rect(xAt(this, 0), W)
      return rect(0, this.textContent === '-' ? 4 : 800)
    })
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    try {
      const measured = domMeasurer().measure(m.view, line)
      expect(measured).not.toBeNull()
      if (!measured) return
      expect(measured.text).toBe(`aa ${OBJ} bb`)
      expect(measured.docPos[3]).toBe(-1)
      expect([...measured.x]).toEqual([0, 10, 20, 30, 30 + W, 40 + W, 50 + W, 60 + W])
    } finally {
      ranges.mockRestore()
      els.mockRestore()
      width.mockRestore()
    }
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

  it('returns null when the clone is out of step with the drawn line', async () => {
    const m = make('aaa bbb ccc ddd\n\nende', { measurer: fakeMeasurer({ first: 75 }) })
    await settle(m.view)
    const clone = Node.prototype.cloneNode
    const spy = vi.spyOn(Node.prototype, 'cloneNode').mockImplementation(function (
      this: Node,
      deep?: boolean,
    ) {
      const c = clone.call(this, deep)
      if (c instanceof HTMLElement && c.classList.contains('cm-line')) c.append('x')
      return c
    })
    try {
      expect(domMeasurer().measure(m.view, m.view.state.doc.line(1))).toBeNull()
    } finally {
      spy.mockRestore()
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
  it('warns only once per session and kind', () => {
    const sink = vi.fn()
    const warn = onceWarner(sink)
    warn('a', 'widths')
    warn('b', 'widths')
    warn('c', 'engine')
    warn('d', 'engine')
    expect(sink).toHaveBeenCalledTimes(2)
    expect(String(sink.mock.calls[0]?.[0])).toContain('a')
    expect(String(sink.mock.calls[1]?.[0])).toContain('c')
  })
})
