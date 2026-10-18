import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { clickMenu, launch, makeDirs, test } from './helpers'

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
