import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test, waitForFile } from './helpers'

const NOTE = [
  '# Alpha',
  '',
  'Text alpha.',
  '',
  '## Alpha eins',
  '',
  'Text eins.',
  '',
  '## Alpha zwei',
  '',
  'Text zwei.',
  '',
  '# Beta',
  '',
  'Text beta.',
  '',
  '## Beta eins',
  '',
  'Text beta eins.',
  '',
].join('\n')

async function openNote(content = NOTE) {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Gliederung.md')
  await writeFile(note, content)
  const launched = await launch({ dirs, args: [note] })
  await launched.page.locator('.cm-editor.mdo-preview').waitFor()
  return { ...launched, note }
}

const outline = (page: Page) => page.locator('#outline')
const labels = (page: Page) => page.locator('#outline .mdo-ol-label')
const chevrons = (page: Page) => page.locator('#outline .mdo-ol-chevron')

async function sessionHas(userData: string, edit: boolean, present: boolean): Promise<void> {
  await waitForFile(join(userData, 'session.json'), (b) => {
    try {
      const o = JSON.parse(b.toString('utf8'))?.outline
      return o?.edit === edit && o?.present === present
    } catch {
      return false
    }
  })
}

test('toggle-outline shows the H1/H2 entries and hides them again', async () => {
  const { app, page } = await openNote()
  await expect(outline(page)).toBeHidden()
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeVisible()
  await expect(labels(page)).toHaveText(['Alpha', 'Alpha eins', 'Alpha zwei', 'Beta', 'Beta eins'])
  await shot(page, 'outline')
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeHidden()
  await app.close()
})

test('visibility is remembered per mode and across restarts', async () => {
  const { app, page, userData, dirs, note } = await (async () => {
    const o = await openNote()
    return {
      ...o,
      dirs: { root: o.root, notes: o.notes, userData: o.userData, templates: o.templates },
    }
  })()
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect(outline(page)).toBeHidden()
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeVisible()
  await shot(page, 'outline-present')
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeHidden()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect(outline(page)).toBeVisible()
  await sessionHas(userData, true, false)
  await app.close()

  const second = await launch({ dirs, args: [note] })
  await expect(outline(second.page)).toBeVisible()
  await clickMenu(second.app, 'toggle-present')
  await expect(second.page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect(outline(second.page)).toBeHidden()
  await second.app.close()
})

test('chevron folds text and outline in sync; unfold-all and fold-all follow', async () => {
  const { app, page } = await openNote()
  await clickMenu(app, 'toggle-outline')
  await expect(labels(page)).toHaveCount(5)
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0)

  await chevrons(page).first().click()
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1)
  await expect(labels(page)).toHaveText(['Alpha', 'Beta', 'Beta eins'])
  await expect(chevrons(page).first()).toHaveAttribute('aria-expanded', 'false')

  await clickMenu(app, 'unfold-all')
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0)
  await expect(labels(page)).toHaveCount(5)
  await expect(chevrons(page).first()).toHaveAttribute('aria-expanded', 'true')

  await clickMenu(app, 'fold-all')
  // Only the two H1 folds are visible; the H2 folds sit inside them.
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(2)
  // The outline refreshes on the next animation frame: wait for it, do not read once.
  const states = () =>
    chevrons(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-expanded')))
  await expect.poll(async () => (await states()).length).toBeGreaterThan(0)
  await expect.poll(async () => (await states()).every((s) => s === 'false')).toBe(true)
  await app.close()
})

test('chevrons only on chapters with sub-chapters; a page break does not make a section', async () => {
  const note = [
    '# Kontext',
    '',
    'Text ohne Unterkapitel.',
    '',
    '# Mitschrift',
    '',
    '## M1',
    '',
    '## M2',
    '',
    '<!-- pagebreak -->',
    '',
    '## M3',
    '',
  ].join('\n')
  const { app, page } = await openNote(note)
  await clickMenu(app, 'toggle-outline')
  await expect(labels(page)).toHaveText(['Kontext', 'Mitschrift', 'M1', 'M2', 'M3'])
  await expect(chevrons(page)).toHaveCount(1)
  await expect(
    page.locator('#outline li.mdo-ol-h1').nth(1).locator(':scope > .mdo-ol-chevron'),
  ).toHaveCount(1)
  await shot(page, 'outline-pagebreak')
  await app.close()
})

test('typing below a folded section keeps it folded; the chevron opens it in one click', async () => {
  const { app, page } = await openNote()
  await clickMenu(app, 'toggle-outline')
  await expect(labels(page)).toHaveCount(5)
  await chevrons(page).nth(1).click() // Beta: only H1s with H2s get a chevron
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1)
  await expect(labels(page)).toHaveCount(4)
  await page.locator('.cm-content').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  // The note ends with a newline: the text continues the last paragraph of Beta's section.
  await page.keyboard.type('Neu unten.')
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1)
  await expect(labels(page)).toHaveCount(4)
  await expect(chevrons(page).nth(1)).toHaveAttribute('aria-expanded', 'false')
  await chevrons(page).nth(1).click()
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0)
  await expect(chevrons(page).nth(1)).toHaveAttribute('aria-expanded', 'true')
  await expect(labels(page)).toHaveCount(5)
  await app.close()
})

test('a click jumps to the heading and focus stays in the editor', async () => {
  const { app, page } = await openNote()
  await clickMenu(app, 'toggle-outline')
  await labels(page).nth(3).click()
  await expect
    .poll(() =>
      page.evaluate(
        () => getSelection()?.anchorNode?.parentElement?.closest('.cm-line')?.textContent ?? '',
      ),
    )
    .toContain('Beta')
  await expect(page.locator('.cm-content')).toBeFocused()
  await page.keyboard.type('XY')
  await expect(labels(page).nth(3)).toHaveText('BetaXY')
  await app.close()
})

test('a long heading stays one line with the full text as title', async () => {
  const long = `Lang ${'x'.repeat(195)}`
  expect(long.length).toBe(200)
  const { app, page } = await openNote(`# Kurz\n\nText.\n\n# ${long}\n\nText.\n`)
  await clickMenu(app, 'toggle-outline')
  await expect(labels(page)).toHaveCount(2)
  const short = await labels(page)
    .nth(0)
    .evaluate((el) => (el as HTMLElement).offsetHeight)
  const longEl = labels(page).nth(1)
  expect(await longEl.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(short)
  await expect(longEl).toHaveAttribute('title', long)
  const widths = await page.evaluate(() => ({
    bar: (document.querySelector('#outline') as HTMLElement).offsetWidth,
    win: window.innerWidth,
  }))
  expect(widths.bar).toBeLessThanOrEqual(widths.win * 0.33 + 1)
  await app.close()
})

test('short headings get the minimum width of 14em', async () => {
  const { app, page } = await openNote('# A\n\nText.\n\n# B\n\nText.\n')
  await clickMenu(app, 'toggle-outline')
  await expect(labels(page)).toHaveCount(2)
  const { bar, em } = await page.evaluate(() => {
    const el = document.querySelector('#outline') as HTMLElement
    return { bar: el.offsetWidth, em: Number.parseFloat(getComputedStyle(el).fontSize) }
  })
  expect(bar).toBeGreaterThanOrEqual(14 * em - 1)
  await app.close()
})

test('a classic scrollbar does not cut a medium heading short', async () => {
  // Fits 33vw even in a ~1000px window with the H1 serif at 14px (Windows CI windows are narrower).
  const medium = 'Mittellange Überschrift Nr. 1'
  const body = Array.from({ length: 80 }, (_, i) => `# Kurz ${i}\n\nText.\n`).join('\n')
  const { app, page } = await openNote(`# ${medium}\n\nText.\n\n${body}`)
  // Force a non-overlay scrollbar as on Windows/Linux (CSSOM rule, not blocked by the CSP).
  await page.evaluate(() => {
    const sheet = document.styleSheets[0] as CSSStyleSheet
    sheet.insertRule('#outline::-webkit-scrollbar { width: 15px; }', sheet.cssRules.length)
  })
  await clickMenu(app, 'toggle-outline')
  await expect(labels(page)).toHaveCount(81)
  const m = await page.evaluate(() => {
    const el = document.querySelector('#outline') as HTMLElement
    const label = el.querySelector('.mdo-ol-label') as HTMLElement
    return {
      scrollbar: el.offsetWidth - el.clientWidth - 2,
      overflows: label.scrollWidth > label.clientWidth,
      bar: el.offsetWidth,
      win: window.innerWidth,
    }
  })
  expect(m.scrollbar).toBeGreaterThan(0)
  expect(m.overflows, JSON.stringify(m)).toBe(false)
  expect(m.bar).toBeLessThanOrEqual(m.win * 0.33 + 1)
  await app.close()
})

test('the outline grows and shrinks with the zoom; H2 rows hang from tree lines', async () => {
  const { app, page } = await openNote()
  await clickMenu(app, 'toggle-outline')
  const size = () =>
    labels(page)
      .first()
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  const base = await size()
  await clickMenu(app, 'zoom-in')
  await expect.poll(size).toBeGreaterThan(base)
  await shot(page, 'outline-zoomed')
  await clickMenu(app, 'zoom-reset')
  await expect.poll(size).toBe(base)
  // Every H2 row draws a branch; the last one under an H1 ends the trunk (└─).
  const branch = await page
    .locator('#outline .mdo-ol-h2')
    .first()
    .evaluate((el) => getComputedStyle(el, '::after').borderTopWidth)
  expect(branch).toBe('1px')
  await app.close()
})
