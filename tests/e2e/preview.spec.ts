import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test, waitForFile } from './helpers'

const FIXTURE = join(__dirname, '..', 'fixtures', 'preview.md')

async function openFixture(extra: { env?: Record<string, string> } = {}) {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(FIXTURE, note)
  const launched = await launch({ dirs, args: [note], ...extra })
  await launched.page.locator('.cm-editor.mdo-preview').waitFor()
  return { ...launched, note, original: await readFile(note) }
}

test('renders the PDF look', async () => {
  const { app, page } = await openFixture()
  await expect(page.locator('.cm-line.mdo-h1')).toHaveCount(1)
  await expect(page.locator('.cm-line.mdo-h2')).toHaveCount(1)
  await expect(page.locator('.mdo-task')).toHaveCount(2)
  await expect(page.locator('.mdo-alert-title')).toHaveText('Hinweis')
  await expect(page.locator('table.mdo-table thead th')).toHaveText(['Produkt', 'Menge', 'Preis'])
  await expect(page.locator('table.mdo-table tbody tr').nth(1)).toHaveClass(/mdo-table-stripe/)
  await expect(page.locator('table.mdo-table tbody tr').first().locator('td').nth(2)).toHaveClass(
    /mdo-al-right/,
  )
  await expect(page.locator('.cm-line.mdo-codeblock').first()).toBeVisible()
  // The memo set uses par(justify: true); the editor justifies without hyphenation on every OS.
  const body = page.locator('.cm-line', { hasText: 'Ein Absatz mit' })
  await expect(body).toHaveCSS('text-align', 'justify')
  await expect(body).toHaveCSS('hyphens', 'manual')
  await expect(page.locator('.cm-line.mdo-h1')).toHaveCSS('text-align', 'left')
  await shot(page, 'preview')
  await app.close()
})

test('a checkbox click changes exactly one byte on disk', async () => {
  const { app, page, note, original } = await openFixture()
  await page.locator('.mdo-task').first().click()
  const after = await waitForFile(note, (b) => !b.equals(original))
  expect(after.length).toBe(original.length)
  const diffs = [...after].map((byte, i) => (byte === original[i] ? -1 : i)).filter((i) => i >= 0)
  expect(diffs).toHaveLength(1)
  expect(String.fromCharCode(after[diffs[0] as number] as number)).toBe('x')
  await app.close()
})

test('a table click switches to Markdown editing and back, bytes untouched', async () => {
  const { app, page, note, original } = await openFixture()
  await page.locator('table.mdo-table').click()
  await expect(page.locator('table.mdo-table')).toHaveCount(0)
  await expect(page.locator('.cm-line.mdo-table-head')).toBeVisible()
  await shot(page, 'table-editing')
  await page.locator('.cm-line.mdo-h1').click()
  await expect(page.locator('table.mdo-table')).toHaveCount(1)
  await page.waitForTimeout(1500)
  expect((await readFile(note)).equals(original)).toBe(true)
  await app.close()
})

test('the YAML header collapses, stays collapsed after restart, disk untouched', async () => {
  const first = await openFixture()
  await clickMenu(first.app, 'toggle-header')
  await expect(first.page.locator('.mdo-titleblock .mdo-tb-title')).toHaveText(
    'Kickoff Kaffeerösterei',
  )
  await expect(first.page.locator('.mdo-titleblock .mdo-tb-client')).toHaveText('Muster GmbH')
  await expect(first.page.locator('.mdo-titleblock .mdo-tb-subtitle')).toHaveText('Protokoll')
  await expect(first.page.locator('.mdo-titleblock .mdo-tb-meta')).toHaveText(
    '14. Oktober 2026 · Anna',
  )
  await expect(first.page.locator('.cm-line.mdo-frontmatter')).toHaveCount(0)
  await first.page.waitForTimeout(1500)
  expect((await readFile(first.note)).equals(first.original)).toBe(true)
  await shot(first.page, 'preview-header-hidden')
  await first.app.close()
  const second = await launch({ dirs: first })
  await expect(second.page.locator('.mdo-titleblock')).toBeVisible()
  await second.app.close()
})

test('code/preview switch keeps the bytes and survives a restart', async () => {
  const first = await openFixture()
  await clickMenu(first.app, 'toggle-view')
  await expect(first.page.locator('.cm-editor.mdo-code')).toBeVisible()
  await expect(first.page.locator('.cm-lineNumbers')).toBeVisible()
  await shot(first.page, 'code')
  await first.page.waitForTimeout(1500)
  expect((await readFile(first.note)).equals(first.original)).toBe(true)
  await first.app.close()
  const second = await launch({ dirs: first })
  await expect(second.page.locator('.cm-editor.mdo-code')).toBeVisible()
  await clickMenu(second.app, 'toggle-view')
  await expect(second.page.locator('.cm-editor.mdo-preview')).toBeVisible()
  await second.app.close()
})

test('fold all hides section bodies, unfold all brings them back', async () => {
  const { app, page } = await openFixture()
  const body = page.locator('.cm-line', { hasText: 'Text unter drei Rauten' })
  await expect(body).toHaveCount(1)
  await clickMenu(app, 'fold-all')
  await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible()
  await expect(body).toHaveCount(0)
  await clickMenu(app, 'unfold-all')
  await expect(body).toHaveCount(1)
  await app.close()
})

test('loads the bundled fonts', async () => {
  const { app, page } = await openFixture()
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts]
      .filter((f) => f.status === 'loaded')
      .map((f) => f.family.replace(/"/g, ''))
  })
  expect(loaded).toEqual(expect.arrayContaining(['mdo Sans', 'mdo Serif']))
  await app.close()
})

test('clicks and arrow keys hit the right line below the title block and a table', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Zeilen.md')
  await writeFile(
    note,
    '---\ntitle: Titel\nsubtitle: Untertitel\n---\n# Agenda\n1. Erstens\n2. Zweitens\n3. Drittens\n\n|a|b|\n|---|---|\n|1|2|\n\nVorletzte\nEnde\n',
  )
  // Zoom 2 as in the reported case: CodeMirror's height map must not drift from the layout.
  await writeFile(
    join(dirs.userData, 'session.json'),
    JSON.stringify({
      tabs: [{ path: note, headerHidden: true }],
      activeIndex: 0,
      view: 'preview',
      zoom: { edit: 2, present: 1.25 },
    }),
  )
  const { app, page } = await launch({ dirs })
  await expect(page.locator('.mdo-titleblock')).toBeVisible()
  await page.getByText('Erstens').click()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.type('X')
  await page.getByText('Vorletzte').click()
  await page.keyboard.press('End')
  await page.keyboard.type('Y')
  const text = (await waitForFile(note, (b) => /Y/.test(b.toString()))).toString()
  const lines = text.split('\n')
  expect(lines.find((l) => l.includes('X'))).toMatch(/^2\. Zweite/)
  expect(lines.find((l) => l.includes('Y'))).toBe('VorletzteY')
  await app.close()
})

test('YAML header, code blocks and Mermaid are highlighted in both views', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Farben.md')
  await writeFile(
    note,
    [
      '---',
      'title: "Farben" # Kommentar',
      'toc: auto',
      '---',
      '',
      '```js',
      'const answer = 42 // Kommentar',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[Start] --> B[Ende]',
      '```',
      '',
    ].join('\n'),
  )
  const { app, page } = await launch({ dirs, args: [note] })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  // The header may start collapsed: show it.
  if ((await page.locator('.cm-line', { hasText: 'toc: auto' }).count()) === 0) {
    await clickMenu(app, 'toggle-header')
  }
  // JavaScript is loaded on demand from a separate chunk (CSP script-src 'self').
  await expect(page.locator('.mdo-tok-keyword', { hasText: 'const' })).toBeVisible()
  await expect(page.locator('.mdo-tok-number', { hasText: '42' })).toBeVisible()
  await expect(page.locator('.mdo-tok-keyword', { hasText: 'flowchart' })).toBeVisible()
  await expect(page.locator('.mdo-tok-function', { hasText: '-->' })).toBeVisible()
  await expect(page.locator('.mdo-tok-function', { hasText: 'title' })).toBeVisible()
  await expect(page.locator('.mdo-tok-string', { hasText: '"Farben"' })).toBeVisible()
  await expect(page.locator('.mdo-tok-comment', { hasText: '# Kommentar' })).toBeVisible()
  await shot(page, 'highlight-preview')
  await clickMenu(app, 'toggle-view')
  await page.locator('.cm-editor.mdo-code').waitFor()
  await expect(page.locator('.mdo-tok-keyword', { hasText: 'const' })).toBeVisible()
  await expect(page.locator('.mdo-tok-function', { hasText: 'title' })).toBeVisible()
  await shot(page, 'highlight-code')
  await app.close()
})

test('external links get the link colour and a ↗ that is not document text', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Links.md')
  const source =
    'Siehe [Doku](https://example.com/doku) und [Kapitel](#kapitel).\n\n' +
    '| Verweis | Art |\n|---|---|\n| [Tabelle](https://example.com/t) | extern |\n\nEnde\n'
  await writeFile(note, source)
  const { app, page } = await launch({ dirs, args: [note] })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  const line = page.locator('.cm-line', { hasText: 'Siehe' })
  const ext = line.locator('.mdo-link-ext')
  await expect(ext).toHaveText('Doku')
  await expect(ext).toHaveCSS('color', 'rgb(31, 111, 106)')
  // Internal link: plain link look, no arrow.
  await expect(line.locator('.mdo-link:not(.mdo-link-ext)')).toHaveText('Kapitel')
  const arrows = line.locator('.mdo-link-arrow')
  await expect(arrows).toHaveCount(1)
  const arrow = await arrows.first().evaluate((el) => ({
    glyph: getComputedStyle(el, '::before').content,
    text: el.textContent,
    inLink: el.closest('.mdo-link') !== null,
  }))
  // The glyph comes from CSS: the widget has no text and sits after, not inside, the link
  // (so the underline stops before it).
  expect(arrow).toEqual({ glyph: '"↗"', text: '', inLink: false })
  // Table widget (cursor elsewhere): the same marker.
  await expect(page.locator('table.mdo-table .mdo-link-ext')).toHaveText('Tabelle')
  await expect(page.locator('table.mdo-table .mdo-link-arrow')).toHaveCount(1)
  expect(await page.locator('.cm-content').textContent()).not.toContain('↗')
  await shot(page, 'links-preview')
  // Code view: raw source, no marker.
  await clickMenu(app, 'toggle-view')
  await page.locator('.cm-editor.mdo-code').waitFor()
  await expect(page.locator('.mdo-link-arrow')).toHaveCount(0)
  await page.waitForTimeout(1500)
  expect((await readFile(note)).toString()).toBe(source)
  await app.close()
})
