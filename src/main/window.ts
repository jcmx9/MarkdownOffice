import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

export function createMainWindow(): BrowserWindow {
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
      spellcheck: true,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.once('ready-to-show', () => win.show())
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}
