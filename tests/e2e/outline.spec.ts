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

test('a long heading stays one line; hover shows it in full, right-aligned', async () => {
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
  await longEl.hover()
  const tip = page.locator('.mdo-ol-tip')
  await expect(tip).toBeVisible()
  await expect(tip).toHaveText(long)
  const box = await longEl.boundingBox()
  const tipBox = await tip.boundingBox()
  expect(
    Math.abs((tipBox?.x ?? 0) + (tipBox?.width ?? 0) - ((box?.x ?? 0) + (box?.width ?? 0))),
  ).toBeLessThan(2)
  expect(tipBox?.width ?? 0).toBeGreaterThan(box?.width ?? 0)
  await shot(page, 'outline-tip')
  await page.mouse.move(5, 5)
  await expect(tip).toBeHidden()
  const widths = await page.evaluate(() => ({
    bar: (document.querySelector('#outline') as HTMLElement).offsetWidth,
    win: window.innerWidth,
  }))
  expect(widths.bar).toBeLessThanOrEqual(widths.win * 0.33 + 1)
  await app.close()
})

test('the outline keeps one width (18em), whatever the headings', async () => {
  const { app, page } = await openNote('# A\n\nText.\n\n# B\n\nText.\n')
  await clickMenu(app, 'toggle-outline')
  await expect(labels(page)).toHaveCount(2)
  const measure = () =>
    page.evaluate(() => {
      const el = document.querySelector('#outline') as HTMLElement
      return { bar: el.offsetWidth, em: Number.parseFloat(getComputedStyle(el).fontSize) }
    })
  const short = await measure()
  expect(
    Math.abs(
      short.bar - Math.min(18 * short.em, (await page.evaluate(() => window.innerWidth)) * 0.33),
    ),
  ).toBeLessThan(2)
  await page.locator('.cm-content').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await page.keyboard.type('\n\n# Eine deutlich längere Überschrift, die nicht mehr passt\n')
  await expect(labels(page)).toHaveCount(3)
  expect((await measure()).bar).toBe(short.bar)
  await app.close()
})

test('a classic scrollbar does not cut a medium heading short', async () => {
  // Fits 18em even in a ~1000px window with the H1 serif at 16px (Windows CI windows are narrower).
  const medium = 'Mittellange Überschrift'
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

test('the outline width is dragged by its left edge, kept across restarts, default in Present, draggable there for one Present only', async () => {
  const o = await openNote()
  const dirs = { root: o.root, notes: o.notes, userData: o.userData, templates: o.templates }
  const { app, page } = o
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeVisible()
  const width = () => outline(page).evaluate((el) => (el as HTMLElement).offsetWidth)
  const before = await width()
  const grip = page.locator('#outline-grip')
  await expect(grip).toBeVisible()
  const box = await grip.boundingBox()
  if (!box) throw new Error('no grip')
  await page.mouse.move(box.x + box.width / 2, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + 100, { steps: 5 })
  await page.mouse.up()
  await expect.poll(width).toBeGreaterThan(before + 50)
  const dragged = await width()

  // Present always uses the default width; back in Edit the dragged width returns.
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeVisible()
  await expect(grip).toBeVisible()
  await expect(outline(page)).not.toHaveClass(/mdo-ol-custom/)
  await expect.poll(width).toBe(before)
  // Dragging in Present widens the outline for this Present only.
  // Entering Present asks for fullscreen, and the window can still change its size after the
  // checks above (Linux CI: Xvfb applies it late), so a grip position measured once could be
  // stale and the press missed the grip. Press until the drag has really started (the grip
  // sets body.mdo-ol-resizing on pointerdown); from then on the grip captures the pointer and
  // the new width depends only on the distance moved.
  let start = { x: 0, y: 0 }
  await expect(async () => {
    const pbox = await grip.boundingBox()
    if (!pbox) throw new Error('no grip in Present')
    start = { x: pbox.x + pbox.width / 2, y: pbox.y + 100 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    try {
      await expect(page.locator('body.mdo-ol-resizing')).toHaveCount(1, { timeout: 500 })
    } catch (err) {
      await page.mouse.up()
      throw err
    }
  }).toPass({ timeout: 10_000 })
  await page.mouse.move(start.x - 80, start.y, { steps: 5 })
  await page.mouse.up()
  await expect.poll(width).toBeGreaterThan(before + 60)
  await shot(page, 'outline-present-grip')
  // Leaving Present restores the saved Edit width, untouched by the Present drag.
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect.poll(width).toBe(dragged)
  // Entering Present again starts at the default width.
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
  await expect.poll(width).toBe(before)
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  await expect.poll(width).toBe(dragged)
  await app.close()

  const second = await launch({ dirs, args: [o.note] })
  await expect(outline(second.page)).toBeVisible()
  await expect
    .poll(() => outline(second.page).evaluate((el) => (el as HTMLElement).offsetWidth))
    .toBe(dragged)
  // Double-click on the grip restores the default width.
  await second.page.locator('#outline-grip').dblclick()
  await expect
    .poll(() => outline(second.page).evaluate((el) => (el as HTMLElement).offsetWidth))
    .toBe(before)
  await second.app.close()
})

test('entries read as a list: arrow with children, bullet without; levels are relative', async () => {
  const note = [
    '# Kapitel mit Unterkapiteln',
    '',
    '## Erstes Unterkapitel',
    '',
    'Text.',
    '',
    '## Zweites Unterkapitel',
    '',
    'Text.',
    '',
    '# Kapitel ohne Unterkapitel',
    '',
    'Text.',
    '',
  ].join('\n')
  const { app, page, note: file } = await openNote(note)
  await clickMenu(app, 'toggle-outline')
  await expect(chevrons(page)).toHaveCount(1)
  await expect(page.locator('#outline .mdo-ol-spacer')).toHaveCount(3)
  await shot(page, 'outline-list-chapters')
  await writeFile(
    file,
    [
      '## Entstehung und historische Bedeutung des Taufbeckens',
      '',
      'a',
      '',
      '## Material, Technik und Aufbau',
      '',
      'b',
      '',
      '## Die Bilderwelt des Beckens',
      '',
      'c',
      '',
      '## Kunstgeschichtlicher Rang: Menschliche Gestalten',
      '',
      'd',
      '',
      '## Top 5 Deutschsprachige Web-Links',
      '',
      'e',
      '',
    ].join('\n'),
  )
  await expect(page.locator('#outline .mdo-ol-spacer')).toHaveCount(5, { timeout: 15000 })
  await expect(page.locator('#outline li.mdo-ol-top')).toHaveCount(5)
  await expect(page.locator('#outline li.mdo-ol-sub')).toHaveCount(0)
  const font = await page
    .locator('#outline li.mdo-ol-top > .mdo-ol-label')
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily)
  expect(font).toMatch(/serif|Serif|Source Serif/i)
  await shot(page, 'outline-list-h2-only')
  await app.close()
})
