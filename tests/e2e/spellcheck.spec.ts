import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { clickMenu, launch, makeDirs, test, waitForFile } from './helpers'

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
  const word = page.locator('.cm-line', { hasText: 'Fehlr' })
  const box = await word.boundingBox()
  if (!box) throw new Error('no line box')
  // The checker marks asynchronously: retry the right click until suggestions arrive.
  await expect
    .poll(
      async () => {
        await page.mouse.click(box.x + 40, box.y + box.height / 2, { button: 'right' })
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
  const saved = await waitForFile(note, (b) => b.toString('utf8') === 'Ein Fehler hier.\n')
  expect(saved.toString('utf8')).toBe('Ein Fehler hier.\n')
  await app.close()
})

// Independent of real dictionaries (all OSes): drives the IPC -> replaceWordAt -> autosave path.
test('a spell-replace message from main fixes exactly that word on disk', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Ersetzen.md')
  await writeFile(note, 'Ein Fehlr hier.\n')
  const { app, page } = await launch({ dirs, args: [note], env: { MDO_E2E_MENUS: '1' } })
  const line = page.locator('.cm-line', { hasText: 'Fehlr' })
  const box = await line.boundingBox()
  if (!box) throw new Error('no line box')
  // Right click records a menu (and proves the tab/editor context menu path does not throw).
  await page.mouse.click(box.x + 40, box.y + box.height / 2, { button: 'right' })
  const x = box.x + 40
  const y = box.y + box.height / 2
  await app.evaluate(
    ({ BrowserWindow }, m) =>
      BrowserWindow.getAllWindows()[0]?.webContents.send('mdo:spell-replace', m),
    { word: 'Fehlr', replacement: 'Fehler', x, y },
  )
  const saved = await waitForFile(note, (b) => b.toString('utf8') === 'Ein Fehler hier.\n')
  expect(saved.toString('utf8')).toBe('Ein Fehler hier.\n')
  await app.close()
})
