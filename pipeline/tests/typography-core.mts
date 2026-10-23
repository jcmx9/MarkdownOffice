// The TypeScript side of pipeline/tests/test-typography.sh: runs src/core/typography.ts over the
// same fixture as typography.typ and compares with Typst's result (JSON from `typst eval`).
// Run directly by Node (type stripping), so the core file must not import anything.
//
// Usage: node pipeline/tests/typography-core.mts <fixture.txt> <typst.json>
import { readFileSync } from 'node:fs'
import { applySubstitutions, smartTypographyLines } from '../../src/core/typography.ts'

const [fixture, typstJson] = process.argv.slice(2)
if (!fixture || !typstJson) {
  console.error('usage: typography-core.mts <fixture.txt> <typst.json>')
  process.exit(2)
}
const lines = readFileSync(fixture, 'utf8').split('\n')
const typst = JSON.parse(readFileSync(typstJson, 'utf8')) as Record<string, string[]>
let failures = 0
for (const lang of ['de', 'en']) {
  const expected = typst[lang] ?? []
  const subs = smartTypographyLines(lines, lang)
  if (expected.length !== lines.length) {
    console.error(
      `${lang}: Typst returned ${expected.length} lines, the fixture has ${lines.length}`,
    )
    failures++
    continue
  }
  lines.forEach((line, i) => {
    const got = applySubstitutions(line, subs[i] ?? [])
    if (got !== expected[i]) {
      failures++
      console.error(`${lang} line ${i + 1}: ${JSON.stringify(line)}`)
      console.error(`  typst: ${JSON.stringify(expected[i])}`)
      console.error(`  core:  ${JSON.stringify(got)}`)
    }
  })
}
if (failures > 0) {
  console.error(`${failures} difference(s) between Typst and src/core/typography.ts`)
  process.exit(1)
}
console.log(`typography parity: ${lines.length} lines × de/en identical`)
