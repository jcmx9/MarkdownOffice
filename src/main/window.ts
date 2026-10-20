import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { fakeFullScreen } from './fullscreen'
import { SPELLCHECK_BLINK_FEATURES } from './spellcheck/features'

/**
 * `beforeLoad` runs before the renderer loads (the spellchecker's dictionaries must be in
 * place first); a failure there is logged and the window loads anyway.
 */
export function createMainWindow(
  beforeLoad?: (win: BrowserWindow) => Promise<void>,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 600,
    minHeight: 400,
    show: false,
    title: 'Markdown Office',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The main process switches checking on/off (SpellcheckController); the renderer limits it to Edit mode outside code and front matter.
      spellcheck: true,
      // Lets the renderer clear Chromium's cached spelling result before a recheck (features.ts).
      enableBlinkFeatures: SPELLCHECK_BLINK_FEATURES,
    },
  })
  // Test hook: local e2e runs never put a real window into a macOS fullscreen Space.
  if (process.env.MDO_E2E_FAKE_FULLSCREEN === '1') fakeFullScreen(win)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.once('ready-to-show', () => win.show())
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  const load = () => {
    if (win.isDestroyed()) return
    if (devUrl) void win.loadURL(devUrl)
    else void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  if (beforeLoad) {
    void beforeLoad(win)
      .catch((err) =>
        console.error('Markdown Office: Vorbereitung des Fensters fehlgeschlagen', err),
      )
      .then(load)
  } else load()
  return win
}
