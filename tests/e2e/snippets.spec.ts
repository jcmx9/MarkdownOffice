import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { clickMenu, launch, MOD, makeDirs, test, waitForFile } from './helpers'

const today = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

/** A new note is created on the first keystroke; wait until its .md file exists. */
async function newNotePath(notes: string): Promise<string> {
  const end = Date.now() + 5000
  for (;;) {
    const found = (await readdir(notes)).find((n) => n.endsWith('.md'))
    if (found) return join(notes, found)
    if (Date.now() > end) throw new Error('no note was created')
    await new Promise((r) => setTimeout(r, 100))
  }
}

const popup = (page: Page) => page.locator('.cm-tooltip-autocomplete')

/** Asserts that a condition holds for a whole window (catches a late change, e.g. a late exit). */
async function holds(check: () => Promise<boolean>, ms = 600): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    expect(await check()).toBe(true)
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** CM keeps a typing-triggered query pending ~100 ms; an Esc in that window only closes it. */
const settle = (page: Page) => page.waitForTimeout(300)

/** Completion opens after a short delay and ignores accept keys right after opening. */
async function acceptFirst(page: Page): Promise<void> {
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator('li[aria-selected=true]')).toHaveCount(1)
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
}

test('new note, :meeting, tab through the stops, autosaved', async () => {
  // The start note is empty (Mod+N would start with the memo header): :meeting writes its own.
  const { app, page, notes } = await launch()
  await page.locator('.cm-content').click()
  await page.keyboard.type(':mee')
  await expect(popup(page).locator('li')).toHaveCount(1)
  await expect(popup(page)).toContainText(':meeting')
  await acceptFirst(page)
  await page.keyboard.type('ACME')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Kickoff')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Anna')
  const path = await newNotePath(notes)
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('- Anna'))
  expect(
    saved
      .toString('utf8')
      .startsWith(`---\ntoptitle: "ACME"\ntitle: "Kickoff"\ndate: ${today()}\n`),
  ).toBe(true)
  await app.close()
})

test('prose colons do not trigger: "Hinweis:" and ":D" followed by Enter', async () => {
  const { app, page, notes } = await launch()
  await page.locator('.cm-content').click()
  await page.keyboard.type('Hinweis:')
  await page.waitForTimeout(400)
  await expect(popup(page)).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Super :D')
  await page.waitForTimeout(400)
  await expect(popup(page)).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ende')
  const path = await newNotePath(notes)
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('Ende'))
  expect(saved.toString('utf8')).toBe('Hinweis:\nSuper :D\nEnde')
  await app.close()
})

test('Present: first Esc closes the list, second Esc leaves Present', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Present.md')
  await writeFile(note, '# Titel\n\nText')
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await page.locator('.cm-line', { hasText: 'Text' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' :mee')
  await expect(popup(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup(page)).toHaveCount(0)
  await holds(async () => (await page.locator('body.mdo-mode-present').count()) === 1)
  await expect(page.locator('.cm-content')).toContainText('Text :mee')
  await expect(page.locator('.cm-content')).not.toContainText('toptitle:')
  await page.keyboard.press('Escape')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await app.close()
})

test('user snippet overrides a built-in and a new file appears after focus', async () => {
  const dirs = await makeDirs()
  const snippetFolder = join(dirs.root, 'snippets')
  await mkdir(snippetFolder)
  await writeFile(join(snippetFolder, 'meeting.tpl.md'), 'Eigenes $1')
  const { app, page, notes } = await launch({ dirs, settings: { snippetFolder } })
  await page.locator('.cm-content').click()
  await page.keyboard.type(':meeting')
  await acceptFirst(page)
  const path = await newNotePath(notes)
  await waitForFile(path, (b) => b.toString('utf8') === 'Eigenes ')

  await writeFile(join(snippetFolder, 'kunde.tpl.md'), 'Kunde: $1')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.keyboard.press('Enter')
  // The focus rescan is async IPC: retype until the registry has the new snippet.
  await expect(async () => {
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(':kun')
    await expect(popup(page)).toContainText(':kunde', { timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await app.close()
})

test(':newpage inserts the page break byte-exact', async () => {
  const { app, page, notes } = await launch()
  await page.locator('.cm-content').click()
  await page.keyboard.type(':newp')
  await acceptFirst(page)
  const path = await newNotePath(notes)
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('pagebreak'))
  expect(saved.toString('utf8')).toBe('\n<!-- pagebreak -->\n\n')
  await app.close()
})

test('Present, new note: :meeting fills toptitle and title, then the title block shows them', async () => {
  // The empty start note: a Mod+N note already carries the memo header.
  const { app, page, notes } = await launch()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await page.locator('.cm-content').click()
  await page.keyboard.type(':mee')
  await acceptFirst(page)
  await page.keyboard.type('ACME')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Kickoff')
  await settle(page)
  // First Esc ends the snippet session: the header collapses to the title block.
  await page.keyboard.press('Escape')
  await expect(page.locator('.mdo-titleblock .mdo-tb-title')).toHaveText('Kickoff')
  await expect(page.locator('.mdo-titleblock .mdo-tb-toptitle')).toHaveText('ACME')
  await holds(async () => (await page.locator('body.mdo-mode-present').count()) === 1)
  const path = await newNotePath(notes)
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('Kickoff'))
  expect(
    saved
      .toString('utf8')
      .startsWith(`---\ntoptitle: "ACME"\ntitle: "Kickoff"\ndate: ${today()}\n`),
  ).toBe(true)
  // Typing now goes below the header, never into it.
  await page.keyboard.type('Notiz')
  const after = await waitForFile(path, (b) => b.toString('utf8').includes('Notiz'))
  expect(after.toString('utf8').startsWith('---\ntoptitle: "ACME"\ntitle: "Kickoff"\n')).toBe(true)
  await app.close()
})

test('switching tabs closes an open snippet list', async () => {
  const dirs = await makeDirs()
  const a = join(dirs.notes, 'A.md')
  const b = join(dirs.notes, 'B.md')
  await writeFile(a, 'Alpha')
  await writeFile(b, 'Beta')
  const { app, page } = await launch({ dirs, args: [a, b] })
  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' :mee')
  await expect(popup(page)).toBeVisible()
  const active = page.locator('#tabbar .tab.active')
  const name = await active.textContent()
  await page.locator('#tabbar .tab:not(.active)').first().click()
  await expect(active).not.toHaveText(name ?? '')
  await page.locator('#tabbar .tab:not(.active)').first().click()
  await expect(active).toHaveText(name ?? '')
  await page.waitForTimeout(300)
  await expect(popup(page)).toHaveCount(0)
  await app.close()
})

test('page break from the menu and with Mod+Enter inserts exactly one', async () => {
  const dirs = await makeDirs()
  const path = join(dirs.notes, 'PB.md')
  await writeFile(path, 'Alpha\n\nBeta\n')
  const { app, page } = await launch({ dirs, args: [path] })
  await page.locator('.cm-content').click()
  await page.keyboard.press(`${MOD}+Home`)
  await page.keyboard.press('End')
  await clickMenu(app, 'insert-pagebreak')
  const first = await waitForFile(path, (b) => b.toString('utf8').includes('<!-- pagebreak -->'))
  expect(first.toString('utf8')).toBe('Alpha\n\n<!-- pagebreak -->\n\nBeta\n')
  await page.keyboard.press(`${MOD}+End`)
  await page.keyboard.press(`${MOD}+Enter`)
  const second = await waitForFile(
    path,
    (b) => (b.toString('utf8').match(/<!-- pagebreak -->/g) ?? []).length === 2,
  )
  expect(second.toString('utf8')).toBe(
    'Alpha\n\n<!-- pagebreak -->\n\nBeta\n\n<!-- pagebreak -->\n',
  )
  await app.close()
})

test('Einfügen → YAML-Header … puts the memo set’s header on top, once', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Termin.md')
  await writeFile(note, '# Termin\n\nText\n')
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'insert-header')
  // The picker preselects memo: Enter takes it.
  await expect(page.getByTestId('tpl-set-memo')).toBeChecked()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('tpl-dialog')).toHaveCount(0)
  await page.keyboard.type('Kickoff')
  const saved = await waitForFile(note, (b) => b.toString('utf8').includes('title: "Kickoff"'))
  const text = saved.toString('utf8')
  expect(text.startsWith('---\n# Alle Schlüssel und Regeln:')).toBe(true)
  expect(text).toMatch(/^template: memo +#/m)
  expect(text.endsWith('---\n\n# Termin\n\nText\n')).toBe(true)
  await clickMenu(app, 'insert-header')
  await expect(page.locator('.toast')).toContainText('schon einen YAML-Header')
  await app.close()
})
