import { join } from 'node:path'
import { app, type BrowserWindow, Menu, net, type Session } from 'electron'
import { Ch } from '../../shared/ipc'
import type { Settings, UpdateResult } from '../../shared/types'
import { spellMenuTemplate } from './context-menu'
import { installBundledDictionaries, installedCodes, readState, writeState } from './dictionaries'
import { dictionaryFor, KNOWN } from './languages'
import { checkForUpdates, downloadDictionary } from './updates'

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
    // Windows/Linux only (macOS uses system dictionaries); the daily limit lives in the check.
    if (this.hunspell && this.opts.settings().dictionaryAutoUpdate) void this.runCheck(false)
    // Per window (its webContents), so no session-level guard is needed. Corrections go through
    // the renderer as editor transactions, never webContents.replaceMisspelling.
    this.win.webContents.on('context-menu', (_e, p) => {
      const template = spellMenuTemplate(
        {
          isEditable: p.isEditable,
          misspelledWord: p.misspelledWord,
          dictionarySuggestions: p.dictionarySuggestions,
          x: p.x,
          y: p.y,
        },
        {
          replace: (word, replacement, x, y) =>
            this.win.webContents.send(Ch.spellReplace, { word, replacement, x, y }),
          addWord: (word) =>
            void this.win.webContents.session.addWordToSpellCheckerDictionary(word),
        },
      )
      // Test hook (e2e): record instead of showing a native menu Playwright cannot click.
      const g = globalThis as { mdoE2eMenus?: (typeof template)[] }
      if (process.env.MDO_E2E_MENUS === '1') {
        g.mdoE2eMenus = [...(g.mdoE2eMenus ?? []), template]
      } else Menu.buildFromTemplate(template).popup({ window: this.win })
    })
  }

  /** Codes the dictionary repo offers; Task 6 replaces this with the downloaded dictionaries.json. */
  private offered(): readonly string[] {
    return KNOWN
  }

  /**
   * Called by the renderer for the shown note: picks the dictionary from `lang:` (or the system
   * language) and answers which one is missing. Without a usable dictionary it keeps checking
   * with de-DE + en-US. macOS detects the language itself.
   */
  /** Sequence of setLanguage requests: only the latest one may apply its languages. */
  private langSeq = 0

  async setLanguage(lang: string): Promise<{ missing: { code: string; name: string } } | null> {
    if (!this.hunspell) return null
    // Overlapping calls (quick tab switches) finish in any order; the last REQUESTED wins.
    const seq = ++this.langSeq
    this.lastLang = lang
    const s = this.win.webContents.session
    const wanted = dictionaryFor(lang, app.getPreferredSystemLanguages(), this.offered())
    const installed = await installedCodes(this.dictDir)
    if (seq !== this.langSeq) return null
    if (wanted && installed.includes(wanted.code)) {
      s.setSpellCheckerLanguages([wanted.code])
      return null
    }
    s.setSpellCheckerLanguages(['de-DE', 'en-US'].filter((c) => installed.includes(c)))
    const state = await readState(this.dictDir)
    if (seq !== this.langSeq) return null
    return wanted && !state.declined.includes(wanted.code) ? { missing: wanted } : null
  }

  /** Remembers that the user does not want the „fehlt – laden?“ notice for this language. */
  async declineDictionary(code: string): Promise<void> {
    const state = await readState(this.dictDir)
    if (state.declined.includes(code)) return
    await writeState(this.dictDir, { ...state, declined: [...state.declined, code] })
  }

  /** GitHub requires a User-Agent; net.fetch honours the system proxy. Only the repo's releases. */
  private fetch = (url: string): Promise<Response> =>
    net.fetch(url, { headers: { 'User-Agent': 'Markdown Office' } })

  /** Language last requested; re-applied after an update so Electron reloads the new files. */
  private lastLang = ''

  /** Manual „jetzt prüfen“: ignores the daily limit. macOS has no check. */
  checkNow(): Promise<UpdateResult> {
    return this.hunspell ? this.runCheck(true) : Promise.resolve({ kind: 'skipped' })
  }

  private async runCheck(force: boolean): Promise<UpdateResult> {
    const r = await checkForUpdates({
      dir: this.dictDir,
      fetch: this.fetch,
      codes: await installedCodes(this.dictDir),
      force,
      now: Date.now(),
    })
    if (r.kind === 'updated') await this.reload()
    return r
  }

  /** Re-applies the current language (a new request, so the latest one still wins). */
  private async reload(): Promise<void> {
    await this.setLanguage(this.lastLang)
  }

  /** Verified download of one language from the dictionary repo. */
  async downloadDictionary(code: string): Promise<boolean> {
    if (!this.hunspell) return false
    const ok = await downloadDictionary({ dir: this.dictDir, fetch: this.fetch, code })
    if (ok) await this.reload()
    return ok
  }

  applySettings(settings: Settings): void {
    this.win.webContents.session.setSpellCheckerEnabled(settings.spellcheck)
  }
}
