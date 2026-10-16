import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippet,
} from '@codemirror/autocomplete'
import { type Extension, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { SnippetDef } from '../../shared/types'
import { BUILTIN_SNIPPETS } from './builtin-snippets'
import { toCmTemplate } from './snippet-parser'

let merged: readonly SnippetDef[] = BUILTIN_SNIPPETS

export const snippetRegistry = {
  list: (): readonly SnippetDef[] => merged,
  setUser(user: readonly SnippetDef[]): void {
    const byName = new Map(BUILTIN_SNIPPETS.map((s) => [s.name, s]))
    for (const s of user) byName.set(s.name, s)
    merged = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  },
}

const option = (s: SnippetDef): Completion => ({
  label: `:${s.name}`,
  detail: s.source === 'user' ? 'eigenes Snippet' : 'Snippet',
  type: 'text',
  // Variables are expanded when the snippet is applied, not when the list opens.
  apply: (view, completion, from, to) =>
    snippet(toCmTemplate(s.body, new Date()))(view, completion, from, to),
})

/** `:` at line start or after whitespace, followed by at least one letter (or explicit). */
export function snippetSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|\s):[\p{L}\p{M}\p{N}_-]*$/u)
  if (!m) return null
  const colon = m.from + m.text.indexOf(':')
  if (colon === ctx.pos - 1 && !ctx.explicit) return null
  // Strict, case-insensitive prefix match: `:D`, `:P` (emoticons) match nothing, so Enter stays a newline.
  const typed = m.text.slice(m.text.indexOf(':') + 1).toLowerCase()
  const options = merged.filter((s) => s.name.toLowerCase().startsWith(typed)).map(option)
  if (options.length === 0) return null
  return {
    from: colon,
    options,
    filter: false,
  }
}

export const snippetExtensions: Extension = [
  autocompletion({ override: [snippetSource], icons: false, defaultKeymap: true }),
  Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
]
