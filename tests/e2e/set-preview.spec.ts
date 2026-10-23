import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page } from '@playwright/test'
import { clickMenu, installSet, launch, makeDirs, shot, test } from './helpers'

const FIXTURES = join(__dirname, '..', 'fixtures')
const BRIEF = join(FIXTURES, 'brief.md')
const MEMO_NOTE = join(FIXTURES, 'preview.md')
const linux = process.platform === 'linux'

/** CSS px per print unit (96 dpi): what a set's `11pt` or `165mm` is at zoom 1. */
const PT = 96 / 72
const MM = 96 / 25.4

// fx-brief (din5008a-like): 11pt body, 12.9pt line distance, 165 mm measure.
const BRIEF_SIZE = 11 * PT
const BRIEF_LINE = 12.9 * PT
const BRIEF_MEASURE = 165 * MM
// memo: 10pt body.
const MEMO_SIZE = 10 * PT

const tabs = (page: Page) => page.locator('[data-testid=tab]')

const fullScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false)

const bodySize = (page: Page) =>
  page.locator('.cm-scroller').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))

/** The note's front matter with `template: <set>` as its first key. */
async function memoNoteWith(set: string | null): Promise<string> {
  const text = await readFile(MEMO_NOTE, 'utf8')
  return set === null ? text : text.replace(/^---\n/, `---\ntemplate: ${set}\n`)
}

/** Waits until the shown note's set scope is on the editor (its inputs arrived). */
async function setShown(page: Page, set: string): Promise<void> {
  await expect(page.locator('#editor')).toHaveAttribute('data-mdo-set', set)
}

/** brief.md (set fx-brief, profile fx) opened as the only tab. */
async function openBrief(settings: Record<string, unknown> = {}) {
  const dirs = await makeDirs()
  await installSet(dirs, 'fx-brief')
  const note = join(dirs.notes, 'Brief.md')
  await copyFile(BRIEF, note)
  const launched = await launch({ dirs, args: [note], settings })
  await launched.page.locator('.cm-editor.mdo-preview').waitFor()
  await setShown(launched.page, 'fx-brief')
  return { ...launched, note }
}

/** Leaves Present the way present.spec does: toggled off, then out of the real fullscreen. */
async function leavePresent(app: ElectronApplication, page: Page): Promise<void> {
  if ((await page.locator('body.mdo-mode-present').count()) > 0) {
    await clickMenu(app, 'toggle-present')
  }
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  if (!linux) await expect.poll(() => fullScreen(app), { timeout: 10_000 }).toBe(false)
}

/**
 * Runs `body` in Present and always leaves it again, also when an assertion in `body` fails:
 * closing an app in a real fullscreen Space is the known trigger of the macOS CI launch hangs
 * (helpers.ts), and the teardown would otherwise close it there.
 */
async function inPresent(
  app: ElectronApplication,
  page: Page,
  body: () => Promise<void>,
): Promise<void> {
  await clickMenu(app, 'toggle-present')
  let passed = false
  try {
    await body()
    passed = true
  } finally {
    // After a failure the body's error is the one to report, not a failed leave.
    if (passed) await leavePresent(app, page)
    else await leavePresent(app, page).catch(() => {})
  }
}

/** Body text measures of the letter's long paragraph (it wraps over several lines). */
const letterMeasures = (page: Page) =>
  page.evaluate(() => {
    const line = [...document.querySelectorAll('.cm-line')].find((l) =>
      l.textContent?.startsWith('vielen Dank'),
    )
    if (!line) throw new Error('body line missing')
    const s = getComputedStyle(line)
    return {
      font: Number.parseFloat(
        getComputedStyle(document.querySelector('.cm-scroller') as Element).fontSize,
      ),
      lineHeight: Number.parseFloat(s.lineHeight),
      // Content box minus the one space advance the line box carries (under break-spaces the
      // space before a break counts): the width the text itself breaks in.
      measure:
        line.getBoundingClientRect().width -
        Number.parseFloat(s.paddingLeft) -
        Number.parseFloat(s.paddingRight) -
        Number.parseFloat(s.fontSize) *
          Number.parseFloat(
            (document.querySelector('.cm-editor') as HTMLElement).style.getPropertyValue(
              '--mdo-space-advance',
            ) || '0',
          ),
    }
  })

test('a letter set shows head and foot with the header hidden, nothing in Code view', async () => {
  const { app, page } = await openBrief()
  await clickMenu(app, 'toggle-header')
  const head = page.locator('.mdo-titleblock')
  await expect(head.locator('.mdo-tb-sender')).toHaveText(
    'Dr. Erika Muster · Hauptstraße 5 · 01067 Dresden',
  )
  await expect(head.locator('.mdo-tb-address .mdo-tb-line')).toHaveText([
    'Muster GmbH',
    'Frau Petra Beispiel',
    'Hauptstraße 1',
    '12345 Musterstadt',
  ])
  await expect(head.locator('.mdo-tb-date')).toHaveText('22. Oktober 2026')
  await expect(head.locator('.mdo-tb-subject')).toHaveText('Angebot Nr. 42')
  const foot = page.locator('.mdo-footblock')
  await expect(foot.locator('.mdo-tb-closing')).toHaveText('Mit freundlichen Grüßen')
  // main sends the profile's SVG as a data URL; nothing else may reach the img.
  await expect(foot.locator('img.mdo-tb-signature')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml;base64,/,
  )
  await expect(foot.locator('.mdo-tb-signer')).toHaveText('Dr. Erika Muster')
  await expect(foot.locator('.mdo-tb-attachments .mdo-tb-label')).toHaveText('Anlagen:')
  await expect(foot.locator('.mdo-tb-attachments .mdo-tb-line')).toHaveText(['Angebot', 'AGB'])
  await shot(page, 'set-preview-letter')
  // Code view shows the raw source: no head, no foot.
  await clickMenu(app, 'toggle-view')
  await expect(page.locator('.cm-editor.mdo-code')).toBeVisible()
  await expect(page.locator('.mdo-titleblock')).toHaveCount(0)
  await expect(page.locator('.mdo-footblock')).toHaveCount(0)
  await app.close()
})

test('Present shows the letter head and foot', async () => {
  const { app, page } = await openBrief()
  await inPresent(app, page, async () => {
    await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
    const editor = page.locator('.cm-editor.mdo-present')
    await expect(editor.locator('.mdo-titleblock .mdo-tb-sender')).toHaveText(
      'Dr. Erika Muster · Hauptstraße 5 · 01067 Dresden',
    )
    await expect(editor.locator('.mdo-titleblock .mdo-tb-subject')).toHaveText('Angebot Nr. 42')
    await expect(editor.locator('.mdo-footblock .mdo-tb-closing')).toHaveText(
      'Mit freundlichen Grüßen',
    )
    await expect(editor.locator('.mdo-footblock img.mdo-tb-signature')).toHaveCount(1)
    await expect(editor.locator('.mdo-footblock .mdo-tb-signer')).toHaveText('Dr. Erika Muster')
    await expect(page.locator('.cm-line.mdo-frontmatter')).toHaveCount(0)
    if (!linux) await expect.poll(() => fullScreen(app)).toBe(true)
    await shot(page, 'set-preview-present')
  })
  await app.close()
})

test('zoom 1 is the set print size; a zoom step scales font, line distance and measure together', async () => {
  const { app, page } = await openBrief()
  await expect.poll(() => bodySize(page)).toBeCloseTo(BRIEF_SIZE, 1)
  const base = await letterMeasures(page)
  expect(Math.abs(base.font - BRIEF_SIZE)).toBeLessThanOrEqual(1)
  expect(Math.abs(base.lineHeight - BRIEF_LINE)).toBeLessThanOrEqual(1)
  expect(Math.abs(base.measure - BRIEF_MEASURE)).toBeLessThanOrEqual(1)
  // One zoom step (Mod+=, here via its menu item: accelerators ignore synthetic keys) = 110 %.
  await clickMenu(app, 'zoom-in')
  await expect.poll(() => bodySize(page)).toBeCloseTo(BRIEF_SIZE * 1.1, 1)
  const zoomed = await letterMeasures(page)
  expect(Math.abs(zoomed.font - base.font * 1.1)).toBeLessThanOrEqual(1)
  expect(Math.abs(zoomed.lineHeight - base.lineHeight * 1.1)).toBeLessThanOrEqual(1)
  expect(Math.abs(zoomed.measure - base.measure * 1.1)).toBeLessThanOrEqual(1)
  await app.close()
})

test('Present multiplies by the factor and keeps the 70ch measure', async () => {
  const { app, page } = await openBrief()
  await expect.poll(() => bodySize(page)).toBeCloseTo(BRIEF_SIZE, 1)
  await inPresent(app, page, async () => {
    await expect(page.locator('body.mdo-mode-present')).toHaveCount(1)
    // Default Present factor 1.6 at Present zoom 100 %.
    await expect.poll(() => bodySize(page)).toBeCloseTo(BRIEF_SIZE * 1.6, 1)
    const widths = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller') as HTMLElement
      const probe = document.createElement('div')
      Object.assign(probe.style, { width: '70ch', position: 'absolute', visibility: 'hidden' })
      scroller.append(probe)
      const probeWidth = probe.getBoundingClientRect().width
      probe.remove()
      return {
        max: Number.parseFloat(
          getComputedStyle(document.querySelector('.cm-content') as Element).maxWidth,
        ),
        probe: probeWidth,
      }
    })
    // The set's 165 mm measure never widens Present's column.
    expect(Math.abs(widths.max - widths.probe)).toBeLessThanOrEqual(1)
  })
  await app.close()
})

test('a malicious set changes nothing outside the editor and loads nothing', async () => {
  const dirs = await makeDirs()
  await installSet(dirs, 'fx-evil')
  const note = join(dirs.notes, 'Boese.md')
  await writeFile(note, await memoNoteWith('fx-evil'))
  const { app, page } = await launch({ dirs, args: [note] })
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('127.0.0.1:9')) requests.push(r.url())
  })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  await setShown(page, 'fx-evil')
  // 30pt with !important stripped, still multiplied by --mdo-scale (1): 40px.
  await expect.poll(() => bodySize(page)).toBeCloseTo(40, 1)
  // The scoped rule is kept.
  await expect(page.locator('.cm-line', { hasText: 'Ein Absatz mit' })).toHaveCSS(
    'color',
    'rgb(1, 2, 3)',
  )
  // The note's text stays visible and the set writes no text of its own into it.
  await expect(page.locator('.cm-line', { hasText: 'Ein Absatz mit' })).toHaveCSS('opacity', '1')
  const after = await page
    .locator('.cm-line', { hasText: 'Ein Absatz mit' })
    .evaluate((el) => getComputedStyle(el, '::after').content)
  expect(after).not.toContain('Gefälscht')
  await expect(page.locator('body')).not.toHaveCSS('background-color', 'rgb(255, 0, 0)')
  const editor = page.locator('.cm-editor')
  await expect(editor).not.toHaveCSS('position', 'fixed')
  await expect(editor).toHaveCSS('background-image', 'none')
  await page.waitForTimeout(1000) // any load the style could trigger would have started
  // The listener starts after launch: the resource timings and the injected style text cover
  // what happened before it.
  const traces = await page.evaluate(() => ({
    resources: performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.includes('127.0.0.1:9')),
    styles: [...document.querySelectorAll('style')].filter((s) =>
      s.textContent?.includes('127.0.0.1'),
    ).length,
  }))
  expect(requests).toEqual([])
  expect(traces).toEqual({ resources: [], styles: 0 })
  await app.close()
})

test('a set without files and a memo-like set look like the built-in memo', async () => {
  const dirs = await makeDirs()
  await installSet(dirs, 'fx-plain')
  await installSet(dirs, 'fx-memo')
  const notes = {
    memo: join(dirs.notes, 'Builtin.md'),
    'fx-plain': join(dirs.notes, 'Plain.md'),
    'fx-memo': join(dirs.notes, 'Setmemo.md'),
  }
  await writeFile(notes.memo, await memoNoteWith(null))
  await writeFile(notes['fx-plain'], await memoNoteWith('fx-plain'))
  await writeFile(notes['fx-memo'], await memoNoteWith('fx-memo'))
  // No file name is a substring of another: a tab filter `hasText` matches substrings.
  // Header hidden on every tab: the title blocks are compared too.
  await writeFile(
    join(dirs.userData, 'session.json'),
    JSON.stringify({
      tabs: Object.values(notes).map((path) => ({ path, headerHidden: true })),
      activeIndex: 0,
      view: 'preview',
      zoom: { edit: 1, present: 1 },
    }),
  )
  const { app, page } = await launch({ dirs })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  await page.evaluate(() => document.fonts.ready)
  const look = () =>
    page.evaluate(() => {
      const size = (sel: string) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).fontSize : null
      }
      const line = [...document.querySelectorAll('.cm-line')].find((l) =>
        l.textContent?.startsWith('Ein Absatz mit'),
      )
      return {
        body: size('.cm-scroller'),
        h1: size('.cm-line.mdo-h1'),
        h2: size('.cm-line.mdo-h2'),
        line: line ? Math.round(line.getBoundingClientRect().width * 10) / 10 : null,
        title: size('.mdo-tb-title'),
        texts: [...document.querySelectorAll('.mdo-titleblock > *')].map(
          (el) => `${el.className}: ${el.textContent}`,
        ),
      }
    })
  await tabs(page).filter({ hasText: 'Builtin.md' }).click()
  await setShown(page, 'memo')
  await expect(page.locator('.mdo-tb-title')).toHaveText('Kickoff Kaffeerösterei')
  const memo = await look()
  expect(memo.body).not.toBeNull()
  expect(memo.texts.length).toBeGreaterThan(0)
  for (const [set, name] of [
    ['fx-plain', 'Plain.md'],
    ['fx-memo', 'Setmemo.md'],
  ] as const) {
    await tabs(page).filter({ hasText: name }).click()
    await setShown(page, set)
    await expect.poll(look).toEqual(memo)
  }
  await app.close()
})

test('the space advance is measured and no-break phrases and list items get their classes', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Nobreak.md')
  // The built-in memo look (no set): memo's nobreak list applies.
  // Right below the front matter, so the line is rendered (the end of the note may lie outside
  // the viewport, where CodeMirror draws nothing).
  const text = (await memoNoteWith(null)).replace(
    /^(---\n[\s\S]*?\n---\n)/,
    '$1\nDas gilt z. B. für Abstände von 5 mm.\n',
  )
  expect(text).toContain('z. B.')
  await writeFile(note, text)
  const { app, page } = await launch({ dirs, args: [note] })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  await page.evaluate(() => document.fonts.ready)
  // Source Sans: one space is 0.2em; measured on the editor element after the fonts loaded.
  const advance = () =>
    page
      .locator('.cm-editor')
      .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--mdo-space-advance'))
  await expect.poll(advance).toMatch(/^[0-9.]+em$/)
  const em = Number.parseFloat(await advance())
  expect(em).toBeGreaterThanOrEqual(0.15)
  expect(em).toBeLessThanOrEqual(0.3)
  console.log('DEBUG-NOBREAK', await page.locator('.cm-line', { hasText: 'Das gilt' }).innerHTML())
  console.log(
    'DEBUG-SRC',
    await page.evaluate(() =>
      JSON.stringify((window as unknown as { mdoDebug?: unknown }).mdoDebug ?? null),
    ),
  )
  await expect(page.locator('.cm-content .mdo-nobreak', { hasText: 'z. B.' })).toHaveCount(1)
  await expect(page.locator('.cm-content .mdo-nobreak', { hasText: '5 mm' })).toHaveCount(1)
  // the three items of the task list carry the hanging indent
  await expect(page.locator('.cm-line.mdo-list-item')).toHaveCount(3)
  await app.close()
})

test('two tabs with different sets never mix', async () => {
  const dirs = await makeDirs()
  await installSet(dirs, 'fx-brief')
  const brief = join(dirs.notes, 'Brief.md')
  const memo = join(dirs.notes, 'Kickoff.md')
  await copyFile(BRIEF, brief)
  await copyFile(MEMO_NOTE, memo)
  const { app, page } = await launch({ dirs, args: [brief, memo] })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  for (let round = 0; round < 2; round++) {
    await tabs(page).filter({ hasText: 'Brief.md' }).click()
    await setShown(page, 'fx-brief')
    await expect.poll(() => bodySize(page)).toBeCloseTo(BRIEF_SIZE, 1)
    await tabs(page).filter({ hasText: 'Kickoff.md' }).click()
    await expect(page.locator('#editor')).not.toHaveAttribute('data-mdo-set', 'fx-brief')
    await expect.poll(() => bodySize(page)).toBeCloseTo(MEMO_SIZE, 1)
  }
  await app.close()
})

test('a broken description shows one notice and the memo title block', async () => {
  const dirs = await makeDirs()
  await installSet(dirs, 'fx-broken')
  const note = join(dirs.notes, 'Kaputt.md')
  await writeFile(note, await memoNoteWith('fx-broken'))
  const { app, page } = await launch({
    dirs,
    args: [note],
    settings: { headerDefault: 'titleblock' },
  })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  await setShown(page, 'fx-broken')
  await expect(page.locator('.toast', { hasText: 'fx-broken' })).toHaveCount(1)
  await expect(page.locator('.mdo-titleblock .mdo-tb-title')).toHaveText('Kickoff Kaffeerösterei')
  // Records every toast from here on: a toast removes itself after 4 s, so a later count of 0
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
  // Focus refetches the set's files (an edited set shows without reopening): no second notice.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(1500) // deliberately: the forced refetch has no visible result
  const seen = await page.evaluate(() =>
    (window as unknown as { seenToasts: string[] }).seenToasts.filter((t) =>
      t.includes('fx-broken'),
    ),
  )
  expect(seen).toEqual([])
  await expect(page.locator('.mdo-titleblock .mdo-tb-title')).toBeVisible()
  await app.close()
})
