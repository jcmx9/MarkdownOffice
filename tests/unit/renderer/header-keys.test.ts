import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_SNIPPETS } from '../../../src/renderer/editor/builtin-snippets'

const KEY = /^([a-z][a-z0-9_-]*):/gm
const keys = (text: string): string[] => [...text.matchAll(KEY)].map((m) => m[1] as string)

/** key -> default value: tabstops resolved to their default, comments and quotes dropped. */
function defaults(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/^([a-z][a-z0-9_-]*):[ \t]*(.*)$/gm)) {
    const value = (m[2] as string)
      .replace(/\s+#.*$/, '')
      .replace(/\$\{\d+:([^}]*)\}/g, '$1')
      .replace(/\$\d+/g, '')
      .trim()
      .replace(/^"(.*)"$/, '$1')
    out[m[1] as string] = value
  }
  return out
}

/** Prefilled on purpose in the snippet: a title to type over and today's date. */
const PREFILLED = new Set(['title', 'date'])

// The `memo` set's header is the source of truth: from the fetched assets (npm run assets),
// else from a local checkout of the set repo next to this one.
const candidates = [
  join(__dirname, '..', '..', '..', 'build', 'pipeline-assets', 'sets', 'memo', 'memo.header.md'),
  join(homedir(), 'GitHub', 'MarkdownOffice-set-memo', 'memo.header.md'),
]
const headerMd = candidates.find((p) => existsSync(p))
const skip = headerMd
  ? false
  : `memo.header.md not found in ${candidates.join(', ')} – run npm run assets`

describe(':header snippet', () => {
  it.skipIf(skip)('has exactly the keys of the memo set header', () => {
    const header = BUILTIN_SNIPPETS.find((s) => s.name === 'header')
    expect(keys(header?.body ?? '')).toEqual(keys(readFileSync(headerMd as string, 'utf8')))
  })
  it.skipIf(skip)('has the default values of the memo set header', () => {
    const header = BUILTIN_SNIPPETS.find((s) => s.name === 'header')
    const ours = defaults(header?.body ?? '')
    const theirs = defaults(readFileSync(headerMd as string, 'utf8'))
    for (const key of Object.keys(theirs)) {
      if (PREFILLED.has(key)) continue
      expect(ours[key], key).toBe(theirs[key])
    }
  })
  if (skip) it.skip(skip, () => undefined)
})
