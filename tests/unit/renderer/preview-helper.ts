import { EditorState } from '@codemirror/state'
import { mdoMarkdown } from '../../../src/renderer/editor/markdown'
import { buildPreview } from '../../../src/renderer/editor/preview'
import { parsed } from './parsed'

/** Decorations as `rf@from-to`; the cursor defaults to a neutral trailing line. */
export function rf(text: string, cursor?: number): string[] {
  const doc = `${text}\n\nende`
  const state = parsed(
    EditorState.create({
      doc,
      selection: { anchor: cursor ?? doc.length },
      extensions: mdoMarkdown(), // the editor's own parser: formulas and ==highlights== parse as in the app
    }),
  )
  const out: string[] = []
  buildPreview(state).between(0, state.doc.length, (from, to, d) => {
    out.push(`${(d.spec as { rf: string }).rf}@${from}-${to}`)
  })
  return out
}
