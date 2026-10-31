import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test, waitForFile } from './helpers'

const dialog = (page: Page) => page.getByTestId('validate-dialog')
const rows = (page: Page) => page.getByTestId('validate-row')

/** The bundled memo set's header (build/pipeline-dev/sets/memo/memo.header.md). */
const MEMO_HEADER = [
  '---',
  '# Alle Schlüssel und Regeln: README von Markdown Office, Abschnitt „Frontmatter“',
  'template: memo          # Vorlagen-Set oder .typ-Datei',
  'title: ""               # Titelblock, Kopfzeile, PDF-Titel',
  'subtitle: ""            # unter dem Titel',
  'toptitle: ""            # klein über dem Titel',
  'author: ""              # „Datum · Autor“; mehrere: [Anna, Ben]',
  'date: ""                # 2026-10-13 oder 13.10.2026; leer: kein Datum',
  'isodate_praefix: true   # ISO-Datum vor dem Dateinamen',
  'lang: de                # de oder en',
  'toc: auto               # Inhaltsverzeichnis: auto, true, false',
  'h1_break: auto          # Kapitel auf neuer Seite: auto = wie toc',
  'header: auto            # auto: Kapitel; Text: fest; "": nur Linie; false: keine',
  'print_filename: true    # Angabe links in der Fußzeile',
  'watermark: ""           # z. B. ENTWURF',
  'logo: ""                # .svg/.png/.jpg; leer: kein Logo',
  'logo-height: 13mm       # maximale Logohöhe, bis 25mm',
  'embed_source: true      # Markdown-Quelle ins PDF einbetten',
  'hard_breaks: true       # jede Zeile bleibt eine Zeile',
  '---',
  '',
].join('\n')

const LANG = 'lang: de                # de oder en\n'

test('the bundled memo header is the fixture this spec copies', async () => {
  const bundled = await readFile(join('build', 'pipeline-dev', 'sets', 'memo', 'memo.header.md'))
  expect(bundled.toString('utf8')).toBe(MEMO_HEADER)
})

test('YAML prüfen: two fixes and the missing key, one undo step restores the bytes', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Memo.md')
  const original = `${MEMO_HEADER.replace(LANG, '')
    .replace('toc: auto     ', 'toc: ja       ')
    .replace('date: ""      ', 'date: 20.10.26')}\nText\n`
  await writeFile(note, original)
  const { app, page } = await launch({ dirs, args: [note] })
  await expect(page.locator('.cm-content')).toContainText('toc: ja')

  await clickMenu(app, 'validate-yaml')
  await expect(dialog(page)).toBeVisible()
  await expect(rows(page)).toHaveCount(2)
  const date = rows(page).filter({ hasText: 'date' })
  const toc = rows(page).filter({ hasText: 'toc' })
  await expect(date).toContainText('→ 2026-10-20')
  await expect(toc).toContainText('→ true')
  await expect(date.locator('input[type=checkbox]')).toBeChecked()
  await expect(toc.locator('input[type=checkbox]')).toBeChecked()
  const missing = page.getByTestId('validate-missing')
  await expect(missing).toContainText('Fehlende ergänzen (1)')
  await expect(missing).toContainText('lang')
  const addMissing = missing.locator('input[type=checkbox]')
  await expect(addMissing).not.toBeChecked()
  await addMissing.check()
  await shot(page, 'validate-dialog')
  await page.getByTestId('validate-apply').click()
  await expect(dialog(page)).toHaveCount(0)

  const expected = `${MEMO_HEADER.replace(LANG, '')
    .replace('date: ""        ', 'date: 2026-10-20')
    .replace('toc: auto', 'toc: true')
    .replace(/---\n$/, `${LANG}---\n`)}\nText\n`
  await waitForFile(note, (b) => b.toString('utf8') === expected)

  // One undo step takes back every fix and the added key.
  await clickMenu(app, 'undo')
  await waitForFile(note, (b) => b.toString('utf8') === original)
  await app.close()
})

test('YAML prüfen: a clean note gets a toast, no dialog', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Sauber.md')
  await writeFile(note, `${MEMO_HEADER}\nText\n`)
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'validate-yaml')
  await expect(page.locator('.toast')).toContainText('YAML in Ordnung')
  await expect(dialog(page)).toHaveCount(0)
  await app.close()
})

test('YAML prüfen is refused in a YAML profile tab', async () => {
  const dirs = await makeDirs()
  const yaml = join(dirs.notes, 'kanzlei.yaml')
  await writeFile(yaml, 'name: Kanzlei\n')
  const { app, page } = await launch({ dirs, args: [yaml] })
  await expect(page.locator('[data-testid=tab].active .tab-label')).toHaveText('kanzlei.yaml')
  await clickMenu(app, 'validate-yaml')
  await expect(page.locator('.toast')).toContainText('Nur in Markdown-Notizen verfügbar.')
  await expect(dialog(page)).toHaveCount(0)
  await app.close()
})

test('YAML prüfen: a broken set schema gives a neutral notice, the dialog still opens', async () => {
  const dirs = await makeDirs()
  const set = join(dirs.templates, 'eigen')
  await mkdir(set)
  await writeFile(join(set, 'eigen.typ'), '// own set\n')
  await writeFile(join(set, 'eigen.header.md'), '---\ntemplate: eigen\ntitle: ""\n---\n')
  await writeFile(join(set, 'eigen.schema.yaml'), 'schema: 1\nkeys:\n  x-a: { type: farbe }\n')
  const note = join(dirs.notes, 'Eigen.md')
  await writeFile(note, '---\ntemplate: eigen\ntitle: ""\ntoc: ja\n---\n\nText\n')
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'validate-yaml')
  await expect(dialog(page)).toBeVisible()
  await expect(page.getByTestId('validate-notice')).toHaveText(
    'Das Schema des Sets eigen ist fehlerhaft; geprüft wird nur gegen die Pipeline-Regeln.',
  )
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page)).toContainText('toc')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await app.close()
})
