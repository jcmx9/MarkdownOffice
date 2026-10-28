import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
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
import {
  drawSelection,
  EditorView,
  type KeyBinding,
  keymap,
  lineNumbers,
  type Rect,
  tooltips,
} from '@codemirror/view'
import type { Eol, Mode, View } from '../../shared/types'
import { diagrams } from './diagrams'
import { focusCompartment, focusExtensions } from './focus'
import { footBlock } from './footblock'
import { frontmatterRange } from './frontmatter'
import { headerFold, headerHidden } from './header'
import { mdoHighlight } from './highlight'
import { mdoMarkdown } from './markdown'
import { math } from './math'
import { mermaid } from './mermaid'
import { modeCompartment, modeExtensions } from './mode'
import { pageBreakKeymap } from './pagebreak'
import { paragraphsPlugin } from './paragraphs'
import { previewPlugin } from './preview'
import { previewSource } from './preview-source'
import { previewView } from './rendered'
import { searchExtensions } from './search'
import { foldAllSections, unfoldOnCursor } from './sections'
import { snippetExtensions } from './snippets'
import { spellcheckCompartment, spellcheckExtensions } from './spellcheck'
import { cellEditing } from './table-cell-edit'
import { tableField } from './tables'
import { typoMask } from './typo-mask'
import { wrapTyping } from './wrap-typing'

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
        previewView.of(true),
        typoMask,
        previewPlugin,
        // after previewPlugin: it reads the preview's decorations of the lines it sets
        paragraphsPlugin,
        tableField,
        // Cells of the drawn tables are edited in place (never as Markdown in the preview).
        cellEditing,
        // Mermaid blocks as the PDF draws them; one plugin and cache for every tab.
        diagrams.extension,
        // Formulas as the PDF sets them (bundled Typst + mitex); one service and cache per window.
        math.extension,
        headerFold,
        footBlock,
      ]
}

/**
 * The space tooltips (snippet autocomplete) may use: the editor's host (#editor), not the
 * window. #editor has `contain: paint`, so a tooltip placed by the window's bounds would be cut
 * off under the status line or beside the outline; inside this box CodeMirror flips and
 * shrinks it so it stays visible.
 */
export function tooltipSpace(view: EditorView): Rect {
  return (view.dom.parentElement ?? view.dom).getBoundingClientRect()
}

/** What a tab holds: a Markdown note, or a YAML profile opened for editing („Profil anlegen …“). */
export type DocKind = 'markdown' | 'yaml'

export function createState(
  text: string,
  eol: Eol,
  view: View,
  headerHiddenInit = false,
  mode: Mode = 'edit',
  spellcheck = false,
  kind: DocKind = 'markdown',
  focus = false,
): EditorState {
  const md = kind === 'markdown'
  const state = EditorState.create({
    doc: text,
    extensions: [
      eol === 'mixed' ? EditorState.lineSeparator.of('\n') : [],
      history(),
      drawSelection(),
      codeFolding(),
      // A profile is YAML: no snippets or page breaks, and YAML highlighting, so a `# comment`
      // line is not taken for a heading (outline, section folds).
      // Typing `*`, `~~` or `==` over selected text wraps it (wrap-typing.ts).
      md ? [snippetExtensions, pageBreakKeymap, wrapTyping] : [],
      unfoldOnCursor,
      keymap.of([...foldBindings(), ...defaultKeymap, ...historyKeymap, indentWithTab]),
      searchExtensions,
      md ? mdoMarkdown([...languages, mermaid]) : yaml(),
      mdoHighlight,
      headerHidden.init(() => headerHiddenInit),
      // Every tab keeps its own set description; null (built-in memo) until main answers.
      previewSource,
      EditorView.lineWrapping,
      tooltips({ tooltipSpace }),
      viewCompartment.of(viewExtensions(view)),
      modeCompartment.of(modeExtensions(mode)),
      // New tabs start with the stored setting, so no tab misses it before a reconfigureAll.
      spellcheckCompartment.of(spellcheckExtensions(spellcheck, mode)),
      closingCompartment.of(closingExtensions(false)),
      // A profile has no sections to focus on; Code shows the full source (owner, 2026-10-28).
      focusCompartment.of(focusExtensions(focus && md && view === 'preview')),
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
