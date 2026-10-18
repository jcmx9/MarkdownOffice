import { syntaxTree } from '@codemirror/language'
import { Compartment, type Extension, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import type { Mode } from '../../shared/types'

/**
 * Where spell checking applies. Chromium checks a contenteditable with spellcheck="true";
 * children with spellcheck="false" are skipped. Present never checks (clients watch), and
 * code blocks and the YAML front matter would be almost all false alarms.
 */
export const spellcheckCompartment = new Compartment()

const noSpell = Decoration.line({ attributes: { spellcheck: 'false' } })
const SKIP = new Set(['FencedCode', 'CodeBlock', 'Frontmatter'])

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  // Visible ranges can touch the same node twice; a line may be decorated only once.
  const seen = new Set<number>()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (n) => {
        if (!SKIP.has(n.name)) return undefined
        for (let pos = n.from; pos <= n.to; ) {
          const line = view.state.doc.lineAt(pos)
          if (!seen.has(line.from)) {
            seen.add(line.from)
            b.add(line.from, line.from, noSpell)
          }
          pos = line.to + 1
        }
        return false
      },
    })
  }
  return b.finish()
}

/** Marks every line of code blocks and front matter as not to be spell checked. */
export const noSpellLines: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = build(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)

export function spellcheckExtensions(on: boolean, mode: Mode): Extension {
  const active = on && mode === 'edit'
  return [
    EditorView.contentAttributes.of({ spellcheck: active ? 'true' : 'false' }),
    active ? noSpellLines : [],
  ]
}

/**
 * Applies a spelling correction from the context menu: replaces exactly `word` at `pos` (from
 * the click coordinates) with `replacement`, as one undoable input transaction that autosave
 * writes. Refuses when the text there is no longer that word (typed on meanwhile), so a
 * correction never lands on the wrong word.
 */
export function replaceWordAt(
  view: EditorView,
  pos: number | null,
  word: string,
  replacement: string,
): boolean {
  if (pos === null) return false
  const range = view.state.wordAt(pos)
  if (!range || view.state.sliceDoc(range.from, range.to) !== word) return false
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: replacement },
    selection: { anchor: range.from + replacement.length },
    userEvent: 'input.spellcheck',
  })
  return true
}

/** Reports a note's lang: to main only when it changed since the last report. */
export class SpellLanguageTracker {
  private last: string | null = null
  next(lang: string): boolean {
    if (lang === this.last) return false
    this.last = lang
    return true
  }
  /** Forget the last value so the next call reports again (after a dictionary download). */
  reset(): void {
    this.last = null
  }
}

/**
 * Whether an answer from main still belongs to what is shown: the tab and its lang: must be
 * unchanged since the question, else the banner would name a language of another note.
 */
export function spellAnswerCurrent(
  asked: { id: number | null; lang: string },
  now: { id: number | null; lang: string },
): boolean {
  return asked.id === now.id && asked.lang === now.lang
}
