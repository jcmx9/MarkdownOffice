import { readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test, typeInEditor, waitForFile } from './helpers'

const tabs = (page: import('@playwright/test').Page) => page.locator('[data-testid=tab]')

test('starts with a new note that is created on the first keystroke', async () => {
  const { app, page, notes } = await launch()
  await expect(tabs(page)).toHaveCount(1)
  const name = (await tabs(page).first().locator('.tab-label').textContent()) ?? ''
  expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/)
  expect(await readdir(notes)).toEqual([])

  await page.locator('.cm-content').click()
  await page.keyboard.type('# Hallo')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Text')
  const bytes = await waitForFile(
    join(notes, name),
    (b) => b.toString('utf8') === '# Hallo\n\nText',
  )
  expect(bytes.toString('utf8')).toBe('# Hallo\n\nText')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await shot(page, 'edit-code')
  await app.close()
})

test('opens a file from the command line and keeps BOM and CRLF byte-exact', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'Protokoll.md')
  await writeFile(file, Buffer.from('\uFEFF# Titel\r\n\r\nZeile\r\n', 'utf8'))
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(tabs(page).first()).toContainText('Protokoll.md')
  await typeInEditor(page, 'Neu')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Zwei')
  const expected = Buffer.from('\uFEFF# Titel\r\n\r\nZeile\r\nNeu\r\nZwei', 'utf8')
  await waitForFile(file, (b) => b.equals(expected))
  await app.close()
})

test('opens one tab for a note given via a symlinked folder and its real path', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'eins.md')
  await writeFile(file, 'eins')
  const link = join(dirs.root, 'verknuepft')
  // A junction needs no admin rights on Windows; the type is ignored elsewhere.
  await symlink(dirs.notes, link, 'junction')
  const { app, page } = await launch({ dirs, args: [join(link, 'eins.md'), file] })
  await expect(tabs(page).first()).toContainText('eins.md')
  await expect(tabs(page)).toHaveCount(1)
  await typeInEditor(page, ' zwei')
  await waitForFile(file, (b) => b.toString('utf8') === 'eins zwei')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('a note opened via a symlinked file is identified by its target', async () => {
  const dirs = await makeDirs()
  const target = join(dirs.notes, 'ziel.md')
  await writeFile(target, 'ziel')
  const link = join(dirs.notes, 'verweis.md')
  try {
    await symlink(target, link, 'file')
  } catch {
    // File symlinks need admin rights or developer mode on Windows.
    test.skip(true, 'file symlinks not permitted here')
  }
  const { app, page } = await launch({ dirs, args: [link, target] })
  await expect(tabs(page).first()).toContainText('ziel.md')
  await expect(tabs(page)).toHaveCount(1)
  await app.close()
})

test('opens a second tab and switches with the window menu', async () => {
  const { app, page } = await launch()
  await clickMenu(app, 'new')
  await expect(tabs(page)).toHaveCount(2)
  await expect(tabs(page).nth(1)).toHaveClass(/active/)
  await clickMenu(app, 'prev-tab')
  await expect(tabs(page).nth(0)).toHaveClass(/active/)
  await app.close()
})

test('rename refuses an existing name and then renames', async () => {
  const dirs = await makeDirs()
  const a = join(dirs.notes, 'a.md')
  await writeFile(a, 'A')
  await writeFile(join(dirs.notes, 'b.md'), 'B')
  const { app, page } = await launch({ dirs, args: [a] })

  await clickMenu(app, 'rename')
  await page.locator('dialog.prompt input').fill('b')
  await page.keyboard.press('Enter')
  await expect(page.locator('.panel')).toContainText('existiert bereits')
  expect(await readFile(join(dirs.notes, 'b.md'), 'utf8')).toBe('B')

  await clickMenu(app, 'rename')
  await page.locator('dialog.prompt input').fill('Kickoff')
  await page.keyboard.press('Enter')
  await expect(tabs(page).first()).toContainText('Kickoff.md')
  expect((await readdir(dirs.notes)).sort()).toEqual(['Kickoff.md', 'b.md'])
  await app.close()
})

test('restores open tabs after a restart', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'bleibt.md')
  await writeFile(file, 'x')
  const first = await launch({ dirs, args: [file] })
  await first.app.close()
  const second = await launch({ dirs })
  await expect(tabs(second.page)).toHaveCount(1)
  await expect(tabs(second.page).first()).toContainText('bleibt.md')
  await second.app.close()
})

test('reloads a clean tab when the file changes on disk', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'extern.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('alt')
  await writeFile(file, 'neu von außen')
  await expect(page.locator('.cm-content')).toContainText('neu von außen')
  await app.close()
})

test('prints the version without opening a window', async () => {
  const { execFileSync } = await import('node:child_process')
  const electronPath = (await import('electron')).default as unknown as string
  const out = execFileSync(electronPath, ['.', '--version'], { encoding: 'utf8' })
  expect(out.trim()).toMatch(/^Markdown Office \d+\.\d+\.\d+/)
})

test('a dirty tab with an external change is not overwritten until the user decides', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'konflikt.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await typeInEditor(page, ' eigene Aenderung')
  await writeFile(file, 'extern')
  await expect(page.locator('.banner')).toBeVisible()
  await page.waitForTimeout(3000)
  expect(await readFile(file, 'utf8')).toBe('extern')
  await page.locator('.banner').getByRole('button', { name: 'Meine behalten' }).click()
  await waitForFile(file, (b) => b.toString('utf8') === 'alt eigene Aenderung')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('reloading after a conflict shows the external content', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'konflikt2.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await typeInEditor(page, ' eigene Aenderung')
  await writeFile(file, 'extern')
  await expect(page.locator('.banner')).toBeVisible()
  await page
    .locator('.banner')
    .getByRole('button', { name: /Neu laden/ })
    .click()
  await expect(page.locator('.cm-content')).toContainText('extern')
  await expect(page.locator('.cm-content')).not.toContainText('eigene')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  expect(await readFile(file, 'utf8')).toBe('extern')
  await app.close()
})

test('a new note typed right before closing is saved and restored', async () => {
  const dirs = await makeDirs()
  const first = await launch({ dirs })
  await first.page.locator('.cm-content').click()
  await first.page.keyboard.type('Gerade noch getippt')
  await first.app.close()
  const second = await launch({ dirs })
  await expect(tabs(second.page)).toHaveCount(1)
  await expect(second.page.locator('.cm-content')).toContainText('Gerade noch getippt')
  await second.app.close()
})
