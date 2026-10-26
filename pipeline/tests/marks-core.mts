// The TypeScript side of pipeline/tests/test-marks.sh: wraps every span src/core/highlight.ts
// finds in <mark>…</mark> (outside the lines typography.ts skipMask masks, as marks() skips
// skip-mask's lines) and compares with Typst's marks() over the same fixture.
// Run directly by Node (type stripping), so the core files must not import anything.
//
// Usage: node pipeline/tests/marks-core.mts <fixture.txt> <typst.json>
import { readFileSync } from 'node:fs'
import { highlightSpans } from '../../src/core/highlight.ts'
import { skipMask } from '../../src/core/typography.ts'

const [fixture, typstJson] = process.argv.slice(2)
if (!fixture || !typstJson) {
  console.error('usage: marks-core.mts <fixture.txt> <typst.json>')
  process.exit(2)
}
const lines = readFileSync(fixture, 'utf8').split('\n')
const expected = JSON.parse(readFileSync(typstJson, 'utf8')) as string[]
if (expected.length !== lines.length) {
  console.error(`Typst returned ${expected.length} lines, the fixture has ${lines.length}`)
  process.exit(1)
}

/** markdown.typ's replacement: `==x==` -> `<mark>x</mark>`, spans from right to left. */
function marked(line: string): string {
  let out = line
  for (const s of highlightSpans(line).reverse()) {
    out = `${out.slice(0, s.from)}<mark>${out.slice(s.from + 2, s.to - 2)}</mark>${out.slice(s.to)}`
  }
  return out
}

const mask = skipMask(lines)
let failures = 0
lines.forEach((line, i) => {
  const got = mask[i] ? line : marked(line)
  if (got !== expected[i]) {
    failures++
    console.error(`line ${i + 1}: ${JSON.stringify(line)}`)
    console.error(`  typst: ${JSON.stringify(expected[i])}`)
    console.error(`  core:  ${JSON.stringify(got)}`)
  }
})
if (failures > 0) {
  console.error(`${failures} difference(s) between Typst and src/core/highlight.ts`)
  process.exit(1)
}
console.log(`marks parity: ${lines.length} lines identical`)
