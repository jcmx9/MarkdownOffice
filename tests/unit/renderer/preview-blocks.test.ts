// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { alertTitle, previewPlugin, toggleTaskAt } from '../../../src/renderer/editor/preview'
import { rf } from './preview-helper'

describe('lists and tasks', () => {
  it('replaces the bullet by a square away from the cursor', () => {
    expect(rf('- Punkt')).toContain('bullet@0-1')
    const near = rf('- Punkt', 3)
    expect(near).toContain('mark:mdo-mark mdo-list-mark@0-1')
    expect(near).not.toContain('bullet@0-1')
  })
  it('replaces * and + bullets too', () => {
    expect(rf('* a')).toContain('bullet@0-1')
    expect(rf('+ a')).toContain('bullet@0-1')
  })
  it('turns a task into a checkbox and hides its bullet', () => {
    expect(rf('- [ ] offen')).toEqual(expect.arrayContaining(['hide@0-2', 'task@2-5']))
    expect(rf('- [x] erledigt', 8)).toEqual(expect.arrayContaining(['hide@0-2', 'task@2-5']))
  })
  it('leaves ordered lists alone', () => {
    expect(rf('1. eins').some((d) => d.startsWith('bullet'))).toBe(false)
  })
})

describe('quotes and alerts', () => {
  it('quote: line class, hidden "> "', () => {
    expect(rf('> Zitat')).toEqual(expect.arrayContaining(['line:mdo-quote@0-0', 'hide@0-2']))
  })
  it('alert: classes on every line, title widget for the marker line', () => {
    const d = rf('> [!WARNING]\n> Achtung Stufe')
    expect(d).toEqual(
      expect.arrayContaining([
        'line:mdo-alert mdo-alert-warning@0-0',
        'line:mdo-alert mdo-alert-warning@13-13',
        'alert-title@0-12',
        'hide@13-15',
      ]),
    )
    expect(d).not.toContain('line:mdo-quote@0-0')
  })
  it('alert: marker line shown as text when the cursor is on it', () => {
    expect(rf('> [!NOTE]\n> x', 3)).not.toContain('alert-title@0-9')
  })
  it('alert: no inline decorations inside the replaced title line', () => {
    const d = rf('> [!NOTE]\n> x')
    expect(d).toContain('alert-title@0-9')
    expect(d).not.toContain('hide@2-3')
    expect(d.some((x) => x.startsWith('mark:mdo-link@2'))).toBe(false)
  })
})

describe('alert titles follow the lang field', () => {
  const title = (text: string) => alertTitle(EditorState.create({ doc: text }), 'warning')
  it.each([
    ['no front matter', '> x', 'Hinweis'],
    ['lang de', '---\nlang: de\n---\n', 'Hinweis'],
    ['lang de-AT', '---\nlang: "de-AT"\n---\n', 'Hinweis'],
    ['lang en', '---\nlang: en\n---\n', 'Warning'],
    ['lang en-GB', '---\nlang: en-GB\n---\n', 'Warning'],
    ['other lang falls back to en like template.typ', '---\nlang: fr\n---\n', 'Warning'],
  ])('%s', (_name, doc, expected) => {
    expect(title(doc)).toBe(expected)
  })
  it('maps every kind in English', () => {
    const s = EditorState.create({ doc: '---\nlang: en\n---\n' })
    expect(['note', 'tip', 'important', 'warning', 'caution'].map((k) => alertTitle(s, k))).toEqual(
      ['Note', 'Tip', 'Important', 'Warning', 'Caution'],
    )
  })
})

describe('tables, code, rules', () => {
  it('table rows while editing (cursor inside)', () => {
    const d = rf('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', 1)
    expect(d).toEqual(
      expect.arrayContaining([
        'line:mdo-table-head@0-0',
        'line:mdo-table-delim@10-10',
        'line:mdo-table-row@20-20',
        'line:mdo-table-row mdo-table-stripe@30-30',
      ]),
    )
  })
  it('table away from the cursor is left to the widget', () => {
    expect(rf('| a | b |\n|---|---|\n| 1 | 2 |').some((d) => d.includes('mdo-table'))).toBe(false)
  })
  it('fenced code', () => {
    expect(rf('```js\nlet a = 1\n```')).toEqual(
      expect.arrayContaining([
        'line:mdo-codefence@0-0',
        'line:mdo-codeblock@6-6',
        'line:mdo-codefence@16-16',
      ]),
    )
  })
  it('~~~ fence and unclosed fence', () => {
    expect(rf('~~~\nx\n~~~')).toEqual(
      expect.arrayContaining([
        'line:mdo-codefence@0-0',
        'line:mdo-codeblock@4-4',
        'line:mdo-codefence@6-6',
      ]),
    )
    const open = rf('```\nx')
    expect(open).toEqual(
      expect.arrayContaining(['line:mdo-codefence@0-0', 'line:mdo-codeblock@4-4']),
    )
  })
  it('fence inside a blockquote', () => {
    const d = rf('> ```\n> x\n> ```')
    expect(d).toEqual(
      expect.arrayContaining([
        'line:mdo-codefence@0-0',
        'line:mdo-codeblock@6-6',
        'line:mdo-codefence@10-10',
      ]),
    )
  })
  it('indented code', () => {
    expect(rf('Text\n\n    code')).toContain('line:mdo-codeblock@6-6')
  })
  it('horizontal rule', () => {
    expect(rf('Text\n\n***')).toEqual(expect.arrayContaining(['line:mdo-hr@6-6', 'hide@6-9']))
  })
})

describe('toggleTaskAt', () => {
  const state = (doc: string) => EditorState.create({ doc })
  it('changes exactly one character, both ways', () => {
    const s = state('- [ ] a\n- [x] b')
    const on = s.update(toggleTaskAt(s, 2) ?? {}).state
    expect(on.doc.toString()).toBe('- [x] a\n- [x] b')
    const off = on.update(toggleTaskAt(on, 10) ?? {}).state
    expect(off.doc.toString()).toBe('- [x] a\n- [ ] b')
  })
  it('accepts [X] and refuses non-markers', () => {
    const s = state('- [X] a\nkein')
    expect(s.update(toggleTaskAt(s, 2) ?? {}).state.doc.toString()).toBe('- [ ] a\nkein')
    expect(toggleTaskAt(s, 8)).toBeNull()
  })
})

describe('TaskWidget clicks', () => {
  function mount(): EditorView {
    const view = new EditorView({
      doc: '- [ ] a\n\nende',
      selection: { anchor: 12 },
      extensions: [markdown({ base: markdownLanguage }), previewPlugin],
      parent: document.body,
    })
    ensureSyntaxTree(view.state, view.state.doc.length, 5000)
    view.dispatch({ selection: { anchor: 12 } })
    return view
  }
  it('primary button toggles exactly one character', () => {
    const view = mount()
    const box = view.dom.querySelector('.mdo-task')
    expect(box).not.toBeNull()
    box?.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }))
    expect(view.state.doc.toString()).toBe('- [x] a\n\nende')
    view.destroy()
  })
  it('other buttons leave the document alone', () => {
    const view = mount()
    const box = view.dom.querySelector('.mdo-task')
    box?.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }))
    expect(view.state.doc.toString()).toBe('- [ ] a\n\nende')
    view.destroy()
  })
})
