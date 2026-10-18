import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test, waitForFile } from './helpers'

const tabs = (page: Page) => page.locator('[data-testid=tab]')
const picker = (page: Page) => page.getByTestId('tpl-dialog')

/** The active tab's note; it exists on disk only after the first keystroke. */
async function activePath(page: Page, notes: string): Promise<string> {
  const name = (await page.locator('[data-testid=tab].active .tab-label').textContent()) ?? ''
  expect(name).toMatch(/\.md$/)
  return join(notes, name)
}

test('Mod+N starts with the memo header; nothing is written until typed', async () => {
  const { app, page, notes } = await launch()
  await clickMenu(app, 'new')
  await expect(tabs(page)).toHaveCount(2)
  await expect(page.locator('.cm-content')).toContainText('template: memo')
  // The header is the clean initial text: no file, state not dirty.
  await page.waitForTimeout(500)
  expect(await readdir(notes)).toEqual([])

  // The cursor sits inside `title: ""`, so typing fills the title.
  await page.keyboard.type('Kickoff')
  const path = await activePath(page, notes)
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('title: "Kickoff"'))
  const text = saved.toString('utf8')
  expect(text.startsWith('---\n')).toBe(true)
  expect(text).toMatch(/^template: memo +#/m)
  await shot(page, 'new-memo')
  await app.close()
})

test('Neu aus Vorlage: din5008a with a user profile, memo not offered', async () => {
  const dirs = await makeDirs()
  await mkdir(join(dirs.templates, 'profiles'))
  await writeFile(join(dirs.templates, 'profiles', 'kanzlei.yaml'), 'name: Kanzlei\n')
  const { app, page, notes } = await launch({ dirs })
  await clickMenu(app, 'new-from-template')
  await expect(picker(page)).toBeVisible()
  await expect(page.getByTestId('tpl-row-din5008a')).toContainText('mitgeliefert')
  await expect(page.getByTestId('tpl-row-memo')).toHaveCount(0)

  await page.getByTestId('tpl-set-din5008a').check()
  const select = page.getByTestId('tpl-profile')
  await expect(select).toBeVisible()
  // User profiles and the set's own ones, sorted; the header's value is preselected.
  await expect(select.locator('option')).toHaveText(['beispiel', 'kanzlei'])
  await expect(select).toHaveValue('beispiel')
  await select.selectOption('kanzlei')
  await shot(page, 'new-from-template')
  await page.getByTestId('tpl-ok').click()
  await expect(picker(page)).toHaveCount(0)
  await expect(tabs(page)).toHaveCount(2)
  expect(await readdir(notes)).toEqual([])

  await page.keyboard.type('x')
  const path = await activePath(page, notes)
  const saved = await waitForFile(path)
  const text = saved.toString('utf8')
  expect(text).toMatch(/^template: din5008a +#/m)
  expect(text).toMatch(/^profile: kanzlei +#/m)
  await app.close()
})

test('a user set with a header shows up as „eigene“ and is used', async () => {
  const dirs = await makeDirs()
  const set = join(dirs.templates, 'eigen')
  await mkdir(set)
  await writeFile(join(set, 'eigen.typ'), '// own set\n')
  await writeFile(
    join(set, 'eigen.header.md'),
    '---\n# Eigenes Set für Protokolle\ntemplate: eigen\ntitle: ""\n---\n',
  )
  const { app, page, notes } = await launch({ dirs })
  await clickMenu(app, 'new-from-template')
  const row = page.getByTestId('tpl-row-eigen')
  await expect(row).toContainText('eigene')
  await expect(row).toContainText('Eigenes Set für Protokolle')
  await page.getByTestId('tpl-set-eigen').check()
  await expect(page.getByTestId('tpl-profile-row')).toBeHidden()
  await page.keyboard.press('Enter')
  await expect(picker(page)).toHaveCount(0)
  await page.keyboard.type('Protokoll')
  const path = await activePath(page, notes)
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('Protokoll'))
  expect(saved.toString('utf8')).toBe(
    '---\n# Eigenes Set für Protokolle\ntemplate: eigen\ntitle: "Protokoll"\n---\n',
  )
  await app.close()
})

test('Esc closes the template picker without a new tab', async () => {
  const { app, page, notes } = await launch()
  await clickMenu(app, 'new-from-template')
  await expect(picker(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker(page)).toHaveCount(0)
  await expect(tabs(page)).toHaveCount(1)
  // A second open works after a cancel (the re-entry guard was released).
  await clickMenu(app, 'new-from-template')
  await expect(picker(page)).toBeVisible()
  await page.getByTestId('tpl-cancel').click()
  await expect(picker(page)).toHaveCount(0)
  await expect(tabs(page)).toHaveCount(1)
  expect(await readdir(notes)).toEqual([])
  await app.close()
})

test('Einfügen → YAML-Header …: the chosen set goes on top, a second insert is refused', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Brief.md')
  await writeFile(note, '# Brief\n\nText\n')
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'insert-header')
  await expect(picker(page)).toBeVisible()
  // The default set is offered first and preselected here.
  await expect(page.locator('[data-testid^=tpl-row-]').first()).toHaveAttribute(
    'data-testid',
    'tpl-row-memo',
  )
  await expect(page.getByTestId('tpl-set-memo')).toBeChecked()
  await page.getByTestId('tpl-set-din5008a').check()
  await expect(page.getByTestId('tpl-profile')).toHaveValue('beispiel')
  await page.getByTestId('tpl-ok').click()
  await expect(picker(page)).toHaveCount(0)
  const saved = await waitForFile(note, (b) => b.toString('utf8').includes('template: din5008a'))
  const text = saved.toString('utf8')
  expect(text.startsWith('---\n# Brief nach DIN 5008')).toBe(true)
  expect(text).toMatch(/^profile: beispiel +#/m)
  expect(text.endsWith('---\n\n# Brief\n\nText\n')).toBe(true)

  await clickMenu(app, 'insert-header')
  await expect(page.locator('.toast')).toContainText('schon einen YAML-Header')
  await expect(picker(page)).toHaveCount(0)
  await app.close()
})
