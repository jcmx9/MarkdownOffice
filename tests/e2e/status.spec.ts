import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { launch, makeDirs, test } from './helpers'

const FIXTURE = join(__dirname, '..', 'fixtures', 'preview.md')

async function open(file: 'fixture' | string) {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Status.md')
  if (file === 'fixture') await copyFile(FIXTURE, note)
  else await writeFile(note, file)
  const launched = await launch({ dirs, args: [note] })
  await launched.page.locator('.cm-editor.mdo-preview').waitFor()
  return { ...launched, note, original: await readFile(note) }
}

test('Gliederung toggle shows and hides the outline', async () => {
  const { app, page } = await open('fixture')
  const btn = page.getByTestId('status-outline')
  const was = (await btn.getAttribute('aria-pressed')) === 'true'
  await expect(page.locator('#outline')).toBeVisible({ visible: was })
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', String(!was))
  await expect(page.locator('#outline')).toBeVisible({ visible: !was })
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', String(was))
  await expect(page.locator('#outline')).toBeVisible({ visible: was })
  await app.close()
})

test('YAML toggle collapses and expands the header, disk untouched', async () => {
  const { app, page, note, original } = await open('fixture')
  const btn = page.getByTestId('status-yaml')
  await expect(btn).toBeEnabled()
  const header = page.locator('.cm-line.mdo-frontmatter')
  const was = (await btn.getAttribute('aria-pressed')) === 'true'
  await expect(header.first()).toBeVisible({ visible: was })
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', String(!was))
  await expect(header.first()).toBeVisible({ visible: !was })
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', String(was))
  await expect(header.first()).toBeVisible({ visible: was })
  await page.waitForTimeout(1500)
  expect((await readFile(note)).equals(original)).toBe(true)
  await app.close()
})

test('YAML toggle is disabled without front matter and in Code', async () => {
  const none = await open('# Nur Text\n\nOhne Header.\n')
  await expect(none.page.getByTestId('status-yaml')).toBeDisabled()
  await none.app.close()
  const { app, page } = await open('fixture')
  await expect(page.getByTestId('status-yaml')).toBeEnabled()
  await page.getByTestId('status-code').click()
  await expect(page.getByTestId('status-yaml')).toBeDisabled()
  await app.close()
})
