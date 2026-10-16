import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test as base,
  type ElectronApplication,
  _electron as electron,
  type Page,
} from '@playwright/test'

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

export interface Dirs {
  root: string
  notes: string
  userData: string
  /** Empty user template folder (MDO_TEMPLATES): never the real ~/Documents. */
  templates: string
}

const launched: ElectronApplication[] = []

/**
 * Drop-in replacement for Playwright's `test`: every app started via `launch` is traced,
 * and the trace is written to test-results/traces/<test title>.zip only when the test failed.
 * (The built-in `use.trace` does not apply to apps started with `_electron.launch`.)
 */
export const test = base.extend<{ electronTraces: undefined }>({
  electronTraces: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructuring pattern here
    async ({}, use, testInfo) => {
      launched.length = 0
      await use(undefined)
      const failed = testInfo.status !== testInfo.expectedStatus
      const name = testInfo.titlePath
        .slice(1)
        .join(' ')
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 120)
      let index = 0
      for (const app of launched.splice(0)) {
        const path = join('test-results', 'traces', `${name}${index++ ? `-${index}` : ''}.zip`)
        try {
          await app.context().tracing.stop(failed ? { path } : undefined)
        } catch {
          // app already closed by the test: nothing to stop
        }
      }
    },
    { auto: true },
  ],
})

export interface Launched extends Dirs {
  app: ElectronApplication
  page: Page
}

/**
 * Notes live in a folder with spaces; realpath expands Windows 8.3 names (RUNNER~1). On CI the
 * folder is in RUNNER_TEMP: on the Windows runner that is the checkout's drive (D:), the drive of
 * the pipeline's Typst root, while the default temp folder is on C:.
 */
export async function makeDirs(): Promise<Dirs> {
  const base = process.env.RUNNER_TEMP || tmpdir()
  const root = await realpath(await mkdtemp(join(base, 'mdo-e2e-')))
  const notes = join(root, 'Notizen mit Leerzeichen')
  const userData = join(root, 'user-data')
  const templates = join(root, 'Eigene Vorlagen')
  await mkdir(notes, { recursive: true })
  await mkdir(userData, { recursive: true })
  await mkdir(templates, { recursive: true })
  return { root, notes, userData, templates }
}

export async function launch(
  opts: {
    args?: string[]
    settings?: Record<string, unknown>
    env?: Record<string, string>
    dirs?: Dirs
  } = {},
): Promise<Launched> {
  const dirs = opts.dirs ?? (await makeDirs())
  await writeFile(
    join(dirs.userData, 'settings.json'),
    // Never the real ~/Documents/Markdown Office/Snippets: a folder in the temp root (not created).
    JSON.stringify({
      defaultFolder: dirs.notes,
      snippetFolder: join(dirs.root, 'Snippets'),
      ...opts.settings,
    }),
  )
  // Exports run the real bundled pipeline (dev layout): no PDF viewer, no real user sets.
  const env = {
    ...process.env,
    MDO_USER_DATA: dirs.userData,
    MDO_NO_OPEN: '1',
    MDO_TEMPLATES: dirs.templates,
    ...opts.env,
  } as Record<string, string>
  const app = await electron.launch({ args: ['.', ...(opts.args ?? [])], env })
  await app.context().tracing.start({ screenshots: true, snapshots: true })
  launched.push(app)
  const page = await app.firstWindow()
  await page.locator('.cm-editor').waitFor()
  await page.locator('[data-testid=tab]').first().waitFor()
  return { ...dirs, app, page }
}

/** Menu accelerators do not fire for synthetic key events, so click the item. */
export async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) throw new Error(`menu item ${menuId} missing`)
    item.click()
  }, id)
}

export async function waitForFile(
  path: string,
  accept: (b: Buffer) => boolean = () => true,
  timeoutMs = 5000,
): Promise<Buffer> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      const b = await readFile(path)
      if (accept(b)) return b
    } catch {
      // not there yet
    }
    if (Date.now() > end) throw new Error(`timeout waiting for ${path}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press(`${MOD}+End`)
  await page.keyboard.type(text)
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: join('test-results', 'screenshots', `${process.platform}-${name}.png`),
  })
}
