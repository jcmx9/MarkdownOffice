import { join } from 'node:path'
import type { BrowserWindow, Session } from 'electron'
import type { Settings } from '../../shared/types'
import { installBundledDictionaries } from './dictionaries'

/** A URL that never answers: Electron must never fetch a dictionary from Google's CDN. */
export const DEAD_DOWNLOAD_URL = 'http://127.0.0.1:9/'

/**
 * Sessions that already carry the download-failure warning. Every window shares the default
 * session, so a re-created window (macOS reopen) must not add the listener again.
 */
const warned = new WeakSet<Session>()

export interface SpellcheckOptions {
  userData: string
  /** Bundled .bdic folder (Windows/Linux), null on macOS or when missing. */
  bundledDir: string | null
  platform: NodeJS.Platform
  settings: () => Settings
}

/**
 * Owns the window session's spellchecker. On Windows/Linux (Hunspell) it blocks Electron's
 * dictionary download and installs the bundled dictionaries before the renderer loads; on
 * macOS the system spellchecker needs neither. Switching on/off follows the settings.
 */
export class SpellcheckController {
  readonly dictDir: string
  constructor(
    private readonly win: BrowserWindow,
    private readonly opts: SpellcheckOptions,
  ) {
    this.dictDir = join(opts.userData, 'Dictionaries')
  }

  /** Electron uses Hunspell (and its download) everywhere but macOS. */
  get hunspell(): boolean {
    return this.opts.platform !== 'darwin'
  }

  async start(): Promise<void> {
    const s = this.win.webContents.session
    if (this.hunspell) {
      // Set before anything can ask for a dictionary: a missing one fails instead of loading.
      s.setSpellCheckerDictionaryDownloadURL(DEAD_DOWNLOAD_URL)
      if (!warned.has(s)) {
        warned.add(s)
        s.on('spellcheck-dictionary-download-failure', (_e, code) =>
          console.warn(`spellcheck: no dictionary for ${code} (offline by design)`),
        )
      }
      // A failed install (disk full, permissions) must not skip the user's switch below: the
      // window enables checking by default, so "off" would otherwise be ignored.
      if (this.opts.bundledDir) {
        try {
          await installBundledDictionaries(this.opts.bundledDir, this.dictDir)
        } catch (err) {
          console.warn('spellcheck: bundled dictionaries could not be installed', err)
        }
      }
    }
    this.applySettings(this.opts.settings())
  }

  applySettings(settings: Settings): void {
    this.win.webContents.session.setSpellCheckerEnabled(settings.spellcheck)
  }
}
