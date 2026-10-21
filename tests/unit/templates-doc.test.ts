import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIELD_TYPES } from '../../src/core/frontmatter-schema'

// TEMPLATES.md documents every Typst input (`sys.inputs`) a template set receives. This test
// keeps the guide in sync with the inputs that build.sh and convert.ps1 really pass.
const root = resolve(__dirname, '../..')
const read = (file: string): string => readFileSync(join(root, file), 'utf8')

/**
 * Names of all `--input name=…` arguments in a script. Covers build.sh (`--input "name=…"`,
 * `--input name=…`) and convert.ps1 (`'--input', "name=…"`, `'--input', ('name=' + …)`).
 */
function inputNames(script: string): string[] {
  const names = new Set<string>()
  for (const m of script.matchAll(/--input'?,?\s*\(?["']?([a-z0-9_]+)=/g)) {
    if (m[1]) names.add(m[1])
  }
  return [...names].sort()
}

const bash = inputNames(read('pipeline/build.sh'))
const ps1 = inputNames(read('pipeline/convert.ps1'))
const guide = read('TEMPLATES.md')

describe('TEMPLATES.md', () => {
  it('finds the inputs in both scripts', () => {
    for (const name of ['source', 'h1_break', 'mdo', 'images', 'probe']) {
      expect(bash).toContain(name)
      expect(ps1).toContain(name)
    }
  })

  it('build.sh and convert.ps1 pass the same inputs', () => {
    expect(ps1).toEqual(bash)
  })

  it.each(bash)('documents the input `%s`', (name) => {
    expect(guide).toContain(`\`${name}\``)
  })

  it.each(FIELD_TYPES)('documents the schema type `%s`', (type) => {
    expect(guide).toContain(`\`${type}\``)
  })
})
