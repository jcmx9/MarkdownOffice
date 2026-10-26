import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page } from '@playwright/test'
import { clickMenu, type Dirs, launch, MOD, makeDirs, shot, test, waitForFile } from './helpers'

/**
 * The formatting toolbar end to end (spec „Formatting toolbar“, section 3 „E2E“): clicks and
 * menu commands change the file on disk, the bar follows mode, note and session, and format
 * commands never edit behind a dialog. Runs in CI only (never locally, see CLAUDE.md).
 */

async function openNote(content: string, dirs?: Dirs) {
  const d = dirs ?? (await makeDirs())
  const note = join(d.notes, 'Leiste.md')
  if (!dirs) await writeFile(note, content)
  const launched = await launch({ dirs: d, args: [note] })
  await launched.page.locator('.cm-editor.mdo-preview').waitFor()
  return { ...launched, note, dirs: d }
}

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

const bar = (page: Page) => page.locator('#toolbar')
const fmt = (page: Page, id: string) => page.getByTestId(`fmt-${id}`)
const text = (expected: string) => (b: Buffer) => b.toString('utf8') === expected
const contains = (part: string) => (b: Buffer) => b.toString('utf8').includes(part)

/** Puts the cursor at the end of the note, then `left` characters back. */
async function cursorAtEnd(page: Page, left = 0): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press(`${MOD}+End`)
  for (let i = 0; i < left; i++) await page.keyboard.press('ArrowLeft')
}

test('„B“ makes the word at the cursor bold on disk; the menu command toggles it back', async () => {
  const { app, page, note } = await openNote('Wort')
  await expect(bar(page)).toBeVisible()
  await cursorAtEnd(page, 1)
  await fmt(page, 'bold').click()
  await waitForFile(note, text('**Wort**'))
  await expect(fmt(page, 'bold')).toHaveAttribute('aria-pressed', 'true')
  await shot(page, 'toolbar')
  await clickMenu(app, 'format-bold')
  await waitForFile(note, text('Wort'))
  await app.close()
})

test('a toolbar click keeps the editor selection', async () => {
  const { app, page, note } = await openNote('eins zwei drei')
  await cursorAtEnd(page)
  // Two words selected: the word at the cursor alone would give `eins zwei **drei**`.
  const wordLeft = `Shift+${MOD === 'Meta' ? 'Alt' : 'Control'}+ArrowLeft`
  await page.keyboard.press(wordLeft)
  await page.keyboard.press(wordLeft)
  await fmt(page, 'bold').click()
  await waitForFile(note, text('eins **zwei drei**'))
  await app.close()
})

test('Box ▾ → Hinweis inserts a WARNING alert', async () => {
  const { app, page, note } = await openNote('Achtung, Stufe')
  await cursorAtEnd(page)
  await page.keyboard.press(`Shift+${MOD}+Home`)
  await fmt(page, 'box').click()
  await expect(page.getByTestId('fmt-box-menu')).toBeVisible()
  await fmt(page, 'alert-warning').click()
  await expect(page.getByTestId('fmt-box-menu')).toHaveCount(0)
  await waitForFile(note, contains('> [!WARNING]'))
  expect(await readFile(note, 'utf8')).toContain('> Achtung, Stufe')
  await app.close()
})

test('Tabelle ▾ inserts a 3 × 2 table, „Spalte rechts“ adds a column, the preview shows it', async () => {
  const { app, page, note } = await openNote('Text')
  await cursorAtEnd(page)
  await fmt(page, 'table').click()
  const grid = page.getByTestId('fmt-grid')
  await expect(grid).toBeVisible()
  await grid.locator('[data-col="3"][data-row="2"]').hover()
  await expect(page.getByTestId('fmt-grid-label')).toHaveText('3 × 2')
  await grid.locator('[data-col="3"][data-row="2"]').click()
  await waitForFile(note, contains('|   |   |   |\n| --- | --- | --- |\n|   |   |   |'))

  // The cursor sits in the first header cell: the same button now offers the table commands.
  await fmt(page, 'table').click()
  await expect(page.getByTestId('fmt-table-menu')).toBeVisible()
  await fmt(page, 'table-col-right').click()
  await waitForFile(note, contains('| --- | --- | --- | --- |'))

  // The cursor leaves the table: the preview renders it.
  await page.keyboard.press(`${MOD}+Home`)
  await expect(page.locator('table.mdo-table thead th')).toHaveCount(4)
  await shot(page, 'toolbar-table')
  await app.close()
})

test('hidden in Present and without a note', async () => {
  const { app, page } = await openNote('Wort')
  await expect(bar(page)).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect(bar(page)).toBeHidden()
  // Leave Present, fullscreen included, before closing the tab or the app (a close in a real
  // fullscreen Space has preceded launch hangs on macOS CI).
  await leavePresent(app, page)
  await expect(bar(page)).toBeVisible()
  await clickMenu(app, 'close-tab')
  await expect(page.locator('[data-testid=tab]')).toHaveCount(0)
  await expect(bar(page)).toBeHidden()
  await expect(page.getByTestId('status-toolbar')).toBeDisabled()
  await app.close()
})

test('the „Leiste“ switch survives a restart', async () => {
  const { app, page, userData, dirs } = await openNote('Wort')
  await expect(page.getByTestId('status-toolbar')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('status-toolbar').click()
  await expect(bar(page)).toBeHidden()
  await waitForFile(join(userData, 'session.json'), (b) => {
    try {
      return JSON.parse(b.toString('utf8'))?.toolbar?.edit === false
    } catch {
      return false
    }
  })
  await app.close()

  const second = await openNote('', dirs)
  await expect(second.page.getByTestId('status-toolbar')).toHaveAttribute('aria-pressed', 'false')
  await expect(bar(second.page)).toBeHidden()
  await clickMenu(second.app, 'toggle-toolbar')
  await expect(bar(second.page)).toBeVisible()
  await second.app.close()
})

test('with the rename dialog open, format commands do nothing', async () => {
  const { app, page, note } = await openNote('Wort')
  await cursorAtEnd(page, 1)
  await clickMenu(app, 'rename')
  await expect(page.locator('dialog.prompt')).toBeVisible()
  for (const cmd of ['format-bold', 'format-h1', 'insert-alert-warning', 'table-row-below']) {
    await clickMenu(app, cmd)
  }
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog.prompt')).toHaveCount(0)
  // Exact text: `**Wort**`, `# Wort`, an alert or a table row would all still contain „Wort“.
  await expect(page.locator('.cm-content')).toHaveText('Wort')
  // A read right away could come before an autosave of a wrongly applied command. Typing one
  // character forces a save after the commands; the file must hold exactly that character more.
  await cursorAtEnd(page)
  await page.keyboard.type('X')
  await waitForFile(note, text('WortX'))
  await expect(page.locator('.cm-content')).toHaveText('WortX')
  await app.close()
})

test('`==x==` shows as a highlight in the preview', async () => {
  const { app, page } = await openNote('Text\n\nVor ==x== nach')
  await page.locator('.cm-content').click()
  await page.keyboard.press(`${MOD}+Home`)
  await expect(page.locator('.mdo-hl').first()).toHaveText('x')
  await shot(page, 'toolbar-highlight')
  await app.close()
})
