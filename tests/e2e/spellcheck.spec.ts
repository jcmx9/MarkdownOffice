import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page } from '@playwright/test'
import { clickMenu, launch, makeDirs, test, waitForFile } from './helpers'

/**
 * Centre of `word` in the editor, measured with a DOM Range over the exact text after the
 * fonts have loaded: a box measured once before the fonts settle can point at another word
 * after the reflow (the correction is then refused and the test times out).
 */
async function wordCentre(page: Page, word: string): Promise<{ x: number; y: number }> {
  await page.evaluate(() => document.fonts.ready)
  return page.evaluate((w) => {
    const root = document.querySelector('.cm-content')
    if (!root) throw new Error('no editor content')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent?.indexOf(w) ?? -1
      if (i < 0) continue
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + w.length)
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    }
    throw new Error(`word ${w} not in the editor`)
  }, word)
}

type SpellEvents = { event: string; code: string }[]
const spellEvents = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { mdoE2eSpell?: SpellEvents }).mdoE2eSpell ?? [])
const spellLanguages = (app: ElectronApplication) =>
  app.evaluate(({ session }) => session.defaultSession.getSpellCheckerLanguages())

test('spellcheck follows the switch and Present; never in code', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Rechtschreibung.md')
  await writeFile(note, '---\ntitle: Tset\n---\n\nTxet\n\n```\nkonst\n```\n')
  const { app, page } = await launch({ dirs, args: [note] })
  const content = page.locator('.cm-content')
  await expect(content).toHaveAttribute('spellcheck', 'true')
  await expect(page.locator('.cm-line[spellcheck="false"]', { hasText: 'konst' })).toHaveCount(1)
  await clickMenu(app, 'toggle-spellcheck')
  await expect(content).toHaveAttribute('spellcheck', 'false')
  await clickMenu(app, 'toggle-spellcheck')
  await expect(content).toHaveAttribute('spellcheck', 'true')
  await clickMenu(app, 'toggle-present')
  await expect(content).toHaveAttribute('spellcheck', 'false')
  await clickMenu(app, 'toggle-present')
  await expect(content).toHaveAttribute('spellcheck', 'true')
  await app.close()
})

type Recorded = { label?: string; click?: () => void }[][]

// Real suggestions need a dictionary: macOS CI runners lack a German system dictionary, while
// Windows/Linux use the bundled .bdic files (dev layout: `npm run assets`).
test('right click on a misspelled word offers suggestions; a click fixes exactly that word on disk', async () => {
  test.skip(process.platform === 'darwin', 'macOS CI runners have no German system dictionary')
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Fehler.md')
  // lang: de makes the real language path pick de-DE, whatever the runner's system language is.
  await writeFile(note, '---\nlang: de\n---\n\nEin Fehlr hier.\n')
  const { app, page } = await launch({ dirs, args: [note], env: { MDO_E2E_MENUS: '1' } })
  // The real language path (lang: de -> renderer -> main) must have activated checking.
  await expect.poll(() => spellLanguages(app)).toEqual(['de-DE'])
  expect(await app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled())).toBe(
    true,
  )
  // The checker marks asynchronously: retry the right click until suggestions arrive. The
  // word is located again each time, so a late reflow cannot move the click off it.
  await expect
    .poll(
      async () => {
        const { x, y } = await wordCentre(page, 'Fehlr')
        await page.mouse.click(x, y, { button: 'right' })
        return app.evaluate(() => {
          const m = (globalThis as { mdoE2eMenus?: Recorded }).mdoE2eMenus ?? []
          return m.at(-1)?.map((i) => i.label ?? '') ?? []
        })
      },
      { timeout: 15000 },
    )
    .toContain('Fehler')
  await app.evaluate(() => {
    const m = (globalThis as { mdoE2eMenus?: Recorded }).mdoE2eMenus ?? []
    m.at(-1)
      ?.find((i) => i.label === 'Fehler')
      ?.click?.()
  })
  const saved = await waitForFile(
    note,
    (b) => b.toString('utf8') === '---\nlang: de\n---\n\nEin Fehler hier.\n',
    10_000,
  )
  expect(saved.toString('utf8')).toBe('---\nlang: de\n---\n\nEin Fehler hier.\n')
  await app.close()
})

// Chromium checks the text already in an editable only after a user-gesture focus unless the
// app lifts that restriction (src/main/spellcheck/features.ts): the editor is focused by the
// app, so without it an opened note's misspellings were never marked, only typed words. No
// typing here. English, because every runner has an English dictionary (macOS: the system's).
test('a misspelling already in an opened note is marked without typing', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Vorhanden.md')
  await writeFile(note, '---\nlang: en\n---\n\nThis sentense is wrong.\n')
  const { app, page } = await launch({
    dirs,
    args: [note],
    env: { MDO_E2E_MENUS: '1' },
    settings: { dictionaryAutoUpdate: false },
  })
  await expect
    .poll(
      async () => {
        const { x, y } = await wordCentre(page, 'sentense')
        await page.mouse.click(x, y, { button: 'right' })
        return app.evaluate(() => {
          const m = (globalThis as { mdoE2eMenus?: Recorded }).mdoE2eMenus ?? []
          return m.at(-1)?.map((i) => i.label ?? '') ?? []
        })
      },
      { timeout: 15000 },
    )
    .toContain('Zum Wörterbuch hinzufügen')
  await app.close()
})

// Independent of real dictionaries (all OSes): drives the IPC -> replaceWordAt -> autosave path.
test('a spell-replace message from main fixes exactly that word on disk', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Ersetzen.md')
  await writeFile(note, 'Ein Fehlr hier.\n')
  const { app, page } = await launch({ dirs, args: [note], env: { MDO_E2E_MENUS: '1' } })
  const { x, y } = await wordCentre(page, 'Fehlr')
  // Right click records a menu (and proves the tab/editor context menu path does not throw).
  await page.mouse.click(x, y, { button: 'right' })
  await app.evaluate(
    ({ BrowserWindow }, m) =>
      BrowserWindow.getAllWindows()[0]?.webContents.send('mdo:spell-replace', m),
    { word: 'Fehlr', replacement: 'Fehler', x, y },
  )
  const saved = await waitForFile(note, (b) => b.toString('utf8') === 'Ein Fehler hier.\n', 10_000)
  expect(saved.toString('utf8')).toBe('Ein Fehler hier.\n')
  await app.close()
})

/**
 * Pins the dictionary file names against the running Electron (spec, Risks): Chromium starts a
 * download (blocked by the dead URL) only when the file it expects is missing. Any download
 * event while languages are set through the real path (start, no lang:, lang: en, lang: de)
 * means an Electron update renamed a dictionary, and this test fails.
 */
async function expectNoDownloads(app: ElectronApplication, page: Page): Promise<void> {
  const tabs = page.locator('[data-testid=tab]')
  for (const [index, want] of [
    [1, ['en-US']],
    [2, ['de-DE']],
  ] as const) {
    await tabs.nth(index).click()
    await expect.poll(() => spellLanguages(app), { timeout: 10_000 }).toEqual(want)
  }
  // Wait until Chromium has loaded both dictionaries (or 10 s), then nothing may have failed.
  const end = Date.now() + 10_000
  while (Date.now() < end) {
    const loaded = new Set(
      (await spellEvents(app)).filter((e) => e.event === 'initialized').map((e) => e.code),
    )
    if (loaded.size >= 2) break
    await new Promise((r) => setTimeout(r, 200))
  }
  expect((await spellEvents(app)).filter((e) => e.event !== 'initialized')).toEqual([])
}

async function languageNotes(notes: string): Promise<string[]> {
  const files: [string, string][] = [
    ['Ohne.md', 'Text ohne Sprache.\n'],
    ['Englisch.md', '---\nlang: en\n---\n\nSome text.\n'],
    ['Deutsch.md', '---\nlang: de\n---\n\nEin Text.\n'],
  ]
  for (const [name, text] of files) await writeFile(join(notes, name), text)
  return files.map(([name]) => join(notes, name))
}

test('no dictionary download attempt: file names match the running Electron', async () => {
  test.skip(process.platform === 'darwin', 'macOS uses the system spellchecker (no .bdic files)')
  const dirs = await makeDirs()
  const { app, page } = await launch({
    dirs,
    args: await languageNotes(dirs.notes),
    env: { MDO_E2E_SPELL: '1' },
    settings: { dictionaryAutoUpdate: false },
  })
  await expectNoDownloads(app, page)
  await app.close()
})

// First start in a language without a bundled dictionary: Chromium's default language list
// is the app locale (fr); the start languages must be set before it tries to load (download)
// it. LANG only steers the locale on Linux.
test('first start with a French locale makes no download attempt', async () => {
  test.skip(process.platform !== 'linux', 'the locale follows LANG on Linux only')
  const dirs = await makeDirs()
  const { app, page } = await launch({
    dirs,
    args: await languageNotes(dirs.notes),
    env: { MDO_E2E_SPELL: '1', LANG: 'fr_FR.UTF-8', LANGUAGE: 'fr_FR', LC_ALL: 'fr_FR.UTF-8' },
    settings: { dictionaryAutoUpdate: false },
  })
  await expectNoDownloads(app, page)
  await app.close()
})

// The „Wörterbuch fehlt – laden?“ banner must never reach the shared screen in Present, nor
// appear while checking is off. Needs the Hunspell path (lang: fr is not bundled).
test('the missing-dictionary banner stays out of Present and off', async () => {
  test.skip(process.platform === 'darwin', 'macOS uses the system spellchecker (no notice)')
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Franzoesisch.md')
  await writeFile(note, '---\nlang: fr\n---\n\nBonjour.\n')
  const banner = (page: Page) => page.locator('.banner', { hasText: 'Französisch' })

  const first = await launch({ dirs, args: [note], settings: { dictionaryAutoUpdate: false } })
  await expect(banner(first.page)).toHaveCount(1)
  await clickMenu(first.app, 'toggle-present')
  await expect(first.page.locator('.banner')).toHaveCount(0)
  // Leaving Present reports the language again; the dismissed notice must come back.
  await clickMenu(first.app, 'toggle-present')
  await expect(banner(first.page)).toHaveCount(1)
  await first.app.close()

  const off = await launch({
    dirs,
    args: [note],
    settings: { dictionaryAutoUpdate: false, spellcheck: false },
  })
  // Main has answered once it applied the fallback languages; no banner while off.
  await expect.poll(() => spellLanguages(off.app)).toEqual(['de-DE', 'en-US'])
  await off.page.waitForTimeout(500)
  await expect(off.page.locator('.banner')).toHaveCount(0)
  await clickMenu(off.app, 'toggle-spellcheck')
  await expect(banner(off.page)).toHaveCount(1)
  await off.app.close()
})
