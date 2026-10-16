import {
  ensureSyntaxTree,
  foldable,
  foldEffect,
  foldedRanges,
  syntaxTree,
  unfoldEffect,
} from '@codemirror/language'
import { EditorState, type StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** Fold ranges of every heading's section (lang-markdown's header fold service). */
export function sectionFoldRanges(state: EditorState): { from: number; to: number }[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const out: { from: number; to: number }[] = []
  tree.iterate({
    enter: (node) => {
      if (node.name === 'Frontmatter') return false
      if (/^(ATX|Setext)Heading\d$/.test(node.name)) {
        const line = state.doc.lineAt(node.from)
        const range = foldable(state, line.from, line.to)
        if (range) out.push(range)
        return false
      }
      return undefined
    },
  })
  return out
}

/** "Alle einklappen": every heading section, the outline stays visible. */
export function foldAllSections(view: EditorView): boolean {
  const ranges = sectionFoldRanges(view.state)
  if (!ranges.length) return false
  view.dispatch({ effects: ranges.map((r) => foldEffect.of(r)) })
  return true
}

/**
 * A cursor or selection head that lands strictly inside a folded range unfolds it, so a
 * tab stop or caret is never hidden. Uses the start state's folds mapped through the
 * transaction's changes: `tr.state` inside an extender would force a second, throw-away
 * state computation. The header collapse is a decoration, not a code fold, and is unaffected.
 */
export const unfoldOnCursor = EditorState.transactionExtender.of((tr) => {
  if (!tr.selection && !tr.docChanged) return null
  const folded = foldedRanges(tr.startState).map(tr.changes)
  if (folded.size === 0) return null
  const effects: StateEffect<{ from: number; to: number }>[] = []
  for (const r of tr.newSelection.ranges) {
    folded.between(r.from, r.to, (from, to) => {
      if (r.head > from && r.head < to) effects.push(unfoldEffect.of({ from, to }))
    })
  }
  return effects.length ? { effects } : null
})
