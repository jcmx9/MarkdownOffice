import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test, typeInEditor, waitForFile } from './helpers'

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

test("the start screen's „Neues Memo …“ starts a note with the memo header", async () => {
  const { app, page, notes } = await launch()
  await clickMenu(app, 'close-tab')
  await expect(tabs(page)).toHaveCount(0)
  const button = page.locator('#empty [data-action=new]')
  await expect(button).toHaveText('Neues Memo …')
  await button.click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(page.locator('.cm-content')).toContainText('template: memo')
  expect(await readdir(notes)).toEqual([])
  await app.close()
})

test('Mod+N note emptied again leaves no file behind', async () => {
  const { app, page, notes } = await launch()
  await clickMenu(app, 'new')
  await expect(page.locator('.cm-content')).toContainText('template: memo')
  // Deleting the whole header makes the doc differ from its clean text, but an empty note that
  // never reached the disk is not worth a file — neither via autosave nor on closing the tab.
  await clickMenu(app, 'select-all')
  await page.keyboard.press('Delete')
  await expect(page.locator('.cm-content')).not.toContainText('template')
  await page.waitForTimeout(1500)
  expect(await readdir(notes)).toEqual([])
  await clickMenu(app, 'close-tab')
  await expect(tabs(page)).toHaveCount(1)
  await page.waitForTimeout(500)
  expect(await readdir(notes)).toEqual([])
  await app.close()
})

test('Neu aus Vorlage: memo first and preselected, din5008a with a user profile', async () => {
  const dirs = await makeDirs()
  await mkdir(join(dirs.templates, 'profiles'))
  await writeFile(join(dirs.templates, 'profiles', 'kanzlei.yaml'), 'name: Kanzlei\n')
  const { app, page, notes } = await launch({ dirs })
  await clickMenu(app, 'new-from-template')
  await expect(picker(page)).toBeVisible()
  await expect(page.getByTestId('tpl-row-din5008a')).toContainText('mitgeliefert')
  // memo is offered too, first and preselected: one Enter makes the usual note.
  await expect(page.locator('[data-testid^=tpl-row-]').first()).toHaveAttribute(
    'data-testid',
    'tpl-row-memo',
  )
  await expect(page.getByTestId('tpl-set-memo')).toBeChecked()

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

test('Einfügen → Vorlage …: no header → the chosen set goes on top; again → nothing to add', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Brief.md')
  await writeFile(note, '# Brief\n\nText\n')
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'insert-template')
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

  // The same set again: the header already has every key, nothing changes.
  await clickMenu(app, 'insert-template')
  await page.getByTestId('tpl-set-din5008a').check()
  await page.getByTestId('tpl-ok').click()
  await expect(page.locator('.toast')).toContainText('hat schon alle Schlüssel')
  await app.close()
})

test('Einfügen → Vorlage …: merges into a CRLF header, YAML check offers the date fix, each one undo step', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Fremd.md')
  const original =
    '---\r\n# von woanders\r\ntitle: "Alt"   # mein Titel\r\ndate: 13/10/2026\r\n---\r\n\r\nText\r\n'
  await writeFile(note, original)
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'insert-template')
  await expect(page.getByTestId('tpl-set-memo')).toBeChecked()
  await page.keyboard.press('Enter')
  await expect(picker(page)).toHaveCount(0)
  const merged = (
    await waitForFile(note, (b) => b.toString('utf8').includes('template: memo'))
  ).toString('utf8')
  // Existing lines untouched, missing keys appended before the fence, CRLF everywhere.
  expect(
    merged.startsWith(
      '---\r\n# von woanders\r\ntitle: "Alt"   # mein Titel\r\ndate: 13/10/2026\r\ntemplate: memo ',
    ),
  ).toBe(true)
  expect(merged).toMatch(/^lang: de +# de oder en\r$/m)
  expect(merged.match(/^title:/gm)).toHaveLength(1)
  expect(merged.replace(/\r\n/g, '')).not.toContain('\n')
  expect(merged.endsWith('---\r\n\r\nText\r\n')).toBe(true)

  // The silent YAML check names the wrong date; nothing changes until „Übernehmen“.
  const banner = page.locator('.banner')
  await expect(banner).toContainText('YAML hat 1 Fehler')
  await shot(page, 'insert-template-yaml')
  await banner.getByRole('button', { name: 'Prüfen …' }).click()
  const row = page.getByTestId('validate-row')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('date')
  await expect(row).toContainText('→ 2026-10-13')
  await page.getByTestId('validate-apply').click()
  await expect(page.getByTestId('validate-dialog')).toHaveCount(0)
  const fixed = (
    await waitForFile(note, (b) => b.toString('utf8').includes('date: 2026-10-13'))
  ).toString('utf8')
  expect(fixed).toBe(merged.replace('date: 13/10/2026', 'date: 2026-10-13'))

  // Undo: first the fix alone, then the whole merge in one step.
  await clickMenu(app, 'undo')
  await waitForFile(note, (b) => b.toString('utf8') === merged)
  await clickMenu(app, 'undo')
  await waitForFile(note, (b) => b.toString('utf8') === original)
  await app.close()
})

test('Profil anlegen …: copies the din5008a example, sets profile: and opens the YAML', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Brief.md')
  await writeFile(note, '---\ntemplate: din5008a\nprofile: beispiel   # Absender\n---\n\nText\n')
  const { app, page } = await launch({ dirs, args: [note] })
  await expect(tabs(page)).toHaveCount(1)

  await clickMenu(app, 'create-profile')
  await page.locator('dialog.prompt input').fill('kanzlei')
  await page.keyboard.press('Enter')

  const dir = join(dirs.templates, 'din5008a', 'profiles')
  const yaml = join(dir, 'kanzlei.yaml')
  const copied = (await waitForFile(yaml)).toString('utf8')
  expect(copied).toMatch(/^signature: kanzlei-unterschrift\.svg$/m)
  expect((await readdir(dir)).sort()).toEqual(['kanzlei-unterschrift.svg', 'kanzlei.yaml'])
  // The YAML opens as its own tab, in the Code view (no rendered preview, no spellcheck).
  await expect(tabs(page)).toHaveCount(2)
  await expect(page.locator('[data-testid=tab].active .tab-label')).toHaveText('kanzlei.yaml')
  await expect(page.locator('.cm-editor')).toHaveClass(/mdo-code/)
  await expect(page.locator('.cm-content')).toHaveAttribute('spellcheck', 'false')
  await shot(page, 'create-profile')
  // The note got the new profile, keeping its comment column; autosaved like any edit.
  await waitForFile(note, (b) => /^profile: kanzlei +# Absender$/m.test(b.toString('utf8')))

  // Edits in the YAML tab are saved like a note's.
  await typeInEditor(page, 'phone: "0"\n')
  await waitForFile(yaml, (b) => b.toString('utf8').endsWith('phone: "0"\n'))
  // A profile is no note: export is refused with a hint, nothing runs.
  await clickMenu(app, 'export')
  await expect(page.locator('.toast')).toContainText('Nur Markdown-Notizen')

  // The same name again: refused, nothing overwritten.
  await tabs(page).first().click()
  await clickMenu(app, 'create-profile')
  await page.locator('dialog.prompt input').fill('kanzlei')
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast').last()).toContainText('Profil kanzlei gibt es schon.')
  expect((await readFile(yaml, 'utf8')).endsWith('phone: "0"\n')).toBe(true)
  await expect(tabs(page)).toHaveCount(2)

  // The picker offers the new profile for din5008a.
  await clickMenu(app, 'new-from-template')
  await page.getByTestId('tpl-set-din5008a').check()
  await expect(page.getByTestId('tpl-profile').locator('option')).toHaveText([
    'beispiel',
    'kanzlei',
  ])
  await page.getByTestId('tpl-cancel').click()
  await app.close()
})

test('Profil anlegen … is refused for a note without template:', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Notiz.md')
  await writeFile(note, '# Notiz\n')
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'create-profile')
  await expect(page.locator('.toast')).toContainText('kein Vorlagen-Set')
  await expect(page.locator('dialog.prompt')).toHaveCount(0)
  await app.close()
})
