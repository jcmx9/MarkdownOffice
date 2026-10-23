// @vitest-environment happy-dom
import { cursorDocEnd } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { parsePreviewSpec } from '../../../src/core/preview-spec'
import { footBlock } from '../../../src/renderer/editor/footblock'
import {
  headCollapsed,
  headerToggleSpec,
  setHeaderHidden,
} from '../../../src/renderer/editor/header'
import { modeCompartment, modeExtensions } from '../../../src/renderer/editor/mode'
import { type PreviewSource, setPreviewSource } from '../../../src/renderer/editor/preview-source'
import { createState, viewCompartment, viewExtensions } from '../../../src/renderer/editor/setup'

const DESC = `preview: 1
head:
  - class: subject
    text: "{x-subject}"
foot:
  - class: closing
    text: "{x-closing}"
  - class: signature
    image: "{profile.signature}"
    when: "{x-closing}"
  - class: attachments
    label: "Anlagen:"
    lines: "{x-attachments}"
`
const NOTE = '---\nx-subject: Angebot\nx-closing: Gruß\nx-attachments: [Angebot, AGB]\n---\n\nText'
const SIG = 'data:image/svg+xml;base64,PHN2Zy8+'

function source(desc = DESC): PreviewSource {
  const spec = parsePreviewSpec(desc)
  if (!spec.ok) throw new Error(spec.error)
  return { set: 'brief', spec: spec.spec, profile: {}, signature: SIG }
}

function view(hidden: boolean, withSource = true) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const v = new EditorView({ state: createState(NOTE, '\n', 'preview', hidden), parent })
  if (withSource) v.dispatch({ effects: setPreviewSource.of(source()) })
  return v
}

const foot = (v: EditorView) => v.contentDOM.querySelector('.mdo-footblock')

/** Positions of the foot widgets in the state's decoration set. */
function footAt(v: EditorView): number[] {
  const out: number[] = []
  v.state.field(footBlock).between(0, v.state.doc.length, (from, _to, deco) => {
    if (deco.spec.widget) out.push(from)
  })
  return out
}

describe('footBlock', () => {
  it('foot appears after the last line with the header hidden and in Present, never otherwise', () => {
    const v = view(false)
    expect(foot(v)).toBeNull()
    // The toggle moves the cursor off the header, as the menu does (the head collapses with it).
    v.dispatch(headerToggleSpec(v.state, true))
    expect(footAt(v)).toEqual([NOTE.length])
    const el = foot(v)
    expect(el?.querySelector('.mdo-tb-closing')?.textContent).toBe('Gruß')
    expect(el?.querySelector('img.mdo-tb-signature')?.getAttribute('src')).toBe(SIG)
    expect([...(el?.querySelectorAll('.mdo-tb-line') ?? [])].map((l) => l.textContent)).toEqual([
      'Angebot',
      'AGB',
    ])
    expect(el?.querySelector('.mdo-tb-label')?.textContent).toBe('Anlagen:')
    // After the last body line in the DOM.
    expect(v.contentDOM.lastElementChild).toBe(el)
    v.dispatch({ effects: setHeaderHidden.of(false) })
    expect(foot(v)).toBeNull()
    v.dispatch({ effects: modeCompartment.reconfigure(modeExtensions('present')) })
    expect(foot(v)).not.toBeNull()
    v.dispatch({ effects: viewCompartment.reconfigure(viewExtensions('code')) })
    expect(foot(v)).toBeNull()
    v.destroy()
  })

  it('no foot for memo (built-in) or without a closed front matter', () => {
    const v = view(true, false)
    expect(foot(v)).toBeNull()
    v.dispatch({ effects: setPreviewSource.of(source()) })
    expect(foot(v)).not.toBeNull()
    // Unfiltered: the collapsed header is read-only for user edits.
    v.dispatch({ changes: { from: 0, to: 3 }, filter: false })
    expect(foot(v)).toBeNull()
    v.destroy()
  })

  it('a source effect rebuilds head and foot', () => {
    const v = view(true)
    expect(v.contentDOM.querySelector('.mdo-tb-subject')?.textContent).toBe('Angebot')
    expect(foot(v)?.querySelector('.mdo-tb-closing')).not.toBeNull()
    const other = `preview: 1\nhead:\n  - class: title\n    text: "{x-subject}!"\nfoot:\n  - class: signer\n    text: "{x-closing}?"\n`
    v.dispatch({ effects: setPreviewSource.of(source(other)) })
    expect(v.contentDOM.querySelector('.mdo-tb-title')?.textContent).toBe('Angebot!')
    expect(v.contentDOM.querySelector('.mdo-tb-subject')).toBeNull()
    expect(foot(v)?.querySelector('.mdo-tb-signer')?.textContent).toBe('Gruß?')
    expect(foot(v)?.querySelector('.mdo-tb-closing')).toBeNull()
    v.dispatch({ effects: setPreviewSource.of(null) })
    expect(foot(v)).toBeNull()
    v.destroy()
  })

  it('the cursor cannot enter the foot (selection at doc end stays at doc.length)', () => {
    const v = view(true)
    cursorDocEnd(v)
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
    v.dispatch(v.state.replaceSelection('!'))
    expect(v.state.doc.toString()).toBe(`${NOTE}!`)
    expect(footAt(v)).toEqual([NOTE.length + 1])
    expect(v.contentDOM.lastElementChild).toBe(foot(v))
    v.destroy()
  })

  it('a header-only note shows no foot (its header stays open)', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const doc = '---\nx-closing: Gruß\n---'
    const v = new EditorView({ state: createState(doc, '\n', 'preview', true), parent })
    v.dispatch({ effects: setPreviewSource.of(source()) })
    expect(v.contentDOM.querySelector('.mdo-titleblock')).toBeNull()
    expect(foot(v)).toBeNull()
    v.destroy()
  })

  it('follows the head: no foot while the cursor keeps the header open, foot once it leaves', () => {
    // Header hidden while the cursor is on it (outside Present): the header stays open.
    const v = view(false)
    v.dispatch({ selection: { anchor: 0 } })
    v.dispatch({ effects: setHeaderHidden.of(true) })
    expect(headCollapsed(v.state)).toBe(false)
    expect(foot(v)).toBeNull()
    // A selection change alone (no doc change, no effect) collapses the head and shows the foot.
    v.dispatch({ selection: { anchor: v.state.doc.length } })
    expect(headCollapsed(v.state)).toBe(true)
    expect(footAt(v)).toEqual([NOTE.length])
    expect(foot(v)).not.toBeNull()
    v.destroy()
  })

  it('starts one paragraph gap below the text, however many blank lines end the note', () => {
    const gapped = (doc: string) => {
      const parent = document.createElement('div')
      document.body.append(parent)
      const v = new EditorView({ state: createState(doc, '\n', 'preview', true), parent })
      v.dispatch({ effects: setPreviewSource.of(source()) })
      v.dispatch({ selection: { anchor: 0 } })
      return v
    }
    for (const doc of [NOTE, `${NOTE}\n`, `${NOTE}\n\n\n`]) {
      const v = gapped(doc)
      // The foot carries the gap itself …
      expect(foot(v)?.firstElementChild?.className).toBe('mdo-footblock-gap')
      // … and every trailing blank line collapses.
      const trailing = doc.length - NOTE.length
      expect(v.contentDOM.querySelectorAll('.cm-line.mdo-foot-gap').length).toBe(trailing)
      v.destroy()
    }
  })

  it('a trailing blank line holding the cursor keeps its height', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const doc = `${NOTE}\n\n`
    const v = new EditorView({ state: createState(doc, '\n', 'preview', true), parent })
    v.dispatch({ effects: setPreviewSource.of(source()) })
    v.dispatch({ selection: { anchor: 0 } })
    expect(v.contentDOM.querySelectorAll('.cm-line.mdo-foot-gap').length).toBe(2)
    v.dispatch({ selection: { anchor: doc.length } })
    expect(v.contentDOM.querySelectorAll('.cm-line.mdo-foot-gap').length).toBe(1)
    v.destroy()
  })

  it('no gap without a foot to show (no closing)', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const doc = '---\nx-subject: Angebot\n---\n\nText\n'
    const v = new EditorView({ state: createState(doc, '\n', 'preview', true), parent })
    v.dispatch({ effects: setPreviewSource.of(source()) })
    expect(v.contentDOM.querySelector('.mdo-footblock-gap')).toBeNull()
    v.destroy()
  })
})
