import { copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { clickMenu, launch, makeDirs, test } from './helpers'

// Diagnostic only (not merged): logs the Windows menu bar state after each step.
const state = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, Menu }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return {
      visible: w?.isMenuBarVisible(),
      autoHide: w?.isMenuBarAutoHide(),
      fullScreen: w?.isFullScreen(),
      appMenu: !!Menu.getApplicationMenu(),
    }
  })

test('menu bar probe', async () => {
  test.skip(process.platform !== 'win32', 'Windows only')
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(join(__dirname, '..', 'fixtures', 'preview.md'), note)
  const second = join(dirs.notes, 'Zwei.md')
  await writeFile(second, '# Zwei\n\nText\n')
  const { app, page } = await launch({ dirs, args: [note] })
  const log: string[] = []
  const step = async (name: string) => log.push(`${name}: ${JSON.stringify(await state(app))}`)
  await page.locator('.cm-editor').waitFor()
  await step('launched')
  await page.waitForTimeout(2000)
  await step('after 2 s')
  for (const id of ['toggle-view', 'toggle-view', 'toggle-outline', 'toggle-toolbar']) {
    await clickMenu(app, id)
    await page.waitForTimeout(500)
    await step(id)
  }
  await clickMenu(app, 'toggle-present')
  await page.waitForTimeout(1500)
  await step('present on')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)
  await step('present off (Esc)')
  await clickMenu(app, 'toggle-present')
  await page.waitForTimeout(1500)
  await clickMenu(app, 'toggle-present')
  await page.waitForTimeout(1500)
  await step('present on/off (menu)')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.focus())
  await step('end')
  console.log(`MENU-PROBE\n${log.join('\n')}`)
  await app.close()
})
