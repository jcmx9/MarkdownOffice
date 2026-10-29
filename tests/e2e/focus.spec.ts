import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { clickMenu, launch, makeDirs, test } from './helpers'

const NOTE = [
  '# Eins',
  '',
  'Text unter eins.',
  '',
  '## Eins A',
  '',
  'Geheimes im Unterkapitel.',
  '',
  '# Zwei',
  '',
  'Text unter zwei.',
  '',
].join('\n')

test('Fokus: chapter headings, the path and one section; PageDown/PageUp step; file untouched', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Fokus.md')
  await writeFile(note, NOTE)
  const { app, page } = await launch({ dirs, args: [note] })
  const line = (text: string) => page.locator('.cm-line', { hasText: text })
  await line('Text unter zwei.').click()
  await page.getByTestId('status-focus').click()
  await expect(page.getByTestId('status-focus')).toHaveAttribute('aria-pressed', 'true')
  await expect(line('Text unter zwei.')).toBeVisible()
  await expect(line('Geheimes im Unterkapitel.')).toHaveCount(0)
  await expect(line('Text unter eins.')).toHaveCount(0)
  // Another chapter's sub-heading is hidden; its H1 stays.
  await expect(line('Eins A')).toHaveCount(0)
  await expect(line('Eins').first()).toBeVisible()
  // A click on the H1 shows only its own text, not its sub-chapter.
  await line('Eins').first().click()
  await expect(line('Text unter eins.')).toBeVisible()
  await expect(line('Eins A')).toHaveCount(0)
  await expect(line('Geheimes im Unterkapitel.')).toHaveCount(0)
  await expect(line('Text unter zwei.')).toHaveCount(0)
  // PageDown is the next slide: the sub-chapter under its path, the chapter's own text gone.
  await page.keyboard.press('PageDown')
  await expect(line('Geheimes im Unterkapitel.')).toBeVisible()
  await expect(line('Eins A')).toBeVisible()
  await expect(line('Text unter eins.')).toHaveCount(0)
  await page.keyboard.press('PageDown')
  await expect(line('Text unter zwei.')).toBeVisible()
  await expect(line('Geheimes im Unterkapitel.')).toHaveCount(0)
  await page.keyboard.press('PageUp')
  await expect(line('Geheimes im Unterkapitel.')).toBeVisible()
  // Off again via the menu: everything is visible.
  await clickMenu(app, 'toggle-focus')
  await expect(page.getByTestId('status-focus')).toHaveAttribute('aria-pressed', 'false')
  await expect(line('Geheimes im Unterkapitel.')).toBeVisible()
  expect(await readFile(note, 'utf8')).toBe(NOTE)
  await app.close()
})

test('Present always starts focused, even after it was turned off there', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Fokus.md')
  await writeFile(note, NOTE)
  const { app, page } = await launch({ dirs, args: [note] })
  const line = (text: string) => page.locator('.cm-line', { hasText: text })
  await line('Text unter zwei.').click()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect(page.locator('.cm-editor.mdo-focus')).toHaveCount(1)
  await expect(line('Geheimes im Unterkapitel.')).toHaveCount(0)
  await clickMenu(app, 'toggle-focus')
  await expect(page.locator('.cm-editor.mdo-focus')).toHaveCount(0)
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  // Edit keeps its own choice (off).
  await expect(page.locator('.cm-editor.mdo-focus')).toHaveCount(0)
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect(page.locator('.cm-editor.mdo-focus')).toHaveCount(1)
  await clickMenu(app, 'toggle-present')
  await app.close()
})

test('Present with the outline shown: chapter headings off the path are hidden too', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Fokus.md')
  await writeFile(note, NOTE)
  const { app, page } = await launch({ dirs, args: [note] })
  const line = (text: string) => page.locator('.cm-line', { hasText: text })
  await line('Text unter zwei.').click()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  // Without the outline every chapter heading stays as the agenda.
  await expect(line('Eins').first()).toBeVisible()
  await clickMenu(app, 'toggle-outline')
  await expect(page.locator('#outline')).toBeVisible()
  await expect(line('Eins')).toHaveCount(0)
  await expect(line('Zwei').first()).toBeVisible()
  await expect(line('Text unter zwei.')).toBeVisible()
  await clickMenu(app, 'toggle-outline')
  await expect(line('Eins').first()).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await app.close()
})
