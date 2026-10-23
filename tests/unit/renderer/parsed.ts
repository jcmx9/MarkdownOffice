import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/**
 * The state with its complete syntax tree. ensureSyntaxTree() finishes the parse only in the
 * parser's context; syntaxTree(state) keeps returning the tree the state got when it was
 * created (20 ms of parse work), which on a slow CI runner can end mid-document. An empty
 * transaction copies the finished tree into a new state, so code reading syntaxTree() sees it.
 */
export function parsed(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state.update({}).state
}
