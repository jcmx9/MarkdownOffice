import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page } from '@playwright/test'
import { Window } from 'happy-dom'
import { sanitizeDiagramSvg } from '../../src/renderer/editor/diagram-svg'
import { clickMenu, installSet, launch, makeDirs, shot, test } from './helpers'

const ROOT = join(__dirname, '..', '..')
/** The flowchart the parity test draws, and its committed reference (memo's arguments). */
const SOURCE = join(ROOT, 'pipeline', 'tests', 'fixtures', 'mermaid', 'flowchart.mmd')
const REFERENCE = join(ROOT, 'tests', 'fixtures', 'mermaid', 'flowchart.svg')
const linux = process.platform === 'linux'

/** Leaves Present the way present.spec does: toggled off, then out of the real fullscreen. */
async function leavePresent(app: ElectronApplication, page: Page): Promise<void> {
  if ((await page.locator('body.mdo-mode-present').count()) > 0) {
    await clickMenu(app, 'toggle-present')
  }
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  if (!linux) {
    const full = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false)
    await expect.poll(full, { timeout: 10_000 }).toBe(false)
  }
}

/**
 * A serialiser-independent form of an SVG tree: elements, sorted attributes and text, one per
 * line. The expected side is built by happy-dom in Node, the shown side by Chromium, so their
 * XMLSerializers may differ in details (namespace declarations, self-closing tags) the
 * comparison is not about. Normalised on purpose:
 * - id prefixes: every shown copy gets `mdo-dg<n>-` (n counts the window's drawings and
 *   copies), the reference is sanitised with `mdo-dg0-`; both become `ID-`;
 * - the root's width and height: the widget sets the fitted width and drops the height (the
 *   viewBox keeps the aspect), which depends on the window, not on the drawing.
 * Self-contained, so Playwright can run it in the page as well.
 */
function canonical(root: Element): string {
  const out: string[] = []
  const walk = (el: Element, depth: number): void => {
    const attrs = Array.from(el.attributes)
      .filter((a) => !(el === root && (a.name === 'width' || a.name === 'height')))
      .map((a) => `${a.name}="${a.value.replace(/mdo-dg\d+-/g, 'ID-')}"`)
      .sort()
    out.push(`${' '.repeat(depth)}<${el.localName} ${attrs.join(' ')}>`)
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) walk(child as Element, depth + 1)
      else if (child.nodeType === 3)
        out.push(`${' '.repeat(depth + 1)}${JSON.stringify(child.textContent)}`)
    }
  }
  walk(root, 0)
  return out.join('\n')
}

/** sanitizeDiagramSvg(reference) as the app would show it, in canonical form. */
async function expectedDrawing(): Promise<string> {
  const window = new Window()
  const g = globalThis as { DOMParser?: unknown }
  const saved = g.DOMParser
  // The sanitiser parses with the global DOMParser, which Node lacks.
  g.DOMParser = window.DOMParser
  try {
    const svg = sanitizeDiagramSvg(
      await readFile(REFERENCE, 'utf8'),
      'mdo-dg0',
      window.document as unknown as Document,
    )
    if (!svg) throw new Error('the reference SVG did not survive the sanitiser')
    return canonical(svg as unknown as Element)
  } finally {
    g.DOMParser = saved
    await window.happyDOM.close()
  }
}

/**
 * A note in fx-plain (a set with only a .typ: memo's built-in values, MEMO_MERMAID, the very
 * arguments the reference was drawn with) holding the fixture's flowchart. The block's text is
 * the fixture without its final newline, as Typst's it.text has it; tests/unit/renderer/
 * diagrams.test.ts checks that this draws the reference byte for byte.
 */
async function openFlowchart() {
  const dirs = await makeDirs()
  await installSet(dirs, 'fx-plain')
  const source = (await readFile(SOURCE, 'utf8')).replace(/\n$/, '')
  const note = join(dirs.notes, 'Ablauf.md')
  await writeFile(
    note,
    `---\ntemplate: fx-plain\ntitle: "Ablauf"\n---\n\nVor dem Diagramm.\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nNach dem Diagramm.\n`,
  )
  const launched = await launch({ dirs, args: [note] })
  await launched.page.locator('.cm-editor.mdo-preview').waitFor()
  await expect(launched.page.locator('#editor')).toHaveAttribute('data-mdo-set', 'fx-plain')
  return launched
}

const diagram = (page: Page) => page.locator('.mdo-diagram svg')
const sourceLine = (page: Page) => page.locator('.cm-line', { hasText: 'flowchart TD' })

test('a mermaid block shows the PDF’s diagram in Preview and Present, the source in Code view', async () => {
  const { app, page } = await openFlowchart()
  const expected = await expectedDrawing()

  // Preview: the diagram instead of the source, the sanitised reference drawing. The first
  // diagram waits for the plugin's wasm to load and compile.
  await expect(diagram(page)).toBeVisible({ timeout: 15_000 })
  await expect(sourceLine(page)).toHaveCount(0)
  expect(await diagram(page).evaluate(canonical)).toBe(expected)
  // Fitted by the measure: a width in px, no height (the viewBox keeps the aspect).
  await expect.poll(() => diagram(page).evaluate((el) => el.hasAttribute('height'))).toBe(false)
  const fit = await page.locator('.mdo-diagram').evaluate((wrap) => {
    const s = getComputedStyle(wrap)
    const text =
      wrap.clientWidth - Number.parseFloat(s.paddingLeft) - Number.parseFloat(s.paddingRight)
    return { text, svg: wrap.querySelector('svg')?.getBoundingClientRect().width ?? 0 }
  })
  expect(fit.svg).toBeGreaterThan(0)
  expect(fit.svg).toBeLessThanOrEqual(fit.text + 0.5)
  await shot(page, 'diagram-preview')

  // Present uses the same widget. Always left again: a failed assertion must not leave a
  // fullscreen Space behind (the next launch hangs on it).
  await clickMenu(app, 'toggle-present')
  let passed = false
  try {
    await expect(page.locator('.cm-editor.mdo-present .mdo-diagram svg')).toBeVisible()
    expect(await diagram(page).evaluate(canonical)).toBe(expected)
    passed = true
  } finally {
    // After a failure, leaving must not hide the assertion's own error.
    if (passed) await leavePresent(app, page)
    else await leavePresent(app, page).catch(() => {})
  }

  // Code view: only the source.
  await clickMenu(app, 'toggle-view')
  await expect(page.locator('.cm-editor.mdo-code')).toBeVisible()
  await expect(page.locator('.mdo-diagram')).toHaveCount(0)
  await expect(sourceLine(page)).toBeVisible()

  // Back in the Preview, a click into the diagram shows its source for editing.
  await clickMenu(app, 'toggle-view')
  await expect(diagram(page)).toBeVisible()
  await diagram(page).click()
  await expect(page.locator('.mdo-diagram')).toHaveCount(0)
  await expect(sourceLine(page)).toBeVisible()
  await app.close()
})
