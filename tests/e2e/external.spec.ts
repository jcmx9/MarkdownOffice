import { access, chmod, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { clickMenu, launch, MOD, makeDirs, test, typeInEditor, waitForFile } from './helpers'

const tabs = (page: import('@playwright/test').Page) => page.locator('[data-testid=tab]')

const HELD_UNREADABLE =
  'Nicht gespeichert: Externe Fassung nicht lesbar – bitte im Hinweis entscheiden'
const HELD_DELETED = 'Nicht gespeichert: Datei außerhalb gelöscht – bitte im Hinweis entscheiden'

/** The hold warning is as prominent as a failed save, clean or dirty. */
async function expectHeld(page: import('@playwright/test').Page, text: string): Promise<void> {
  const status = page.getByTestId('status-state')
  await expect(status).toHaveText(text)
  await expect(status).toHaveClass(/error/)
}

async function missing(path: string): Promise<boolean> {
  return access(path).then(
    () => false,
    () => true,
  )
}

test('an external non-UTF-8 write holds the tab until the user overwrites it', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'ansi.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('alt')
  const ansi = Buffer.from('Grüße aus Windows', 'latin1')
  await writeFile(file, ansi)
  const banner = page.locator('.banner')
  await expect(banner).toHaveText(
    /„ansi\.md“ wurde außerhalb geändert und ist kein gültiges UTF-8\. Markdown Office speichert nicht darüber\./,
  )
  await expectHeld(page, HELD_UNREADABLE)
  await typeInEditor(page, ' meins')
  await page.waitForTimeout(3000)
  await expectHeld(page, HELD_UNREADABLE)
  expect((await readFile(file)).equals(ansi)).toBe(true)
  await banner.getByRole('button', { name: 'Meine Fassung speichern (überschreiben)' }).click()
  await waitForFile(file, (b) => b.toString('utf8') === 'alt meins')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('overwriting unreadable bytes also works for a clean tab', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'ansi2.md')
  await writeFile(file, 'sauber')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('sauber')
  await writeFile(file, Buffer.from('ä', 'latin1'))
  await page
    .locator('.banner')
    .getByRole('button', { name: 'Meine Fassung speichern (überschreiben)' })
    .click()
  await waitForFile(file, (b) => b.toString('utf8') === 'sauber')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('a deleted note is only recreated after the user chose to save again', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'weg.md')
  await writeFile(file, 'da')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('da')
  await rm(file)
  const banner = page.locator('.banner')
  await expect(banner).toHaveText(/„weg\.md“ wurde außerhalb gelöscht\./)
  await expectHeld(page, HELD_DELETED)
  await typeInEditor(page, ' noch')
  await page.waitForTimeout(3000)
  await expectHeld(page, HELD_DELETED)
  expect(await missing(file)).toBe(true)
  await banner.getByRole('button', { name: 'Erneut speichern' }).click()
  await waitForFile(file, (b) => b.toString('utf8') === 'da noch')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('„Tab schließen“ closes a held tab without asking and without saving', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'zu.md')
  const other = join(dirs.notes, 'bleibt.md')
  await writeFile(file, 'zu')
  await writeFile(other, 'bleibt')
  const { app, page } = await launch({ dirs, args: [other, file] })
  await expect(tabs(page)).toHaveCount(2)
  await expect(page.locator('.cm-content')).toContainText('zu')
  await rm(file)
  await typeInEditor(page, ' getippt')
  await page.locator('.banner').getByRole('button', { name: 'Tab schließen' }).click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(page.locator('.banner')).toHaveCount(0)
  await page.waitForTimeout(1000)
  expect(await missing(file)).toBe(true)
  await app.close()
})

test('a deleted note that reappears outside replaces the hold with a reload', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'zurueck.md')
  await writeFile(file, 'eins')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('eins')
  await rm(file)
  await expect(page.locator('.banner')).toHaveText(/wurde außerhalb gelöscht/)
  await writeFile(file, 'zwei')
  await expect(page.locator('.cm-content')).toContainText('zwei')
  await expect(page.locator('.banner')).toHaveCount(0)
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('a file that cannot be read gets a calm banner; the raw error is only a tooltip', async () => {
  test.skip(process.platform === 'win32', 'chmod 000 does not block reading on Windows')
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'gesperrt.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('alt')
  try {
    await writeFile(file, 'neu')
    await chmod(file, 0o000)
    const text = page.locator('.banner p')
    await expect(text).toHaveText(
      '„gesperrt.md“ kann nicht mehr gelesen werden. Markdown Office speichert nicht darüber.',
    )
    await expect(text).toHaveAttribute('title', /EACCES/)
    await expectHeld(page, HELD_UNREADABLE)
    await page.waitForTimeout(1000)
    await expectHeld(page, HELD_UNREADABLE)
  } finally {
    await chmod(file, 0o644)
  }
  // Resolve the hold, so closing the app does not wait on the discard dialog.
  await page.locator('.banner').getByRole('button', { name: 'Tab schließen' }).click()
  await expect(tabs(page)).toHaveCount(0)
  await app.close()
})

test('a deleted note restored with our last saved bytes only lifts the hold', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'zurueck2.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('alt')
  await rm(file)
  await expect(page.locator('.banner')).toHaveText(/wurde außerhalb gelöscht/)
  await typeInEditor(page, ' weiter')
  await writeFile(file, 'alt')
  await expect(page.locator('.banner')).toHaveCount(0)
  await waitForFile(file, (b) => b.toString('utf8') === 'alt weiter')
  await expect(page.locator('.banner')).toHaveCount(0)
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('a held clean tab is marked unsaved in the tab bar and in the Present info line', async () => {
  const dirs = await makeDirs()
  const keep = join(dirs.notes, 'bleibt.md')
  const gone = join(dirs.notes, 'geloescht.md')
  await writeFile(keep, 'bleibt')
  await writeFile(gone, 'geloescht')
  const { app, page } = await launch({ dirs, args: [gone, keep] })
  await expect(tabs(page)).toHaveCount(2)
  await rm(gone)
  await expect(page.locator('.banner')).toHaveText(/wurde außerhalb gelöscht/)
  await expect(tabs(page).nth(0)).toHaveClass(/dirty/)
  await expect(tabs(page).nth(1)).not.toHaveClass(/dirty/)
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await tabs(page).nth(0).click()
  await expectHeld(page, HELD_DELETED)
  await clickMenu(app, 'toggle-present')
  await expect(page.getByTestId('il-tab').nth(0)).toHaveClass(/dirty/)
  await expect(page.getByTestId('il-tab').nth(1)).not.toHaveClass(/dirty/)
  // Resolve the hold, so closing the app does not wait on the discard dialog.
  await page.locator('.banner').getByRole('button', { name: 'Tab schließen' }).click()
  await expect(page.getByTestId('il-tab')).toHaveCount(1)
  await app.close()
})

test('a save right after an external write (inside the watcher debounce) does not overwrite it', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'knapp.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('alt')
  await typeInEditor(page, ' meins')
  // The external write lands, and the save runs at once: long before the watcher's 200 ms
  // debounce could report the change (blur flushes the autosave).
  await writeFile(file, 'von außen')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  const banner = page.locator('.banner')
  await expect(banner).toHaveText(/„knapp\.md“ wurde außerhalb von Markdown Office geändert\./)
  await expect(page.getByTestId('status-state')).toHaveText(
    /Externe Änderung – bitte im Hinweis entscheiden/,
  )
  await page.waitForTimeout(1500)
  expect(await readFile(file, 'utf8')).toBe('von außen')
  await expect(banner).toHaveCount(1)
  // „Meine behalten“ is the explicit overwrite.
  await banner.getByRole('button', { name: 'Meine behalten' }).click()
  await waitForFile(file, (b) => b.toString('utf8') === 'alt meins')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('after „Meine behalten“ an undo back to the old text is still written', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'zurueck3.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('alt')
  await typeInEditor(page, ' meins')
  await writeFile(file, 'von außen')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  const banner = page.locator('.banner')
  await expect(banner).toHaveText(/wurde außerhalb von Markdown Office geändert/)
  // Back to the text that was saved last: the tab is clean, the disk holds the outside version.
  await page.locator('.cm-content').click()
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.locator('.cm-content')).toHaveText('alt')
  await banner.getByRole('button', { name: 'Meine behalten' }).click()
  await waitForFile(file, (b) => b.toString('utf8') === 'alt')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('a save after an outside case-only rename plus edit shows the conflict', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'klein.md')
  const renamed = join(dirs.notes, 'Klein.md')
  await writeFile(file, 'alt')
  await writeFile(join(dirs.notes, 'probe-case'), '')
  test.skip(
    await access(join(dirs.notes, 'PROBE-CASE')).then(
      () => false,
      () => true,
    ),
    'needs a case-insensitive file system',
  )
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('alt')
  // Type first, then rename, write and save at once: the save must reach main inside the
  // watcher's 200 ms debounce (like the „knapp.md“ test above), because only the refused save
  // makes the tab follow the new spelling. Typing after the rename took longer than the
  // debounce on slow macOS runners: the watcher reported the change on the old spelling
  // („klein.md“ in the banner), or reloaded the still clean tab without any banner.
  await typeInEditor(page, ' meins')
  await rename(file, renamed)
  await writeFile(renamed, 'von außen')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  const banner = page.locator('.banner')
  await expect(banner).toHaveText(/„Klein\.md“ wurde außerhalb von Markdown Office geändert\./)
  await expect(page.locator('[data-testid=tab]')).toContainText('Klein.md')
  expect(await readFile(renamed, 'utf8')).toBe('von außen')
  await banner.getByRole('button', { name: 'Meine behalten' }).click()
  await waitForFile(renamed, (b) => b.toString('utf8') === 'alt meins')
  await app.close()
})
