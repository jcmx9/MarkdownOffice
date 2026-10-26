import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
const iconDir = join(root, 'resources', 'toolbar-icons')
const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
// Line breaks differ between the notice and Lucide's LICENSE; compare the words only.
const flat = (s: string) => s.replace(/\s+/g, ' ')

describe('toolbar icons licence', () => {
  it('names every file in resources/toolbar-icons in THIRD_PARTY_NOTICES.md', () => {
    const files = readdirSync(iconDir)
    expect(files).toContain('LICENSE')
    for (const f of files) expect(notices, f).toContain(`\`${f}\``)
  })

  it('carries the ISC text and the Feather MIT notice of Lucide', () => {
    expect(notices).toMatch(/## Lucide \d+\.\d+\.\d+ - ISC/)
    expect(flat(notices)).toContain(
      flat(`Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.`),
    )
    expect(notices).toContain('Copyright (c) 2026 Lucide Icons and Contributors')
    expect(notices).toContain('Copyright (c) 2013-present Cole Bemis')
  })

  it('names the same Lucide version as the SVGs', () => {
    const version = notices.match(/## Lucide (\d+\.\d+\.\d+)/)?.[1]
    for (const f of readdirSync(iconDir).filter((n) => n.endsWith('.svg'))) {
      expect(readFileSync(join(iconDir, f), 'utf8'), f).toContain(`lucide-static v${version} - ISC`)
    }
  })

  it('ships plain vector icons only: no scripts, styles, links or foreign content', () => {
    for (const f of readdirSync(iconDir).filter((n) => n.endsWith('.svg'))) {
      const svg = readFileSync(join(iconDir, f), 'utf8')
      const tags = new Set([...svg.matchAll(/<([a-zA-Z][\w:-]*)/g)].map((m) => m[1]))
      for (const t of tags)
        expect(['svg', 'path', 'line', 'rect', 'circle', 'polyline'], f).toContain(t)
      expect(svg, f).not.toMatch(/href|\bon[a-z]+\s*=|url\(|style/i)
    }
  })
})
