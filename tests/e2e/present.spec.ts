import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ElectronApplication, expect } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test, waitForFile } from './helpers'

const FIXTURE = join(__dirname, '..', 'fixtures', 'preview.md')
const linux = process.platform === 'linux'

async function openFixture() {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(FIXTURE, note)
  const launched = await launch({ dirs, args: [note] })
  await launched.page.locator('.cm-editor.mdo-preview').waitFor()
  return { ...launched, note }
}

const fullScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false)

/** Windows/Linux: the window's menu bar (macOS has none in the window). */
const menuBar = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMenuBarVisible() ?? false)

/**
 * Present starts focused (only the section with the cursor shows); tests that click text in
 * other sections turn focus off first.
 */
async function focusOff(app: ElectronApplication, page: import('@playwright/test').Page) {
  await expect(page.locator('.cm-editor.mdo-focus')).toHaveCount(1)
  await clickMenu(app, 'toggle-focus')
  await expect(page.locator('.cm-editor.mdo-focus')).toHaveCount(0)
}

const bodySize = (page: import('@playwright/test').Page) =>
  page.locator('.cm-scroller').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))

test('Present: fullscreen, title block, info line only; Esc returns', async () => {
  const { app, page } = await openFixture()
  const editSize = await bodySize(page)
  await clickMenu(app, 'toggle-present')
  await focusOff(app, page)
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect(page.locator('#tabbar')).toBeHidden()
  await expect(page.locator('#status')).toBeHidden()
  await expect(page.getByTestId('il-clock')).toHaveText(/^\d{2}:\d{2}$/)
  await expect(page.locator('.cm-editor.mdo-present .mdo-tb-title')).toHaveText(
    'Kickoff Kaffeerösterei',
  )
  await expect(page.locator('.cm-line.mdo-frontmatter')).toHaveCount(0)
  expect(await bodySize(page)).toBeGreaterThan(editSize * 1.5)
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(true)
  await shot(page, 'present')
  await page.locator('.cm-line', { hasText: 'Ein Absatz mit' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect(page.locator('#tabbar')).toBeVisible()
  await expect(page.locator('#infoline')).toBeHidden()
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(false)
  // 26.10.6 on Windows: the menu bar stayed hidden after Present.
  if (process.platform !== 'darwin') await expect.poll(() => menuBar(app)).toBe(true)
  await app.close()
})

test('Present: a table cell is edited in place; Escape leaves the cell, then Present', async () => {
  const { app, page, note } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await focusOff(app, page)
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await page.locator('table.mdo-table td', { hasText: 'Filter' }).click()
  await expect(page.locator('table.mdo-table .mdo-cell-edit')).toHaveText('Filter')
  await page.keyboard.press('End')
  await page.keyboard.type('kaffee')
  await page.keyboard.press('Escape')
  await expect(page.locator('table.mdo-table .mdo-cell-edit')).toHaveCount(0)
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await waitForFile(note, (b) => b.toString('utf8').includes('| Filterkaffee |'))
  await page.keyboard.press('Escape')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(false)
  await app.close()
})

test('typing in Present is saved; the header stays untouched', async () => {
  const { app, page, note } = await openFixture()
  const original = await readFile(note, 'utf8')
  await clickMenu(app, 'toggle-present')
  await focusOff(app, page)
  await page.locator('.cm-line', { hasText: 'Text unter drei Rauten' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Neu im Termin.')
  const saved = await waitForFile(note, (b) => b.toString('utf8').includes('Neu im Termin.'))
  expect(
    saved.toString('utf8').startsWith(original.slice(0, original.indexOf('\n---\n') + 5)),
  ).toBe(true)
  await app.close()
})

test('Present from Code view shows Preview and returns to Code', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-view')
  await expect(page.locator('.cm-editor.mdo-code')).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('.cm-editor.mdo-preview.mdo-present')).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('.cm-editor.mdo-code')).toBeVisible()
  await app.close()
})

test('info line: tabs switch, zoom changes and is restored after restart', async () => {
  const dirs = await makeDirs()
  const a = join(dirs.notes, 'Kickoff.md')
  const b = join(dirs.notes, 'Zweite.md')
  await copyFile(FIXTURE, a)
  await writeFile(b, '# Zweite Notiz\n\nInhalt.\n')
  const first = await launch({ dirs, args: [a, b] })
  await clickMenu(first.app, 'toggle-present')
  await expect(first.page.getByTestId('il-tab')).toHaveCount(2)
  await first.page.getByTestId('il-tab').first().click()
  await expect(first.page.locator('.mdo-tb-title')).toHaveText('Kickoff Kaffeerösterei')
  // Muted inactive tab, lifted active tab.
  const colors = await first.page
    .getByTestId('il-tab')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).color))
  expect(colors[0]).not.toBe(colors[1])
  const before = await bodySize(first.page)
  await first.page.getByTestId('il-zoom-in').click()
  await expect(first.page.getByTestId('il-zoom')).toHaveText('110 %')
  expect(await bodySize(first.page)).toBeGreaterThan(before)
  // The zoom is persisted with the (debounced) session save.
  const session = join(dirs.userData, 'session.json')
  await waitForFile(session, (b) => {
    try {
      return JSON.parse(b.toString('utf8'))?.zoom?.present === 1.1
    } catch {
      return false
    }
  })
  await first.app.close()
  const second = await launch({ dirs })
  await expect(second.page.locator('body.mdo-mode-present')).toHaveCount(0)
  await clickMenu(second.app, 'toggle-present')
  await expect(second.page.getByTestId('il-zoom')).toHaveText('110 %')
  await second.app.close()
})

test('zoom in Edit scales the text; reset returns to 100 %', async () => {
  const { app, page } = await openFixture()
  const base = await bodySize(page)
  await clickMenu(app, 'zoom-in')
  await expect.poll(() => bodySize(page)).toBeGreaterThan(base)
  await clickMenu(app, 'zoom-reset')
  await expect.poll(() => bodySize(page)).toBeCloseTo(base, 1)
  await app.close()
})

test('export and header toggle are refused in Present', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  for (const cmd of ['export', 'toggle-header']) {
    // Toasts stack: clear them so each command has to produce its own.
    await page.evaluate(() => {
      for (const t of document.querySelectorAll('.toast')) t.remove()
    })
    await clickMenu(app, cmd)
    // Filtered: where the OS refuses fullscreen (xvfb), its notice may arrive meanwhile.
    const refused = page.locator('.toast', { hasText: 'Im Präsentationsmodus nicht verfügbar' })
    await expect(refused).toHaveCount(1)
  }
  await expect(page.locator('.cm-editor.mdo-preview.mdo-present')).toBeVisible()
  await expect(page.locator('.panel')).toHaveCount(0)
  await app.close()
})

for (const via of ['menu', 'switch'] as const) {
  test(`Code in Present (${via}) ends Present and shows the Code view`, async () => {
    const { app, page } = await openFixture()
    await clickMenu(app, 'toggle-present')
    await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
    if (!linux) await expect.poll(() => fullScreen(app)).toBe(true)
    if (via === 'menu') await clickMenu(app, 'toggle-view')
    else await page.getByTestId('il-code').click()
    await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
    await expect(page.locator('.cm-editor.mdo-code')).toBeVisible()
    await expect(page.locator('.cm-editor.mdo-present')).toHaveCount(0)
    await expect(page.getByTestId('status-edit')).toHaveClass(/active/)
    await expect(page.getByTestId('status-code')).toHaveClass(/active/)
    await expect(page.locator('.toast', { hasText: 'nicht verfügbar – Esc' })).toHaveCount(0)
    if (!linux) await expect.poll(() => fullScreen(app)).toBe(false)
    await expect(page.locator('.cm-content')).toBeFocused()
    await app.close()
  })
}

test('Code right after entering Present (fullscreen in flight) ends in Edit + Code', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await clickMenu(app, 'toggle-view')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect(page.locator('.cm-editor.mdo-code')).toBeVisible()
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(false)
  await page.waitForTimeout(1500) // a late fullscreen settle must not re-enter Present
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  if (!linux) expect(await fullScreen(app)).toBe(false)
  await app.close()
})

test('Esc does not leave Present while the rename dialog is open', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await clickMenu(app, 'rename')
  await expect(page.locator('dialog.prompt')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog.prompt')).toHaveCount(0)
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await app.close()
})

test('an OS fullscreen exit leaves Present cleanly', async () => {
  test.skip(linux, 'no window manager fullscreen under xvfb')
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await expect.poll(() => fullScreen(app)).toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setFullScreen(false))
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect(page.locator('#tabbar')).toBeVisible()
  await app.close()
})

test('closing the last tab in Present returns to Edit', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(true)
  await clickMenu(app, 'close-tab')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect(page.locator('#infoline')).toBeHidden()
  await expect(page.locator('#tabbar')).toBeVisible()
  await expect(page.locator('#status')).toBeVisible()
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(false)
  await app.close()
})

test('a task checkbox click in Present ticks the task in the saved file', async () => {
  const { app, page, note } = await openFixture()
  const original = await readFile(note, 'utf8')
  expect(original).toContain('- [ ] Angebot schicken')
  await clickMenu(app, 'toggle-present')
  await focusOff(app, page)
  await page.locator('.cm-editor.mdo-present .mdo-task').first().click()
  const saved = (
    await waitForFile(note, (b) => b.toString('utf8').includes('- [x] Angebot schicken'))
  ).toString('utf8')
  expect(saved).toBe(original.replace('- [ ] Angebot schicken', '- [x] Angebot schicken'))
  await app.close()
})

test('entering Present with the cursor in the header moves it out; typing spares the header', async () => {
  const { app, page, note } = await openFixture()
  const original = await readFile(note, 'utf8')
  const headerEnd = original.indexOf('\n---\n') + 5
  await clickMenu(app, 'toggle-view')
  await expect(page.locator('.cm-editor.mdo-code')).toBeVisible()
  await page.locator('.cm-line', { hasText: 'toptitle:' }).click()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('.cm-editor.mdo-present .mdo-tb-title')).toBeVisible()
  await page.keyboard.type('Zwischenruf')
  const saved = (
    await waitForFile(note, (b) => b.toString('utf8').includes('Zwischenruf'))
  ).toString('utf8')
  expect(saved.slice(0, headerEnd)).toBe(original.slice(0, headerEnd))
  expect(saved.indexOf('Zwischenruf')).toBeGreaterThanOrEqual(headerEnd)
  await app.close()
})

test('Esc during the fullscreen enter animation never strands Edit in fullscreen', async () => {
  test.skip(linux, 'no window manager fullscreen under xvfb')
  const { app, page } = await openFixture()
  for (let round = 0; round < 3; round++) {
    await clickMenu(app, 'toggle-present')
    await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
    // Leave at once, while the enter animation is still running.
    await page.keyboard.press('Escape')
    await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
    await expect.poll(() => fullScreen(app), { timeout: 10_000 }).toBe(false)
  }
  // Present still enters and leaves fullscreen afterwards.
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect.poll(() => fullScreen(app)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect.poll(() => fullScreen(app), { timeout: 10_000 }).toBe(false)
  await app.close()
})

test('a burst of Present toggles ends consistent: Edit is never fullscreen', async () => {
  test.skip(linux, 'no window manager fullscreen under xvfb')
  const { app, page } = await openFixture()
  // Three toggles in one tick: enter, leave while the enter still animates, enter again.
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('toggle-present')
    for (let i = 0; i < 3; i++) item?.click()
  })
  // Deliberate settle time: every queued fullscreen transition must have landed.
  await page.waitForTimeout(3000)
  const present = (await page.locator('body.mdo-mode-present').count()) === 1
  if (!present) expect(await fullScreen(app)).toBe(false)
  if (present) await page.keyboard.press('Escape')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect.poll(() => fullScreen(app), { timeout: 10_000 }).toBe(false)
  await app.close()
})

test('Esc with a selection in Present: the first collapses it, the second leaves', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await focusOff(app, page)
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await page.locator('.cm-line', { hasText: 'Ein Absatz mit' }).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  // drawSelection paints a non-empty selection as .cm-selectionBackground.
  const selection = page.locator('.cm-editor .cm-selectionBackground')
  await expect(selection.first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(selection).toHaveCount(0)
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await app.close()
})

/** Makes the OS "refuse" fullscreen: the window ignores setFullScreen. */
const refuseFullScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.setFullScreen = () => {}
  })

test('a refused fullscreen keeps Present running windowed, with a notice', async () => {
  const { app, page } = await openFixture()
  await refuseFullScreen(app)
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect(page.locator('.toast')).toContainText(
    'Vollbild nicht verfügbar – Präsentation im Fenster',
    { timeout: 8000 },
  )
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  expect(await fullScreen(app)).toBe(false)
  // Present and fullscreen stay in step afterwards: leaving and entering again work.
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await app.close()
})

test('a toggle during an in-flight fullscreen request is applied afterwards (last wins)', async () => {
  const { app, page } = await openFixture()
  // A never-entering window keeps the enter request in flight for the refusal timeout.
  await refuseFullScreen(app)
  // Records every toast ever shown: a toast removes itself after 4 s, so a later count of 0
  // would not prove that none appeared.
  await page.evaluate(() => {
    const seen: string[] = []
    Object.assign(window, { seenToasts: seen })
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes)
          if (n instanceof HTMLElement && n.classList.contains('toast'))
            seen.push(n.textContent ?? '')
    }).observe(document.body, { childList: true, subtree: true })
  })
  const toasts = () =>
    page.evaluate(() => (window as unknown as { seenToasts: string[] }).seenToasts.slice())
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await clickMenu(app, 'toggle-present') // during the in-flight enter: remembered
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0, { timeout: 8000 })
  // No refusal notice: the pending toggle already wanted Edit when the enter was refused.
  expect(await toasts()).toEqual([])
  // An even number of extra toggles is a no-op: Present stays.
  await clickMenu(app, 'toggle-present')
  await clickMenu(app, 'toggle-present')
  await clickMenu(app, 'toggle-present')
  await page.waitForTimeout(4500) // deliberately past the refusal timeout
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await app.close()
})

test('the status switches change view and mode; the info line returns to Edit', async () => {
  const { app, page } = await openFixture()
  await expect(page.getByTestId('status-clock')).toHaveText(/^\d{2}:\d{2}$/)
  await expect(page.getByTestId('status-preview')).toHaveClass(/active/)
  await shot(page, 'status-switches')
  await page.getByTestId('status-code').click()
  await expect(page.locator('.cm-editor.mdo-preview')).toHaveCount(0)
  await expect(page.getByTestId('status-code')).toHaveClass(/active/)
  await expect(page.locator('.cm-content')).toBeFocused()
  await page.getByTestId('status-preview').click()
  await expect(page.locator('.cm-editor.mdo-preview')).toHaveCount(1)
  await page.getByTestId('status-present').click()
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect(page.getByTestId('il-present')).toHaveClass(/active/)
  await expect(page.getByTestId('il-code')).toBeEnabled()
  await expect(page.getByTestId('il-preview')).toBeDisabled()
  await shot(page, 'infoline-switches')
  await page.getByTestId('il-edit').click()
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect(page.getByTestId('status-edit')).toHaveClass(/active/)
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(false)
  await app.close()
})
