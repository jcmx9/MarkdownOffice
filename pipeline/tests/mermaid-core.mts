// The TypeScript side of pipeline/tests/test-mermaid.sh: draws the same fixtures as mermaid.typ
// with src/core/mermaid.ts (the plugin host in src/core/typst-plugin.ts running the bundled
// typst_mmdr.wasm) and compares each SVG byte for byte with Typst's (JSON from `typst eval`).
// Then checks the committed reference SVGs in tests/fixtures/mermaid/ (what the e2e test shows),
// or rewrites them with --update. Run directly by Node (type stripping).
//
// Usage: node pipeline/tests/mermaid-core.mts <wasm> <fixture dir> <typst.json> <reference dir> [--update]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MEMO_MERMAID, renderMermaid } from '../../src/core/mermaid.ts'
import { loadTypstPlugin } from '../../src/core/typst-plugin.ts'

const [wasm, fixtureDir, typstJson, refDir, flag] = process.argv.slice(2)
if (!wasm || !fixtureDir || !typstJson || !refDir || (flag && flag !== '--update')) {
  console.error(
    'usage: mermaid-core.mts <wasm> <fixture dir> <typst.json> <reference dir> [--update]',
  )
  process.exit(2)
}
const update = flag === '--update'
const plugin = await loadTypstPlugin(new Uint8Array(readFileSync(wasm)))
const typst = JSON.parse(readFileSync(typstJson, 'utf8')) as Record<string, string>
const names = readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.mmd'))
  .map((f) => f.slice(0, -'.mmd'.length))
  .sort()
let failures = 0
for (const name of names) {
  const got = renderMermaid(
    plugin,
    readFileSync(join(fixtureDir, `${name}.mmd`), 'utf8'),
    MEMO_MERMAID,
  )
  const expected = typst[name]
  if (got !== expected) {
    failures++
    const exp = expected ?? ''
    let at = 0
    while (at < got.length && got[at] === exp[at]) at++
    console.error(`${name}: core SVG differs from Typst's at offset ${at}`)
    console.error(`  typst: ${JSON.stringify(exp.slice(Math.max(0, at - 60), at + 80))}`)
    console.error(`  core:  ${JSON.stringify(got.slice(Math.max(0, at - 60), at + 80))}`)
    continue
  }
  const ref = join(refDir, `${name}.svg`)
  if (update) {
    writeFileSync(ref, got)
  } else if (!existsSync(ref) || readFileSync(ref, 'utf8') !== got) {
    failures++
    console.error(
      `${name}: ${ref} is missing or stale (bash pipeline/tests/test-mermaid.sh --update)`,
    )
  }
}
if (failures > 0) {
  console.error(`${failures} difference(s) between Typst, src/core/mermaid.ts and ${refDir}`)
  process.exit(1)
}
console.log(
  `mermaid parity: ${names.length} diagrams identical${update ? `, references written to ${refDir}` : ''}`,
)
