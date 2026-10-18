import { app } from 'electron'
import { argsFromArgv, HELP_TEXT, parseCli } from './cli'
import { AppContext } from './context'
import { handleFontProtocol, registerFontScheme } from './font-protocol'
import { registerIpc } from './ipc'
import { pipelinePaths } from './pipeline'
import { userDataOverride } from './user-data'

// Must run before requestSingleInstanceLock: the lock lives in userData.
const userData = userDataOverride(process.env, app.isPackaged, app.getPath('appData'))
if (userData) app.setPath('userData', userData)
registerFontScheme()

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

function run(initial: string[]): void {
  const pipeline = {
    paths: pipelinePaths(app.isPackaged, process.resourcesPath, app.getAppPath()),
    version: app.getVersion(),
  }
  const ctx = new AppContext(app.getPath('userData'), app.getPath('documents'), pipeline)
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
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (ctx.isInitialized() && !ctx.window) ctx.createWindow()
  })

  void app.whenReady().then(async () => {
    // macOS shows "Version <app> (<build>)"; both are the package version, so drop the build.
    app.setAboutPanelOptions({ applicationVersion: app.getVersion(), version: '' })
    await ctx.load()
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
