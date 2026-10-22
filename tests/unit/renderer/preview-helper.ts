import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { buildPreview } from '../../../src/renderer/editor/preview'
import { parsed } from './parsed'

/** Decorations as `rf@from-to`; the cursor defaults to a neutral trailing line. */
export function rf(text: string, cursor?: number): string[] {
  const doc = `${text}\n\nende`
  const state = parsed(
    EditorState.create({
      doc,
      selection: { anchor: cursor ?? doc.length },
      extensions: markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
    }),
  )
  const out: string[] = []
  buildPreview(state).between(0, state.doc.length, (from, to, d) => {
    out.push(`${(d.spec as { rf: string }).rf}@${from}-${to}`)
  })
  return out
}
