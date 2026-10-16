import type { SnippetDef } from '../../shared/types'

const files = import.meta.glob('../../../resources/snippets/*.tpl.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const BUILTIN_SNIPPETS: readonly SnippetDef[] = Object.entries(files)
  .map(([path, body]) => ({
    name: path.slice(path.lastIndexOf('/') + 1, -'.tpl.md'.length),
    body,
    source: 'builtin' as const,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))
