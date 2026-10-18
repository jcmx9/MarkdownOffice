import { join } from 'node:path'
import { app, type BrowserWindow, Menu, net, type Session, session } from 'electron'
import { Ch } from '../../shared/ipc'
import type { Settings, UpdateResult } from '../../shared/types'
import { spellMenuTemplate } from './context-menu'
import {
  installBundledDictionaries,
  installedCodes,
  offeredTable,
  readState,
  updateState,
} from './dictionaries'
import { dictionaryFor } from './languages'
import { checkForUpdates, downloadDictionary, type Fetch } from './updates'

/** A URL that never answers: Electron must never fetch a dictionary from Google's CDN. */
export const DEAD_DOWNLOAD_URL = 'http://127.0.0.1:9/'

/**
 * Sessions that already carry the download listeners. Every window shares the default
 * session (and index.ts guards it at app start), so they must not be added again.
 */
const warned = new WeakSet<Session>()

/** One recorded Chromium download event (e2e hook MDO_E2E_SPELL=1). */
export interface SpellDownloadEvent {
  /** `initialized` lets the e2e test wait until Chromium has actually loaded a dictionary. */
  event: 'download-begin' | 'download-failure' | 'initialized'
  code: string
}

/**
 * Blocks Electron's dictionary download (dead URL) and logs every attempt. A download attempt
 * means Chromium did not find a file under the name it expects, i.e. a wrong file name in the
 * table: with MDO_E2E_SPELL=1 the events are recorded in `globalThis.mdoE2eSpell` so the e2e
 * suite fails on an Electron update that renames a dictionary.
 */
export function guardSession(s: Session): void {
  // Set every time (cheap) before anything can ask for a dictionary: a missing one fails.
  s.setSpellCheckerDictionaryDownloadURL(DEAD_DOWNLOAD_URL)
  if (warned.has(s)) return
  warned.add(s)
  const record = (event: SpellDownloadEvent['event'], code: string) => {
    if (process.env.MDO_E2E_SPELL !== '1') return
    const g = globalThis as { mdoE2eSpell?: SpellDownloadEvent[] }
    g.mdoE2eSpell = [...(g.mdoE2eSpell ?? []), { event, code }]
  }
  s.on('spellcheck-dictionary-download-begin', (_e, code) => {
    console.warn(`spellcheck: Chromium tried to download ${code} (blocked)`)
    record('download-begin', code)
  })
  s.on('spellcheck-dictionary-download-failure', (_e, code) => {
    console.warn(`spellcheck: no dictionary for ${code} (offline by design)`)
    record('download-failure', code)
  })
  if (process.env.MDO_E2E_SPELL === '1')
    s.on('spellcheck-dictionary-initialized', (_e, code) => record('initialized', code))
}

/**
 * The languages to check for `lang:` (or the system language): the wanted dictionary when it
 * is installed, else de-DE + en-US (those installed). `missing` names a wanted but absent one.
 */
async function chooseLanguages(
  dictDir: string,
  lang: string,
): Promise<{ apply: string[]; missing: { code: string; name: string } | null }> {
  const wanted = dictionaryFor(lang, app.getPreferredSystemLanguages(), await offeredTable(dictDir))
  const installed = await installedCodes(dictDir)
  if (wanted && installed.includes(wanted.code)) return { apply: [wanted.code], missing: null }
  return { apply: ['de-DE', 'en-US'].filter((c) => installed.includes(c)), missing: wanted }
}

/**
 * Electron's setSpellCheckerLanguages also switches checking on (non-empty list) or off (empty
 * list), so the user's switch is applied again right after it.
 */
function applyLanguages(s: Session, codes: string[], enabled: boolean): void {
  s.setSpellCheckerLanguages(codes)
  s.setSpellCheckerEnabled(enabled)
}

/**
 * At app start, before any window (Windows/Linux): installs the bundled dictionaries (and
 * activates staged updates), then guards the default session and sets the start languages.
 * Creating the session makes Chromium load its last dictionaries at once, so the files must be
 * in place first; otherwise a first start would try to download the system language's file
 * and keep it failed (the same list later does not reload). Must run before anything else
 * touches the default session (e.g. `protocol.handle`).
 */
export async function prepareSpellcheck(o: {
  userData: string
  bundledDir: string | null
  platform: NodeJS.Platform
  settings: Settings
}): Promise<void> {
  if (o.platform === 'darwin') return
  const dictDir = join(o.userData, 'Dictionaries')
  try {
    await installBundledDictionaries(o.bundledDir, dictDir)
  } catch (err) {
    console.warn('spellcheck: bundled dictionaries could not be installed', err)
  }
  const { apply } = await chooseLanguages(dictDir, '')
  const s = session.defaultSession
  guardSession(s)
  applyLanguages(s, apply, o.settings.spellcheck)
}

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
      // Already done at app start (prepareSpellcheck); repeated per window, which is cheap and
      // covers a window whose session was not guarded there.
      guardSession(s)
      // A failed install (disk full, permissions) must not skip the user's switch below: the
      // window enables checking by default, so "off" would otherwise be ignored. Also
      // activates staged (.pending) updates before this window's renderer loads.
      try {
        await installBundledDictionaries(this.opts.bundledDir, this.dictDir)
      } catch (err) {
        console.warn('spellcheck: bundled dictionaries could not be installed', err)
      }
    }
    this.applySettings(this.opts.settings())
    // Windows/Linux only (macOS uses system dictionaries); the daily limit lives in the check.
    // A rejected check (e.g. Electron throwing in a reload) is only logged.
    if (this.hunspell && this.opts.settings().dictionaryAutoUpdate)
      void this.runCheck(false).catch((err) =>
        console.warn('spellcheck: dictionary update check failed', err),
      )
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

  /** Sequence of setLanguage requests: only the latest one may apply its languages. */
  private langSeq = 0

  /**
   * Called by the renderer for the shown note: picks the dictionary from `lang:` (or the system
   * language) and answers which one is missing. Without a usable dictionary it keeps checking
   * with de-DE + en-US. macOS detects the language itself. The offered languages and their
   * files come from the release's dictionaries.json (cached), else the built-in table.
   */
  async setLanguage(lang: string): Promise<{ missing: { code: string; name: string } } | null> {
    if (!this.hunspell) return null
    // Overlapping calls (quick tab switches) finish in any order; the last REQUESTED wins.
    const seq = ++this.langSeq
    this.lastLang = lang
    const { apply, missing } = await chooseLanguages(this.dictDir, lang)
    if (seq !== this.langSeq) return null
    applyLanguages(this.win.webContents.session, apply, this.opts.settings().spellcheck)
    if (!missing) return null
    const state = await readState(this.dictDir)
    if (seq !== this.langSeq) return null
    return state.declined.includes(missing.code) ? null : { missing }
  }

  /** Remembers that the user does not want the „fehlt – laden?“ notice for this language. */
  async declineDictionary(code: string): Promise<void> {
    // Under the state lock, so a running update check cannot write an older state over it.
    await updateState(this.dictDir, (state) =>
      state.declined.includes(code) ? state : { ...state, declined: [...state.declined, code] },
    )
  }

  /**
   * GitHub requires a User-Agent; net.fetch honours the system proxy. Only the repo's releases.
   * The signal (updates.ts: AbortSignal.timeout(30 s) per request) also ends a stalled body.
   */
  private fetch: Fetch = (url, init) =>
    net.fetch(url, { headers: { 'User-Agent': 'Markdown Office' }, signal: init.signal })

  /** Language last requested; re-applied after a newly placed file so Electron loads it. */
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
    // Staged files only become active at the next start; a file placed directly (it was
    // missing) is picked up by applying the language list again.
    if (r.kind === 'updated' && !r.pending) await this.reload()
    return r
  }

  /** Re-applies the current language (a new request, so the latest one still wins). */
  private async reload(): Promise<void> {
    await this.setLanguage(this.lastLang)
  }

  /** Verified download of one language from the dictionary repo. */
  async downloadDictionary(code: string): Promise<boolean> {
    if (!this.hunspell) return false
    const r = await downloadDictionary({ dir: this.dictDir, fetch: this.fetch, code })
    // A missing language is in place now and was never opened: activate it at once. A file
    // that existed is staged and becomes active after a restart.
    if (r === 'installed') await this.reload()
    return r !== 'failed'
  }

  /** The user's own words ("Zum Wörterbuch hinzufügen"), for the settings dialog. */
  listWords(): Promise<string[]> {
    return this.win.webContents.session.listWordsInSpellCheckerDictionary()
  }

  /** Removes one own word; the session answers whether it existed. */
  removeWord(word: string): boolean {
    return this.win.webContents.session.removeWordFromSpellCheckerDictionary(word)
  }

  applySettings(settings: Settings): void {
    this.win.webContents.session.setSpellCheckerEnabled(settings.spellcheck)
  }
}
