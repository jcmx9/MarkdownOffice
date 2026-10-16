import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { buildPreview } from '../../../src/renderer/editor/preview'

/** Decorations as `rf@from-to`; the cursor defaults to a neutral trailing line. */
export function rf(text: string, cursor?: number): string[] {
  const doc = `${text}\n\nende`
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor ?? doc.length },
    extensions: markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const out: string[] = []
  buildPreview(state).between(0, state.doc.length, (from, to, d) => {
    out.push(`${(d.spec as { rf: string }).rf}@${from}-${to}`)
  })
  return out
}
