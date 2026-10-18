import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { codeFolding, foldGutter, foldKeymap, unfoldAll } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import {
  Compartment,
  EditorState,
  type Extension,
  Facet,
  type Text,
  type TransactionSpec,
} from '@codemirror/state'
import { drawSelection, EditorView, type KeyBinding, keymap, lineNumbers } from '@codemirror/view'
import type { Eol, Mode, View } from '../../shared/types'
import { frontmatterRange } from './frontmatter'
import { headerFold, headerHidden } from './header'
import { mdoHighlight } from './highlight'
import { mdoMarkdown } from './markdown'
import { mermaid } from './mermaid'
import { modeCompartment, modeExtensions } from './mode'
import { pageBreakKeymap } from './pagebreak'
import { previewPlugin } from './preview'
import { foldAllSections, unfoldOnCursor } from './sections'
import { snippetExtensions } from './snippets'
import { spellcheckCompartment, spellcheckExtensions } from './spellcheck'
import { tableField } from './tables'

export const viewCompartment = new Compartment()

/** Input freeze while the window closes: every keystroke is either saved or confirmed lost. */
export const closingCompartment = new Compartment()

const inputFrozen = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) })

function closingExtensions(frozen: boolean): Extension {
  if (!frozen) return []
  return [
    inputFrozen.of(true),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    // readOnly only stops user input; this also drops programmatic edits (snippet completion,
    // checkbox toggles, page breaks) that would otherwise land after the last save.
    EditorState.transactionFilter.of((tr) => (tr.docChanged ? [] : tr)),
  ]
}

/** Freezes (or thaws) a state's input; works for the shown view and stored tab states alike. */
export function freezeSpec(frozen: boolean): TransactionSpec {
  return { effects: closingCompartment.reconfigure(closingExtensions(frozen)) }
}

export function isFrozen(state: EditorState): boolean {
  return state.facet(inputFrozen)
}

const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

/**
 * Fold keys. On Windows/Linux AltGr is Ctrl+Alt, so CodeMirror's `Ctrl-Alt-[`/`]` would swallow
 * typing `[`/`]` on German layouts: there fold-all is `Alt-0` / `Alt-Shift-0` instead.
 */
export function foldBindings(mac = isMacPlatform()): readonly KeyBinding[] {
  if (mac) return foldKeymap
  return [
    ...foldKeymap.filter((b) => b.key !== 'Ctrl-Alt-[' && b.key !== 'Ctrl-Alt-]'),
    { key: 'Alt-0', run: foldAllSections },
    { key: 'Alt-Shift-0', run: unfoldAll },
  ]
}

export function viewExtensions(view: View): Extension {
  return view === 'code'
    ? [lineNumbers(), foldGutter(), EditorView.editorAttributes.of({ class: 'mdo-code' })]
    : [
        foldGutter(),
        EditorView.editorAttributes.of({ class: 'mdo-preview' }),
        previewPlugin,
        tableField,
        headerFold,
      ]
}

export function createState(
  text: string,
  eol: Eol,
  view: View,
  headerHiddenInit = false,
  mode: Mode = 'edit',
  spellcheck = false,
): EditorState {
  const state = EditorState.create({
    doc: text,
    extensions: [
      eol === 'mixed' ? EditorState.lineSeparator.of('\n') : [],
      history(),
      drawSelection(),
      codeFolding(),
      snippetExtensions,
      pageBreakKeymap,
      unfoldOnCursor,
      keymap.of([...foldBindings(), ...defaultKeymap, ...historyKeymap, indentWithTab]),
      mdoMarkdown([...languages, mermaid]),
      mdoHighlight,
      headerHidden.init(() => headerHiddenInit),
      EditorView.lineWrapping,
      viewCompartment.of(viewExtensions(view)),
      modeCompartment.of(modeExtensions(mode)),
      // New tabs start with the stored setting, so no tab misses it before a reconfigureAll.
      spellcheckCompartment.of(spellcheckExtensions(spellcheck, mode)),
      closingCompartment.of(closingExtensions(false)),
    ],
  })
  const range = headerHiddenInit || mode === 'present' ? frontmatterRange(state.doc) : null
  if (!range) return state
  // Cursor right after the collapsed (atomic) header, not inside it.
  return state.update({ selection: { anchor: Math.min(range.to + 1, state.doc.length) } }).state
}

export function serializeDoc(doc: Text, eol: Eol): string {
  return eol === '\r\n' ? doc.sliceString(0, doc.length, '\r\n') : doc.toString()
}
