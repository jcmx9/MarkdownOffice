// The TypeScript side of pipeline/tests/test-math.sh, two checks over fixtures/math.md:
//
// 1. Delimiters: the editor's parser (mdoMarkdown with MathSyntax on src/core/math-delims.ts)
//    must find exactly the formulas cmarker hands the set (typst.json from math.typ), with the
//    same TeX (up to indentation at line breaks) and the same inline/display decision, in order.
// 2. Toolchain: src/main/math.ts MathRenderer (MATH_PROGRAM in its sandbox, the app's path) sets
//    the editor's formulas; every SVG must equal the one math.typ set from cmarker's TeX with the
//    PDF's toolchain (direct-*.svg), glyph outlines and positions alike, after numbering the
//    glyph ids in order.
//    A hash of each SVG is kept in fixtures/math.sha256, so a changed mitex, Typst or font set
//    shows up even though app and PDF share one copy (--update rewrites it after a deliberate
//    bump; a mitex bump must also re-check the RAW_TYPST list in src/main/math.ts).
//
// Run by Node's type stripping with ts-resolve.mjs (src/ imports without extensions).
// Usage: node --import ts-resolve.mjs math-core.mts <pipeline root> <note> <typst.json>
//          <direct svg dir> <reference file> [--update]
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { MathItem } from '../../src/core/math.ts'
import { MathRenderer } from '../../src/main/math.ts'
import { mdoMarkdown } from '../../src/renderer/editor/markdown.ts'
import { mathTex, unescapeCellPipes } from '../../src/renderer/editor/math-syntax.ts'

const [root, note, typstJson, directDir, refFile, flag] = process.argv.slice(2)
if (!root || !note || !typstJson || !directDir || !refFile || (flag && flag !== '--update')) {
  console.error(
    'usage: math-core.mts <pipeline root> <note> <typst.json> <direct svg dir> <reference file> [--update]',
  )
  process.exit(2)
}
const update = flag === '--update'
const show = (item: MathItem | undefined): string =>
  item ? `${item.display ? 'display' : 'inline'} ${JSON.stringify(item.tex)}` : '(none)'
let failures = 0

// --- 1. Delimiters ---------------------------------------------------------------------------

// What the preview never treats as formulas (src/renderer/editor/math.ts SKIP, minus Table:
// the table widget sets its cells' formulas, so they count here).
const SKIP = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'Frontmatter', 'HTMLBlock'])
const doc = readFileSync(note, 'utf8')
const state = EditorState.create({ doc, extensions: [mdoMarkdown()] })
const tree = ensureSyntaxTree(state, state.doc.length, 10_000)
if (!tree) throw new Error('the editor parser did not finish')
const editor: MathItem[] = []
tree.iterate({
  enter: (n) => {
    if (SKIP.has(n.name)) return false
    if (n.name !== 'InlineMath' && n.name !== 'BlockMath') return undefined
    const [open, close] = n.node.getChildren('MathMark')
    if (!open || !close) throw new Error(`${n.name} at ${n.from} without marks`)
    let inTable = false
    for (let p = n.node.parent; p; p = p.parent) if (p.name === 'Table') inTable = true
    // As the preview asks (math.ts / tables.ts cellFormulas).
    const tex = inTable
      ? unescapeCellPipes(state.doc.sliceString(open.to, close.from))
      : mathTex(state, n.node)
    editor.push({ tex, display: n.name === 'BlockMath' || open.to - open.from === 2 })
    return false
  },
})
const pdf = JSON.parse(readFileSync(typstJson, 'utf8')) as MathItem[]
// Indentation at line breaks may differ: pulldown-cmark strips a list item's indent from a
// formula's continuation lines, the editor's source keeps it. Insignificant to TeX, and part 2
// proves it: the app sets the editor's TeX and must draw what the PDF draws from cmarker's.
const lines = (tex: string | undefined) => tex?.replace(/[ \t]*\n[ \t]*/g, '\n')
for (let i = 0; i < Math.max(pdf.length, editor.length); i++) {
  const a = pdf[i]
  const b = editor[i]
  if (lines(a?.tex) === lines(b?.tex) && a?.display === b?.display) continue
  failures++
  console.error(`formula ${i + 1}: PDF (cmarker) ${show(a)}, editor ${show(b)}`)
}
console.log(`math delimiters: PDF ${pdf.length}, editor ${editor.length} formulas`)

// --- 2. Toolchain ----------------------------------------------------------------------------

/** Glyph ids are content hashes; numbered by first use, the SVGs compare as a whole. */
function normalise(svg: string): string {
  const ids = new Map<string, string>()
  for (const m of svg.matchAll(/(?:\bid="|href="#)([^"]+)"/g)) {
    const id = m[1] ?? ''
    if (!ids.has(id)) ids.set(id, `g${ids.size}`)
  }
  return svg.replace(/(\bid="|href="#)([^"]+)"/g, (_, pre: string, id: string) => {
    return `${pre}${ids.get(id)}"`
  })
}

const direct = readdirSync(directDir)
  .map((f) => /^direct-(\d+)\.svg$/.exec(f))
  .filter((m): m is RegExpExecArray => m !== null)
  .sort((a, b) => Number(a[1]) - Number(b[1]))
  .map((m) => readFileSync(join(directDir, m[0]), 'utf8'))
if (direct.length !== pdf.length) {
  failures++
  console.error(`math.typ wrote ${direct.length} pages for ${pdf.length} formulas`)
}
// The editor's formulas through the app's path, the PDF's through the PDF's toolchain.
const results = await new MathRenderer(root).render(editor)
const hashes: string[] = []
results.forEach((res, i) => {
  const item = pdf[i]
  if (!res.ok) {
    failures++
    console.error(`formula ${i + 1} (${show(item)}): the app could not set it: ${res.error}`)
    return
  }
  const got = normalise(res.svg)
  const expected = normalise(direct[i] ?? '')
  if (got !== expected) {
    failures++
    let at = 0
    while (at < got.length && got[at] === expected[at]) at++
    console.error(`formula ${i + 1} (${show(item)}): app SVG differs from the PDF's at ${at}`)
    console.error(`  pdf: ${JSON.stringify(expected.slice(Math.max(0, at - 60), at + 80))}`)
    console.error(`  app: ${JSON.stringify(got.slice(Math.max(0, at - 60), at + 80))}`)
  }
  const hash = createHash('sha256').update(got).digest('hex')
  hashes.push(`${hash}  ${item?.display ? 'D' : 'I'} ${JSON.stringify(item?.tex)}`)
})
const refs = `${hashes.join('\n')}\n`
if (update) {
  writeFileSync(refFile, refs)
} else if (!existsSync(refFile)) {
  failures++
  console.error(`${refFile} is missing (bash pipeline/tests/test-math.sh --update)`)
} else {
  const want = readFileSync(refFile, 'utf8').split('\n')
  const got = refs.split('\n')
  let stale = 0
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (got[i] === want[i]) continue
    stale++
    console.error(
      `reference line ${i + 1}: expected ${want[i] ?? '(none)'}, got ${got[i] ?? '(none)'}`,
    )
  }
  failures += stale
  if (stale > 0)
    console.error(
      'A changed reference means mitex, Typst or the fonts set formulas differently; after a ' +
        'deliberate update re-check RAW_TYPST in src/main/math.ts, then --update.',
    )
}
if (failures > 0) {
  console.error(`${failures} difference(s) between the PDF's formulas and the preview's`)
  process.exit(1)
}
console.log(
  `math parity: ${pdf.length} formulas found alike and set identically${update ? `, references written to ${refFile}` : ''}`,
)
