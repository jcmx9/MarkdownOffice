// @vitest-environment happy-dom

import { undo } from '@codemirror/commands'
import { foldEffect, foldedRanges, syntaxTree } from '@codemirror/language'
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

// ---------------------------------------------------------------------------------------------
// Line formats, link, alerts and active state (Task 5)

type LineId = 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'task' | 'quote'

/** Runs any command, checks one undo restores the exact bytes, returns the marked result. */
function runCmd(text: string, cmd: (v: EditorView) => boolean, opts: MakeOptions = {}): string {
  const v = make(text, opts)
  const before = v.state.doc.toString()
  expect(cmd(v)).toBe(true)
  const after = marked(v)
  const afterState = v.state
  undo(v)
  expect(v.state.doc.toString()).toBe(before)
  v.setState(afterState)
  return after
}

function refusesCmd(text: string, cmd: (v: EditorView) => boolean, opts: MakeOptions = {}): void {
  const v = make(text, opts)
  const before = v.state.doc.toString()
  expect(cmd(v)).toBe(false)
  expect(v.state.doc.toString()).toBe(before)
}

/** The names of every node in a fresh parse of `text`. */
function nodeNames(text: string): Set<string> {
  const state = parsed(createState(text, '\n', 'code', false, 'edit'))
  const names = new Set<string>()
  syntaxTree(state).iterate({ enter: (n) => void names.add(n.name) })
  return names
}

describe('setLinePrefix: headings', () => {
  it.each([
    ['sets a heading on body text', 'para‸', 'h1', '# para‸'],
    ['changes the level', '## ti‸tle', 'h1', '# ti‸tle'],
    ['the same level again makes body text', '## ti‸tle', 'h2', 'ti‸tle'],
    ['removes an ATX closing sequence with the heading', '## ti‸tle ##', 'h2', 'ti‸tle'],
    ['keeps the closing sequence on a level change', '## ti‸tle ##', 'h3', '### ti‸tle ##'],
    ['converts a Setext heading', 'Ti‸tle\n===', 'h2', '## Ti‸tle'],
    ['converts a Setext H2 to H1', 'Ti‸tle\n---', 'h1', '# Ti‸tle'],
    ['a Setext heading of the same level becomes body text', 'Ti‸tle\n===', 'h1', 'Ti‸tle'],
    ['a cursor on the Setext underline converts its heading', 'Title\n==‸=', 'h3', '### Title‸'],
    ['every touched line', '«a\nb»', 'h3', '### «a\n### b»'],
    ['mixed lines are all set', '«# a\nb»', 'h1', '«# a\n# b»'],
    ['inside a quote', '> qu‸ote', 'h2', '> ## qu‸ote'],
    ['inside a list item', '- it‸em', 'h2', '- ## it‸em'],
    ['inside an alert', '> [!NOTE]\n> te‸xt', 'h2', '> [!NOTE]\n> ## te‸xt'],
    ['on an empty line', '‸', 'h1', '# ‸'],
    ['skips the alert type line', '> «[!NOTE]\n> a»', 'h1', '> «[!NOTE]\n> # a»'],
    ['skips a thematic break', '«a\n\n---\n\nb»', 'h2', '## «a\n\n---\n\n## b»'],
  ] as [string, string, LineId, string][])('%s', (_name, before, id, after) => {
    expect(runCmd(before, format.setLinePrefix(id))).toBe(after)
  })

  it('a range ending at column 0 does not touch that line', () => {
    expect(runCmd('«a\n»b', format.setLinePrefix('h1'))).toBe('# «a\n»b')
  })
})

describe('setLinePrefix: lists and quotes', () => {
  it.each([
    ['bullets every line', '«a\nb»', 'bullet', '- «a\n- b»'],
    [
      'numbers from 1 over the changed lines, blank lines skipped',
      '«a\n\nb\nc»',
      'numbered',
      '1. «a\n\n2. b\n3. c»',
    ],
    ['does not continue a preceding list', '1. x\n\n«a\nb»', 'numbered', '1. x\n\n1. «a\n2. b»'],
    ['swaps bullets for numbers', '«- a\n- b»', 'numbered', '«1. a\n2. b»'],
    ['swaps numbers for tasks', '1. «a\n2. b»', 'task', '- [ ] «a\n- [ ] b»'],
    ['swaps tasks for bullets', '- [ ] «a\n- [x] b»', 'bullet', '- «a\n- b»'],
    ['keeps the indentation', '«  a\n  b»', 'bullet', '«  - a\n  - b»'],
    ['works inside a quote', '> «a\n> b»', 'bullet', '> - «a\n> - b»'],
    [
      'works inside an alert, not on its type line',
      '> «[!NOTE]\n> a\n> b»',
      'numbered',
      '> «[!NOTE]\n> 1. a\n> 2. b»',
    ],
    ['starts a list on an empty line', '‸', 'bullet', '- ‸'],
    ['starts a task on an empty line', '‸', 'task', '- [ ] ‸'],
    ['a continuation line stands for its item', '- a\n  b‸', 'numbered', '1. a\n  b‸'],
    ['a list item in a quote keeps the quote', '> - a‸', 'numbered', '> 1. a‸'],
    ['quotes every line', '«a\nb»', 'quote', '> «a\n> b»'],
    ['quotes a list at the line start', '«- a\n- b»', 'quote', '> «- a\n> - b»'],
    ['quotes a heading', '## a‸', 'quote', '> ## a‸'],
  ] as [string, string, LineId, string][])('%s', (_name, before, id, after) => {
    expect(runCmd(before, format.setLinePrefix(id))).toBe(after)
  })

  it.each([
    [
      'a bullet list from a middle line',
      'x\n\n- a\n- b‸\n- c\n\ny',
      'bullet',
      'x\n\na\nb‸\nc\n\ny',
      'BulletList',
    ],
    [
      'a numbered list from a middle line',
      '1. a\n2. b‸\n3. c',
      'numbered',
      'a\nb‸\nc',
      'OrderedList',
    ],
    ['a task list', '- [ ] a\n- [x] b‸', 'task', 'a\nb‸', 'Task'],
    [
      'a quote from a middle line',
      'x\n\n> a\n> b‸\n> c\n\ny',
      'quote',
      'x\n\na\nb‸\nc\n\ny',
      'Blockquote',
    ],
    ['an alert', '> [!NOTE]\n> a‸', 'quote', '[!NOTE]\na‸', 'Blockquote'],
    ['a list with continuation lines', '10. a‸\n\n    b', 'numbered', 'a‸\n\nb', 'OrderedList'],
  ] as [string, string, LineId, string, string][])(
    'toggles off the whole block: %s',
    (_name, before, id, after, gone) => {
      const result = runCmd(before, format.setLinePrefix(id))
      expect(result).toBe(after)
      const names = nodeNames(result.replace(CURSOR, ''))
      expect(names.has(gone)).toBe(false)
      expect(names.has('CodeBlock')).toBe(false)
    },
  )

  it('toggles off a list inside a quote, the quote stays', () => {
    expect(runCmd('> - a\n> - b‸', format.setLinePrefix('bullet'))).toBe('> a\n> b‸')
  })

  it('numbers a nested level from 1 again', () => {
    expect(runCmd('«a\n  b\n  c\nd»', format.setLinePrefix('numbered'))).toBe(
      '1. «a\n  1. b\n  2. c\n2. d»',
    )
  })

  it('toggles off only the innermost list', () => {
    const result = runCmd('- a\n  - b‸\n  - c\n- d', format.setLinePrefix('bullet'))
    expect(result).toBe('- a\n  b‸\n  c\n- d')
    const state = parsed(createState(result.replace(CURSOR, ''), '\n', 'code', false, 'edit'))
    const items: string[] = []
    syntaxTree(state).iterate({
      enter: (n) => void (n.name === 'ListItem' && items.push(state.sliceDoc(n.from, n.to))),
    })
    expect(items).toEqual(['- a\n  b\n  c', '- d'])
  })

  it('toggles off a quote nested in a quote: the inner one only', () => {
    expect(runCmd('> a\n>\n> > b‸\n> > c', format.setLinePrefix('quote'))).toBe('> a\n>\n> b‸\n> c')
  })

  it('quoting a mix adds the prefix only where it is missing', () => {
    expect(runCmd('> «a\n\nb»', format.setLinePrefix('quote'))).toBe('> «a\n\n> b»')
  })

  it('a Setext heading becomes a list item with its underline indented', () => {
    expect(runCmd('Ti‸tle\n---', format.setLinePrefix('bullet'))).toBe('- Ti‸tle\n  ---')
  })
})

describe('setLinePrefix: refused blocks and folds', () => {
  it('skips a table inside the selection', () => {
    expect(runCmd('«a\n\n| x |\n|---|\n\nb»', format.setLinePrefix('bullet'))).toBe(
      '- «a\n\n| x |\n|---|\n\n- b»',
    )
  })

  it('skips a code fence inside the selection', () => {
    expect(runCmd('«a\n\n```\ncode\n```\n\nb»', format.setLinePrefix('quote'))).toBe(
      '> «a\n\n```\ncode\n```\n\n> b»',
    )
  })

  it('skips the front matter inside the selection', () => {
    expect(runCmd('«---\ntitle: x\n---\n\nText»', format.setLinePrefix('h1'))).toBe(
      '«---\ntitle: x\n---\n\n# Text»',
    )
  })

  it.each(['h1', 'h2', 'h3', 'bullet', 'numbered', 'task', 'quote'] as LineId[])(
    'refuses %s in a table, code, front matter, HTML and Present',
    (id) => {
      const cmd = format.setLinePrefix(id)
      refusesCmd('| a‸ |\n|---|', cmd)
      refusesCmd('```\nco‸de\n```', cmd)
      refusesCmd('---\nti‸tle: x\n---\n\nText', cmd)
      refusesCmd('<!-- page‸break -->', cmd)
      refusesCmd('«| a |\n|---|»', cmd)
      refusesCmd('a fo‸o', cmd, { present: true })
      refusesCmd('a fo‸o', cmd, { mode: 'present' })
    },
  )

  it('changes a fold fully inside the selection and keeps it folded', () => {
    const v = make('«# A\nx\ny\n# B»')
    v.dispatch({ effects: foldEffect.of({ from: 3, to: 7 }) })
    expect(format.setLinePrefix('quote')(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('> # A\n> x\n> y\n> # B')
    expect(foldedRanges(v.state).size).toBe(1)
  })

  it('unfolds a fold the selection only partly covers', () => {
    const v = make('# A\nx\ny\n# B\n\nz')
    v.dispatch({ effects: foldEffect.of({ from: 3, to: 7 }) })
    // Anchor inside the fold (line x), head on line z.
    v.dispatch({ selection: EditorSelection.single(4, 14) })
    expect(foldedRanges(v.state).size).toBe(1)
    expect(format.setLinePrefix('quote')(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('# A\n> x\n> y\n> # B\n\n> z')
    expect(foldedRanges(v.state).size).toBe(0)
  })

  it('tags the transaction input.format.<id> and is one undo step', () => {
    const v = make('a‸')
    let event = ''
    const orig = v.dispatch.bind(v)
    v.dispatch = ((...args: Parameters<EditorView['dispatch']>) => {
      event = (args[0] as { userEvent?: string }).userEvent ?? ''
      orig(...args)
    }) as EditorView['dispatch']
    format.setLinePrefix('numbered')(v)
    expect(event).toBe('input.format.numbered')
    v.dispatch({ changes: { from: v.state.doc.length, insert: 'x' }, userEvent: 'input.type' })
    undo(v)
    expect(v.state.doc.toString()).toBe('1. a')
    undo(v)
    expect(v.state.doc.toString()).toBe('a')
  })

  it('keeps CRLF on save', () => {
    const v = make('«a\r\nb»', { eol: '\r\n' })
    expect(format.setLinePrefix('bullet')(v)).toBe(true)
    expect(serializeDoc(v.state.doc, '\r\n')).toBe('- a\r\n- b')
  })
})

describe('insertLink', () => {
  const URL = 'https://example.org/a'
  const link = (url: string | null) => (v: EditorView) => format.insertLink(v, url)

  it.each([
    ['a selection without URL puts the cursor in the URL', 'a «foo» b', null, 'a [foo](‸) b'],
    ['a selection with URL puts the cursor after the link', 'a «foo» b', URL, `a [foo](${URL})‸ b`],
    ['no selection without URL', 'a ‸ b', null, 'a [‸]() b'],
    ['no selection with URL keeps the cursor in the text', 'a ‸ b', URL, `a [‸](${URL}) b`],
    ['trims the clipboard text', 'a «foo» b', `  ${URL}\n`, `a [foo](${URL})‸ b`],
    ['ignores text that is no URL', 'a «foo» b', 'not a url', 'a [foo](‸) b'],
    ['ignores a URL with whitespace inside', 'a «foo» b', 'https://a b', 'a [foo](‸) b'],
    ['ignores other schemes', 'a «foo» b', 'ftp://x.org', 'a [foo](‸) b'],
    ['ignores several URLs', 'a «foo» b', `${URL}\n${URL}`, 'a [foo](‸) b'],
    [
      'wraps a URL with unbalanced parentheses',
      'a «foo» b',
      'https://x.org/a_(b',
      'a [foo](<https://x.org/a_(b>)‸ b',
    ],
    ['keeps the line prefix outside', '«## Head»', null, '## [Head](‸)'],
    ['widens over a partly covered run', '**a «b** c»', null, '[**a b** c](‸)'],
    ['works in a table cell', '| «a» | b |\n|---|---|', URL, `| [a](${URL})‸ | b |\n|---|---|`],
  ] as [string, string, string | null, string][])('%s', (_name, before, url, after) => {
    expect(runCmd(before, link(url))).toBe(after)
  })

  it.each([
    ['a code span', 'a `co‸de` b'],
    ['an existing link', 'a [te‸xt](u) b'],
    ['the front matter', '---\nti‸tle: x\n---\n\nText'],
    ['a code block', '```\nco‸de\n```'],
    ['a selection over two lines', '«a\nb»'],
    ['a selection over two cells', '| «a | b» |\n|---|---|'],
  ])('refuses in %s', (_name, text) => {
    refusesCmd(text, link(URL))
  })

  it('refuses in Present', () => {
    refusesCmd('a «foo» b', link(URL), { present: true })
  })
})

describe('insertAlert', () => {
  it.each([
    // Like a table, the box gets a blank line after it, at the note end too.
    ['on an empty note', '‸', 'warning', '> [!WARNING]\n> ‸\n'],
    ['after the cursor block at the note end', 'para‸', 'note', 'para\n\n> [!NOTE]\n> ‸\n'],
    ['into the next empty line', 'pa‸ra\n\nnext', 'note', 'para\n\n> [!NOTE]\n> ‸\n\nnext'],
    ['after a whole list', '- a‸\n- b\n\nx', 'tip', '- a\n- b\n\n> [!TIP]\n> ‸\n\nx'],
    ['a selection becomes the content', '«a\nb»', 'caution', '> [!CAUTION]\n> a\n> b‸'],
    ['blank lines stay in the box', '«a\n\nb»', 'important', '> [!IMPORTANT]\n> a\n>\n> b‸'],
    ['blank lines around the box', 'x\n«a»\ny', 'tip', 'x\n\n> [!TIP]\n> a‸\n\ny'],
  ] as [string, string, format.AlertType, string][])('%s', (_name, before, type, after) => {
    expect(runCmd(before, format.insertAlert(type))).toBe(after)
  })

  it.each([
    ['a table', '| a‸ |\n|---|'],
    ['a code block', '```\nco‸de\n```'],
    ['the front matter', '---\nti‸tle: x\n---\n\nText'],
    ['a selection touching a table', '«a\n\n| x |»\n|---|'],
  ])('refuses in %s', (_name, text) => {
    refusesCmd(text, format.insertAlert('note'))
  })

  it('refuses in Present', () => {
    refusesCmd('a‸', format.insertAlert('note'), { present: true })
  })

  it('lists the five GFM types with the pipeline labels', () => {
    expect(format.ALERT_ENTRIES.map((e) => [e.type, e.label, e.keyword])).toEqual([
      ['note', 'Info', 'NOTE'],
      ['tip', 'Tipp', 'TIP'],
      ['important', 'Wichtig', 'IMPORTANT'],
      ['warning', 'Hinweis', 'WARNING'],
      ['caution', 'Achtung', 'CAUTION'],
    ])
  })
})

describe('activeFormats', () => {
  it.each([
    ['plain‸', []],
    ['**a‸b**', ['bold']],
    ['*a‸*', ['italic']],
    ['***a‸***', ['bold', 'italic']],
    ['~~a‸~~', ['strike']],
    ['==a‸==', ['mark']],
    ['`a‸`', ['code']],
    ['# a‸', ['h1']],
    ['## a‸', ['h2']],
    ['### a‸', ['h3']],
    ['#### a‸', []],
    ['a‸\n===', ['h1']],
    ['a‸\n---', ['h2']],
    ['> a‸', ['quote']],
    ['> [!NOTE]\n> a‸', ['quote']],
    ['- a‸', ['bullet']],
    ['1. a‸', ['numbered']],
    ['- [ ] a‸', ['task']],
    ['1. [ ] a‸', ['task']],
    ['- a\n  1. b‸', ['numbered']],
    ['1. a\n   - b‸', ['bullet']],
    ['- **a‸**', ['bullet', 'bold']],
    ['| a‸ |\n|---|', ['table']],
    ['| ==a‸== |\n|---|', ['table', 'mark']],
  ] as [string, string[]][])('%s', (text, expected) => {
    const v = make(text)
    expect([...format.activeFormats(v.state)].sort()).toEqual([...expected].sort())
  })
})
