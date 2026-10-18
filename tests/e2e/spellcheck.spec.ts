import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { launch, makeDirs, test } from './helpers'

const FIX = join(process.cwd(), 'tests', 'e2e', 'fixtures', 'dictionaries')
type Spell = { events: string[]; params: { word: string; suggestions: string[] }[] }

async function rightClickWord(page: Page): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.type('Fehlr ')
  await page.waitForTimeout(2500)
  const line = page.locator('.cm-line', { hasText: 'Fehlr' })
  const box = await line.boundingBox()
  if (!box) throw new Error('line has no bounding box')
  await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' })
  await page.waitForTimeout(1000)
}

test('SPIKE: dictionary file names (Windows/Linux)', async () => {
  test.skip(process.platform === 'darwin', 'macOS uses the system checker')
  const requested: string[] = []
  const server = createServer((req, res) => {
    requested.push(req.url ?? '')
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const dirs = await makeDirs()
  const { app } = await launch({ dirs, args: [] })
  await app.evaluate(({ BrowserWindow }, p) => {
    const s = BrowserWindow.getAllWindows()[0]?.webContents.session
    s?.setSpellCheckerDictionaryDownloadURL(`http://127.0.0.1:${p}/`)
    s?.setSpellCheckerLanguages(['de-DE', 'en-US'])
  }, port)
  await new Promise((r) => setTimeout(r, 3000))
  console.log('REQUESTED', JSON.stringify(requested))
  expect(requested.length).toBeGreaterThan(0)
  await app.close()
  server.close()
})

test('SPIKE: offline check with pre-placed dictionaries (Windows/Linux)', async () => {
  test.skip(process.platform === 'darwin', 'macOS uses the system checker')
  const dirs = await makeDirs()
  const dd = join(dirs.userData, 'Dictionaries')
  await mkdir(dd, { recursive: true })
  for (const f of await readdir(FIX)) await copyFile(join(FIX, f), join(dd, f))
  const { app, page } = await launch({ dirs, args: [] })
  await app.evaluate(({ BrowserWindow }) => {
    const s = BrowserWindow.getAllWindows()[0]?.webContents.session
    s?.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/')
    s?.setSpellCheckerLanguages(['de-DE', 'en-US'])
  })
  await page.waitForTimeout(2000)
  await rightClickWord(page)
  const spell = await app.evaluate(() => (globalThis as unknown as { mdoSpell: Spell }).mdoSpell)
  console.log('SPELL', JSON.stringify(spell))
  expect(spell.events.filter((e) => e.startsWith('spellcheck-dictionary-download-begin'))).toEqual(
    [],
  )
  const last = spell.params.at(-1)
  expect(last?.word).toBe('Fehlr')
  expect(last?.suggestions).toContain('Fehler')
  await app.close()
})

test('SPIKE: native right click (macOS)', async () => {
  test.skip(process.platform !== 'darwin', 'macOS only')
  const { app, page } = await launch({ args: [] })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.session.setSpellCheckerLanguages(['de-DE'])
  })
  await rightClickWord(page)
  const spell = await app.evaluate(() => (globalThis as unknown as { mdoSpell: Spell }).mdoSpell)
  console.log('SPELL', JSON.stringify(spell))
  const last = spell.params.at(-1)
  expect(last?.word).toBe('Fehlr')
  expect(last?.suggestions).toContain('Fehler')
  await app.close()
})
