/**
 * Chromium (since its "user dictionary leaks" mitigation) checks text that is already in an
 * editable only when the editable was focused by a user gesture and the page had a recent
 * user activation (cold_mode_spell_check_requester.cc, idle_spell_check_controller.cc). The
 * editor is focused by the app when a note opens, so the misspellings of an opened note were
 * never marked; only freshly typed words were. The mitigation guards web pages against reading
 * the user's dictionary through spelling markers. Markdown Office never shows remote content
 * (sandboxed renderer, strict CSP, local notes only), so it lifts the restriction with the
 * Blink feature that exists for exactly this.
 */
export const SPELLCHECK_FEATURE = 'UnrestrictSpellingAndGrammarForTesting'

/** The part of Electron's `app.commandLine` this needs (a stand-in in unit tests). */
export interface CommandLineLike {
  getSwitchValue(name: string): string
  appendSwitch(name: string, value?: string): void
}

/**
 * Adds the feature to `--enable-features`, keeping features already given on the command line
 * (Chromium reads only one value). Must run before the app is ready (child processes inherit it).
 */
export function enableExistingTextSpellcheck(cl: CommandLineLike): void {
  const current = cl
    .getSwitchValue('enable-features')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f !== '')
  if (current.includes(SPELLCHECK_FEATURE)) return
  cl.appendSwitch('enable-features', [...current, SPELLCHECK_FEATURE].join(','))
}
