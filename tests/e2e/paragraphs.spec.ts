import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test } from './helpers'

const MEMO_NOTE = join(__dirname, '..', 'fixtures', 'preview.md')
const linux = process.platform === 'linux'

// Long enough for several lines at memo's 145 mm, with long compounds, so a justified,
// hyphenated set (memo) breaks at least one word.
const PARAGRAPH =
  'Die Vereinbarung über die Zusammenarbeit im Bereich der Qualitätssicherung verpflichtet ' +
  'beide Vertragsparteien, sämtliche Abweichungen unverzüglich schriftlich zu dokumentieren, ' +
  'die Ursachenanalyse innerhalb von zehn Arbeitstagen abzuschließen und die Wirksamkeit der ' +
  'Korrekturmaßnahmen durch geeignete Stichprobenprüfungen nachzuweisen. Darüber hinaus ' +
  'verpflichten sich die Beteiligten zur Einhaltung der Datenschutzbestimmungen, zur ' +
  'Geheimhaltung vertraulicher Geschäftsinformationen und zur regelmäßigen Überprüfung der ' +
  'Lieferantenbewertungen einschließlich der Gewährleistungsverpflichtungen.'

/** The fixture note with `template:` (or the built-in memo) and the paragraph below its header. */
async function noteWith(set: string | null): Promise<string> {
  const text = await readFile(MEMO_NOTE, 'utf8')
  const withSet = set === null ? text : text.replace(/^---\n/, `---\ntemplate: ${set}\n`)
  // Right below the front matter, so the paragraph is drawn (CodeMirror draws the viewport).
  return withSet.replace(/^(---\n[\s\S]*?\n---\n)/, `$1\n${PARAGRAPH}\n`)
}

async function open(set: string | null) {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Absatz.md')
  await writeFile(note, await noteWith(set))
  const launched = await launch({ dirs, args: [note] })
  await launched.page.locator('.cm-editor.mdo-preview').waitFor()
  if (set) await expect(launched.page.locator('#editor')).toHaveAttribute('data-mdo-set', set)
  await launched.page.evaluate(() => document.fonts.ready)
  return launched
}

const paragraph = (page: Page) =>
  page.locator('.cm-line', { hasText: 'Die Vereinbarung über die Zusammenarbeit' })

/**
 * The width of each visual line of the set paragraph (left of its first glyph to right of its
 * last, the hyphen included, the trailing space not) and the width the text is set in: the
 * line's content box minus the one space advance theme.css adds for the space before a break.
 */
const rows = (page: Page) =>
  paragraph(page).evaluate((line) => {
    const s = getComputedStyle(line)
    const editor = line.closest('.cm-editor') as HTMLElement
    const content = line.closest('.cm-content') as HTMLElement
    const em = Number.parseFloat(editor.style.getPropertyValue('--mdo-space-advance') || '0.2')
    const measure =
      line.clientWidth -
      Number.parseFloat(s.paddingLeft) -
      Number.parseFloat(s.paddingRight) -
      em * Number.parseFloat(getComputedStyle(content).fontSize)
    const byRow = new Map<number, { left: number; right: number }>()
    const range = document.createRange()
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text
      for (let k = 0; k < t.data.length; k++) {
        if (/\s/.test(t.data.charAt(k))) continue
        range.setStart(t, k)
        range.setEnd(t, k + 1)
        const r = range.getBoundingClientRect()
        const top = Math.round(r.top)
        const row = byRow.get(top) ?? { left: r.left, right: r.right }
        byRow.set(top, { left: Math.min(row.left, r.left), right: Math.max(row.right, r.right) })
      }
    }
    const widths = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r.right - r.left)
    return { measure, widths }
  })

/** Leaves Present the way present.spec does: toggled off, then out of the real fullscreen. */
async function leavePresent(app: ElectronApplication, page: Page): Promise<void> {
  if ((await page.locator('body.mdo-mode-present').count()) > 0) {
    await clickMenu(app, 'toggle-present')
  }
  await expect(page.locator('body.mdo-mode-present')).toHaveCount(0)
  if (!linux) {
    const full = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false)
    await expect.poll(full, { timeout: 10_000 }).toBe(false)
  }
}

test('memo sets a justified paragraph like the PDF: breaks, hyphens, full lines', async () => {
  const { app, page } = await open(null)
  const par = paragraph(page)
  await expect(par).toHaveClass(/mdo-par-set/)
  expect(await par.locator('br.mdo-par-break').count()).toBeGreaterThanOrEqual(1)
  expect(await par.locator('.mdo-par-hyphen').count()).toBeGreaterThanOrEqual(1)
  const { measure, widths } = await rows(page)
  expect(widths.length).toBeGreaterThan(2)
  // Justified: every line but the last fills the measure exactly (the engine's word spacing).
  for (const w of widths.slice(0, -1)) expect(Math.abs(w - measure)).toBeLessThanOrEqual(1)
  await shot(page, 'paragraphs-memo')

  // The cursor's paragraph goes back to the editor's own wrapping; leaving sets it again.
  await par.click()
  await expect(par.locator('br.mdo-par-break')).toHaveCount(0)
  await expect(par).not.toHaveClass(/mdo-par-set/)
  await page.locator('.cm-line.mdo-h1').click()
  await expect(par).toHaveClass(/mdo-par-set/)

  // Present sets it too, in Present's own column.
  await clickMenu(app, 'toggle-present')
  let passed = false
  try {
    const present = page.locator('.cm-editor.mdo-present .cm-line.mdo-par-set', {
      hasText: 'Die Vereinbarung über die Zusammenarbeit',
    })
    await expect(present).toHaveCount(1)
    expect(await present.locator('br.mdo-par-break').count()).toBeGreaterThanOrEqual(1)
    passed = true
  } finally {
    // Closing an app in a real fullscreen Space is the known CI launch-hang trigger.
    if (passed) await leavePresent(app, page)
    else await leavePresent(app, page).catch(() => {})
  }
  await app.close()
})

test('din5008a (left aligned) sets the paragraph without hyphenation', async () => {
  const { app, page } = await open('din5008a')
  const par = paragraph(page)
  await expect(par).toHaveClass(/mdo-par-set/)
  expect(await par.locator('br.mdo-par-break').count()).toBeGreaterThanOrEqual(1)
  await expect(page.locator('.mdo-par-hyphen')).toHaveCount(0)
  await app.close()
})
