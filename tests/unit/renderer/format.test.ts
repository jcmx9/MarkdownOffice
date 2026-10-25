// @vitest-environment happy-dom

import { undo } from '@codemirror/commands'
import { EditorSelection, EditorState, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import * as format from '../../../src/renderer/editor/format'
import { formatMode, refused, toggleInline } from '../../../src/renderer/editor/format'
import { createState, serializeDoc } from '../../../src/renderer/editor/setup'
import type { Mode } from '../../../src/shared/types'
import { parsed } from './parsed'

// Markers in the test texts: `‸` a cursor, `«…»` a selection (anchor at «, head at »). Tables
// and Markdown are full of `|` and `[]`, so neither is used.
const CURSOR = '‸'
const OPEN = '«'
const CLOSE = '»'

type Inline = 'bold' | 'italic' | 'strike' | 'mark' | 'code'

const views: EditorView[] = []
afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
})

interface MakeOptions {
  mode?: Mode
  eol?: '\n' | '\r\n'
  present?: boolean
}

function make(text: string, opts: MakeOptions = {}): EditorView {
  const ranges: { anchor: number; head: number }[] = []
  let doc = ''
  let open = -1
  for (const ch of text) {
    if (ch === CURSOR) ranges.push({ anchor: doc.length, head: doc.length })
    else if (ch === OPEN) open = doc.length
    else if (ch === CLOSE) ranges.push({ anchor: open, head: doc.length })
    // CodeMirror stores CRLF as one line break: count offsets the way the document does.
    else if (ch === '\r') continue
    else doc += ch
  }
  let state = createState(doc, opts.eol ?? '\n', 'code', false, opts.mode ?? 'edit')
  state = state.update({
    effects: StateEffect.appendConfig.of([
      EditorState.allowMultipleSelections.of(true),
      opts.present ? formatMode.of('present') : [],
    ]),
  }).state
  state = parsed(state)
  const sel = ranges.length
    ? EditorSelection.create(ranges.map((r) => EditorSelection.range(r.anchor, r.head)))
    : EditorSelection.single(0)
  const view = new EditorView({
    state: state.update({ selection: sel }).state,
    parent: document.body,
  })
  views.push(view)
  return view
}

/** The document with every selection range marked. */
function marked(v: EditorView): string {
  const doc = v.state.doc.toString()
  const marks: { pos: number; text: string }[] = []
  for (const r of v.state.selection.ranges) {
    if (r.empty) marks.push({ pos: r.head, text: CURSOR })
    else {
      marks.push({ pos: r.from, text: OPEN })
      marks.push({ pos: r.to, text: CLOSE })
    }
  }
  marks.sort((a, b) => b.pos - a.pos)
  let out = doc
  for (const m of marks) out = out.slice(0, m.pos) + m.text + out.slice(m.pos)
  return out
}

/** Runs the command, checks one undo restores the exact bytes, returns the marked result. */
function run(text: string, id: Inline, opts: MakeOptions = {}): string {
  const v = make(text, opts)
  const before = v.state.doc.toString()
  expect(toggleInline(id)(v)).toBe(true)
  const after = marked(v)
  const afterState = v.state
  undo(v)
  expect(v.state.doc.toString()).toBe(before)
  v.setState(afterState)
  return after
}

/** Runs a command that must refuse: false and the document unchanged. */
function refuses(text: string, id: Inline, opts: MakeOptions = {}): void {
  const v = make(text, opts)
  const before = v.state.doc.toString()
  expect(toggleInline(id)(v)).toBe(false)
  expect(v.state.doc.toString()).toBe(before)
}

const FORMATS: [Inline, string][] = [
  ['bold', '**'],
  ['italic', '*'],
  ['strike', '~~'],
  ['mark', '=='],
  ['code', '`'],
]

/** `M` in a template stands for the format's marker. */
const fill = (template: string, mark: string): string => template.replaceAll('M', mark)

describe.each(FORMATS)('toggleInline(%s)', (id, mark) => {
  it.each([
    ['wraps a selection', 'a «foo» b', 'a M«foo»M b'],
    ['wraps the word at the cursor', 'a fo‸o b', 'a Mfo‸oM b'],
    ['wraps the word with the cursor at its start', 'a ‸foo b', 'a M‸fooM b'],
    ['wraps the word with the cursor at its end', 'a foo‸ b', 'a Mfoo‸M b'],
    ['inserts markers at an empty spot', 'a ‸ b', 'a M‸M b'],
    ['inserts markers in an empty note', '‸', 'M‸M'],
    ['trims whitespace at the selection ends', 'a« foo »b', 'a« MfooM »b'],
    ['handles every selection range', '«a» b «c»', 'M«a»M b M«c»M'],
    [
      'splits a selection across a block boundary',
      'para «one\n\n- two» end',
      'para M«oneM\n\n- Mtwo»M end',
    ],
    ['splits after heading and quote prefixes', '## «head\n> quote» x', '## M«headM\n> Mquote»M x'],
    ['splits every line of a paragraph', '«a\nb»', 'M«aM\nMb»M'],
    ['skips blank lines', '«a\n\n\nb»', 'M«aM\n\n\nMb»M'],
    ['works in a task item', '- [ ] «task»', '- [ ] M«task»M'],
    ['toggles off at the cursor', 'a Mfo‸oM b', 'a fo‸o b'],
    ['toggles off a selected run', '«MfooM»', '«foo»'],
    ['toggles off a partly selected run', 'M«fo»oM bar', '«fo»o bar'],
    ['toggles off every run the selection crosses', 'Ma«aM x Mb»bM', 'a«a x b»b'],
  ])('%s', (_name, before, after) => {
    expect(run(fill(before, mark), id)).toBe(fill(after, mark))
  })
})

describe('nested and alternative markers', () => {
  it.each([
    ['bold off on ***x*** leaves *x*', '***x‸***', 'bold', '*x‸*'],
    ['italic off on ***x*** leaves **x**', '***x‸***', 'italic', '**x‸**'],
    ['italic off on _x_', 'a _x‸_ b', 'italic', 'a x‸ b'],
    ['bold off on __x__', 'a __x‸__ b', 'bold', 'a x‸ b'],
    ['bold inside italic nests', '*a fo‸o b*', 'bold', '*a **fo‸o** b*'],
    ['a partly covered other run widens the range', '*a «b* c»', 'bold', '***a «b* c»**'],
    ['code toggles off a code span', 'a `co‸de` b', 'code', 'a co‸de b'],
    ['code toggles off a double-backtick span', 'a ``co‸de`` b', 'code', 'a co‸de b'],
    ['skips a Setext underline', '«Title\n===»', 'bold', '**«Title**\n===»'],
    ['skips a thematic break', '«a\n\n---\n\nb»', 'bold', '**«a**\n\n---\n\n**b»**'],
    [
      'works in an alert, not on its type line',
      '> «[!NOTE]\n> one\n> two»',
      'bold',
      '> «[!NOTE]\n> **one**\n> **two»**',
    ],
    ['toggles off at the closing marker', '**a**‸ b', 'bold', 'a‸ b'],
    ['highlight off in a table cell', '| ==a‸== | b |\n|---|---|', 'mark', '| a‸ | b |\n|---|---|'],
    [
      'code off strips the padding space of a padded span',
      'a `` x‸ ` y `` b',
      'code',
      'a x‸ ` y b',
    ],
    ['code off keeps a span of spaces only', 'a `‸  ` b', 'code', 'a ‸   b'],
    [
      'wraps above a fence when the range ends at column 0',
      '«a\n»```\nx\n```',
      'bold',
      '**«a**\n»```\nx\n```',
    ],
    ['code fences a selection holding a backtick', '«a`b»', 'code', '``«a`b»``'],
  ] as [string, string, Inline, string][])('%s', (_name, before, id, after) => {
    expect(run(before, id)).toBe(after)
  })

  it.each(['bold', 'italic', 'strike', 'mark'] as Inline[])(
    'refuses %s inside a code span',
    (id) => {
      refuses('a `co‸de` b', id)
      refuses('a `«co»de` b', id)
    },
  )

  it.each([
    ['a thematic break', 'a\n\n--‸-'],
    ['a Setext underline', 'Title\n==‸='],
    ['an alert type line', '> [!NO‸TE]\n> text'],
    ['a link reference definition', '[a]: http://x.d‸e'],
    ['a table row in a quote', '> | a‸ | b |\n> |---|---|'],
    ['a table row in a list', '- | a‸ | b |\n  |---|---|'],
  ])('refuses a cursor on %s', (_name, text) => {
    refuses(text, 'bold')
  })

  it('leaves a selected table row in a quote alone', () => {
    expect(run('«x\n\n> | a | b |\n> |---|---|»', 'bold')).toBe(
      '**«x**\n\n> | a | b |\n> |---|---|»',
    )
  })

  it('refuses inside an inline formula', () => {
    refuses('a $x‸ + y$ b', 'bold')
  })

  it('keeps CRLF on save', () => {
    const v = make('a\r\n«b\r\nc»', { eol: '\r\n' })
    expect(toggleInline('bold')(v)).toBe(true)
    expect(serializeDoc(v.state.doc, '\r\n')).toBe('a\r\n**b**\r\n**c**')
  })
})

describe('inline formats in table cells', () => {
  const D = '\n|---|---|'

  it('ends the word at the cursor at the cell pipe', () => {
    expect(run(`| foo‸| bar |${D}`, 'bold')).toBe(`| **foo‸**| bar |${D}`)
  })

  it('wraps a word in a body cell', () => {
    expect(run(`| A | B |${D}\n| x | ba‸r |`, 'italic')).toBe(`| A | B |${D}\n| x | *ba‸r* |`)
  })

  it('inserts markers in an empty cell', () => {
    expect(run(`| ‸  | b |${D}`, 'bold')).toBe(`| **‸**  | b |${D}`)
  })

  it('splits a selection over cells and a paragraph', () => {
    expect(run(`| «a | b |${D}\n\nc» d`, 'bold')).toBe(`| **«a** | **b** |${D}\n\n**c»** d`)
  })

  it('toggles off per cell', () => {
    expect(run(`| «**a** | **b**» |${D}`, 'bold')).toBe(`| «a | b» |${D}`)
  })

  it('leaves an escaped \\| and the padding untouched', () => {
    expect(run(`|  «a \\| b»   | c |${D}`, 'mark')).toBe(`|  ==«a \\| b»==   | c |${D}`)
  })

  it('partial overlap undo: a selection overlapping a run removes it', () => {
    expect(run(`| **fo«o** ba»r | c |${D}`, 'bold')).toBe(`| fo«o ba»r | c |${D}`)
  })

  it('skips the delimiter row', () => {
    expect(run(`| «a |\n|---|\n| b» |`, 'strike')).toBe(`| ~~«a~~ |\n|---|\n| ~~b»~~ |`)
  })
})

describe('refused contexts', () => {
  it.each([
    ['Present (formatMode)', 'a fo‸o', { present: true }],
    ['Present (mode)', 'a fo‸o', { mode: 'present' as Mode }],
    ['the front matter', '---\nti‸tle: x\n---\n\nText', {}],
    ['a selection touching the front matter', '---\ntitle: «x\n---\n\nTe»xt', {}],
    ['a fenced code block', '```\nco‸de\n```', {}],
    ['an indented code block', 'Text\n\n    co‸de', {}],
    ['an HTML comment', '<!-- page‸break -->', {}],
    ['an HTML block', '<div>\nte‸xt\n</div>', {}],
    ['a selection spanning a fence', '«para\n\n```\ncode»\n```', {}],
  ] as [string, string, MakeOptions][])('refuses in %s', (_name, text, opts) => {
    refuses(text, 'bold', opts)
  })

  it('refused(inline) allows tables, refused(line) does not', () => {
    const v = make('| a‸ |\n|---|')
    expect(refused(v.state, 'inline')).toBe(false)
    expect(refused(v.state, 'line')).toBe(true)
  })

  it('refused() is false in a plain paragraph for both kinds', () => {
    const v = make('a fo‸o')
    expect(refused(v.state, 'inline')).toBe(false)
    expect(refused(v.state, 'line')).toBe(false)
  })
})

describe('undo and events', () => {
  it('is one undo step, typing after it a separate one', () => {
    const v = make('a fo‸o b')
    expect(toggleInline('bold')(v)).toBe(true)
    const pos = v.state.selection.main.head
    v.dispatch({ changes: { from: pos, insert: 'x' }, userEvent: 'input.type' })
    expect(v.state.doc.toString()).toBe('a **foxo** b')
    undo(v)
    expect(v.state.doc.toString()).toBe('a **foo** b')
    undo(v)
    expect(v.state.doc.toString()).toBe('a foo b')
  })

  it('tags the transaction input.format.<id>', () => {
    const v = make('a fo‸o b')
    let event = ''
    const orig = v.dispatch.bind(v)
    v.dispatch = ((...args: Parameters<EditorView['dispatch']>) => {
      const spec = args[0] as { userEvent?: string }
      event = spec.userEvent ?? ''
      orig(...args)
    }) as EditorView['dispatch']
    toggleInline('strike')(v)
    expect(event).toBe('input.format.strike')
  })

  it('exports no keymap', () => {
    expect(Object.keys(format).filter((k) => /keymap/i.test(k))).toEqual([])
  })
})
