import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test } from './helpers'

// Both tests run the real bundled pipeline from the dev layout (npm run assets builds it).

test('shows the pipeline’s message when the export fails', async () => {
  test.setTimeout(120_000)
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'notiz.md')
  await writeFile(note, '---\ntemplate: gibt-es-nicht\n---\n\n# Test\n')
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'export')
  const panel = page.locator('.panel')
  await expect(panel).toContainText('Export fehlgeschlagen', { timeout: 90_000 })
  await expect(panel).toContainText('Vorlage nicht gefunden: gibt-es-nicht')
  await shot(page, 'export-error')
  expect((await readdir(dirs.notes)).filter((f) => f.endsWith('.pdf'))).toEqual([])
  await app.close()
})

test('exports a real PDF through the bundled pipeline', async () => {
  test.setTimeout(180_000)
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Echter Export.md')
  await writeFile(note, '---\ntitle: "E2E"\n---\n\n# Test\n\n- [ ] Aufgabe – Name, bis 17.10.\n')
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'export')
  // Wait for either outcome so a failed export reports the pipeline's message at once.
  await expect(page.locator('.toast, .panel').first()).toBeVisible({ timeout: 150_000 })
  expect(await page.locator('.panel').allTextContents()).toEqual([])
  const pdfs = (await readdir(dirs.notes)).filter((f) => f.endsWith('.pdf'))
  expect(pdfs).toEqual(['Echter Export.pdf'])
  const pdf = await readFile(join(dirs.notes, pdfs[0] as string))
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  await app.close()
})
