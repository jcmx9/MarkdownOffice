import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app, net } from 'electron'
import { AppUpdater, installLocation } from './app-update'
import { argsFromArgv, HELP_TEXT, parseCli } from './cli'
import { AppContext } from './context'
import { handleFontProtocol, registerFontScheme } from './font-protocol'
import { registerIpc } from './ipc'
import { pipelinePaths } from './pipeline'
import { enableExistingTextSpellcheck } from './spellcheck/features'
import { mdoBaseDir } from './templates'
import { userDataOverride } from './user-data'

// Must run before requestSingleInstanceLock: the lock lives in userData.
const userData = userDataOverride(process.env, app.isPackaged, app.getPath('appData'))
if (userData) app.setPath('userData', userData)
registerFontScheme()
// Before ready: lets Chromium check the text of an opened note, not only typed words.
enableExistingTextSpellcheck(app.commandLine)

const cli = parseCli(argsFromArgv(process.argv, app.isPackaged), process.cwd())

if (cli.kind === 'version') {
  process.stdout.write(`Markdown Office ${app.getVersion()}\n`)
  app.exit(0)
} else if (cli.kind === 'help') {
  process.stdout.write(HELP_TEXT)
  app.exit(0)
} else if (!app.requestSingleInstanceLock({ paths: cli.paths })) {
  app.exit(0)
} else {
  run(cli.paths)
}

function isPathsData(data: unknown): data is { paths: string[] } {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { paths?: unknown }).paths)
  )
}

/** The app's folder; documents only to find a folder kept from earlier versions. */
function baseDir(): string {
  let documents = ''
  try {
    documents = app.getPath('documents')
  } catch {
    // No documents folder (service accounts): only the home folder counts.
  }
  return mdoBaseDir(app.getPath('home'), documents, existsSync)
}

function run(initial: string[]): void {
  const pipeline = {
    paths: pipelinePaths(app.isPackaged, process.resourcesPath, app.getAppPath()),
    version: app.getVersion(),
  }
  const ctx = new AppContext(app.getPath('userData'), baseDir(), pipeline)
  // openPaths canonicalises every path before allowing it or sending it to the renderer.
  const open = (paths: readonly string[]) => void ctx.openPaths(paths).catch(() => undefined)
  open(initial)

  app.on('open-file', (event, path) => {
    event.preventDefault()
    open([path])
  })
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    open(isPathsData(data) ? data.paths.filter((p): p is string => typeof p === 'string') : [])
    ctx.focus()
  })
  app.on('before-quit', () => ctx.markQuitting())
  // Only now is the quit certain (no note kept it open): the update helper may start.
  app.on('will-quit', () => ctx.appUpdate?.onWillQuit())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (ctx.isInitialized() && !ctx.window) ctx.createWindow()
  })

  void app.whenReady().then(async () => {
    // macOS shows "Version <app> (<build>)"; both are the package version, so drop the build.
    // Copyright, licence and the no-warranty note are the "Appropriate Legal Notices" AGPL
    // §5 d) asks every interactive user interface to display.
    app.setAboutPanelOptions({
      applicationVersion: app.getVersion(),
      version: '',
      copyright: 'Copyright © 2026 jcmx9',
      credits:
        'Freie Software unter der GNU Affero General Public License, Version 3 oder später ' +
        '(AGPL-3.0-or-later), ohne jede Gewährleistung. Quelltext und Lizenz: ' +
        'github.com/jcmx9/MarkdownOffice',
      website: 'https://github.com/jcmx9/MarkdownOffice',
    })
    await ctx.load()
    ctx.appUpdate = appUpdater(() => ctx.settings.appUpdateCheck)
    // Before handleFontProtocol: protocol.handle creates the default session, and with it
    // Chromium's spellchecker, which must find the dictionaries and the dead download URL.
    // A failure only logs: the window and its own guard (SpellcheckController) still start.
    await ctx
      .prepareSpellcheck()
      .catch((err) => console.warn('spellcheck: preparation at start failed', err))
    handleFontProtocol(pipeline.paths.fonts)
    registerIpc(ctx)
    ctx.markInitialized()
    if (!ctx.window) ctx.createWindow()
  })
}

/** The app update (app-update.ts) with the real network, files and processes. */
function appUpdater(enabled: () => boolean): AppUpdater {
  const userData = app.getPath('userData')
  const readText = (p: string) => fs.readFile(p, 'utf8').catch(() => null)
  const exists = (p: string) =>
    fs.access(p).then(
      () => true,
      () => false,
    )
  return new AppUpdater({
    statePath: join(userData, 'app-update.json'),
    logPath: join(userData, 'update.log'),
    version: app.getVersion(),
    packaged: app.isPackaged,
    enabled,
    fetch: (url, init) =>
      net.fetch(url, { headers: { 'User-Agent': 'Markdown Office' }, signal: init.signal }),
    location: () =>
      installLocation({
        platform: process.platform,
        execPath: process.execPath,
        home: app.getPath('home'),
        xdgDataHome: process.env.XDG_DATA_HOME,
        read: readText,
        exists,
      }),
    now: () => Date.now(),
    tempDir: () => fs.mkdtemp(join(app.getPath('temp'), 'mdo-update-')),
    writeFile: (p, data) => fs.writeFile(p, data, { mode: 0o600 }),
    spawn: (command, args, mdoHome) => {
      // The bootstrap installs where this app lives: MDO_HOME only when that is not its default.
      const env = { ...process.env }
      delete env.MDO_HOME
      if (mdoHome) env.MDO_HOME = mdoHome
      spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, env }).unref()
    },
    pid: process.pid,
    quit: () => app.quit(),
  })
}
