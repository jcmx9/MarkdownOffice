import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALERT_ENTRIES } from '../../../src/renderer/editor/format'

/**
 * The Box menu names its entries with the German keyword aliases the pipeline accepts (spec
 * „Box ▾“: labels come from the pipeline contract, not from a set). This keeps the five entries
 * in sync with `alert-kinds` in pipeline/lib/markdown.typ.
 */
describe('ALERT_ENTRIES and the pipeline alias list', () => {
  const typ = readFileSync(resolve(__dirname, '../../../pipeline/lib/markdown.typ'), 'utf8')
  const block = /#let alert-kinds = \(([\s\S]*?)\n\)/.exec(typ)?.[1] ?? ''
  const pairs = [...block.matchAll(/([A-Z]+):\s*"([a-z]+)"/g)].map((m) => [m[1], m[2]])
  const keywords = new Set(ALERT_ENTRIES.map((e) => e.keyword))

  it('finds the alias list', () => {
    expect(pairs.length).toBe(10)
  })

  it('maps every GFM keyword to its entry type', () => {
    for (const e of ALERT_ENTRIES) expect(pairs).toContainEqual([e.keyword, e.type])
  })

  it('labels the entries with the German aliases, in order', () => {
    const aliases = pairs.filter(([k]) => !keywords.has(k as never))
    expect(aliases.map(([k]) => k)).toEqual(ALERT_ENTRIES.map((e) => e.label.toUpperCase()))
    expect(aliases.map(([, kind]) => kind)).toEqual(ALERT_ENTRIES.map((e) => e.type))
  })
})
