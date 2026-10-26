import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { normalizeLabel } from './link-refs'

/**
 * Targets a Cmd/Ctrl click may open: web pages and mail. Never `file:`, `javascript:` or a
 * relative path (main checks again, see ipc.ts openExternal).
 */
export const OPENABLE = /^(https?:\/\/|mailto:)/i

/** The destination of the reference definition `[label]: dest` for `label`, or null. */
function referenceDest(state: EditorState, label: string): string | null {
  const want = normalizeLabel(label)
  let found: string | null = null
  syntaxTree(state).iterate({
    enter: (n) => {
      if (found !== null) return false
      if (n.name !== 'LinkReference') return undefined
      const l = n.node.getChild('LinkLabel')
      const url = n.node.getChild('URL')
      if (l && url && normalizeLabel(state.sliceDoc(l.from + 1, l.to - 1)) === want) {
        found = state.sliceDoc(url.from, url.to)
      }
      return false
    },
  })
  return found
}

/** A `Link` node's destination: inline `(dest)`, else its reference's, else null. */
function linkDest(state: EditorState, link: SyntaxNode): string | null {
  const url = link.getChild('URL')
  if (url) return state.sliceDoc(url.from, url.to)
  const label = link.getChild('LinkLabel')
  if (label && label.to - label.from > 2) {
    return referenceDest(state, state.sliceDoc(label.from + 1, label.to - 1))
  }
  // `[text]` / `[text][]`: the text between the first brackets is the label.
  const [open, close] = link.getChildren('LinkMark')
  if (!open || !close) return null
  return referenceDest(state, state.sliceDoc(open.to, close.from))
}

/**
 * The openable target of the link at `pos` (an inline or reference link, an `<autolink>` or a
 * bare URL), or null. Images are not links: a click on one never leaves the app.
 */
export function linkAt(state: EditorState, pos: number): string | null {
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === 'Image') return null
      let dest: string | null = null
      if (n.name === 'Link') dest = linkDest(state, n)
      else if (n.name === 'Autolink') {
        const url = n.getChild('URL')
        dest = url ? state.sliceDoc(url.from, url.to) : null
      } else if (n.name === 'URL' && n.parent?.name !== 'Link' && n.parent?.name !== 'Image') {
        dest = state.sliceDoc(n.from, n.to)
      } else continue
      return dest !== null && OPENABLE.test(dest.trim()) ? dest.trim() : null
    }
  }
  return null
}
