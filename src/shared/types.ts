import type { MathItem, MathResult } from '../core/math'
import type { SetCssRule } from '../core/set-css'
import type { ValidationInputs } from '../core/validation-context'

export type { MathItem, MathResult }

/** Line-ending style of a note. 'mixed' keeps every byte as found. */
export type Eol = '\n' | '\r\n' | 'mixed'

export interface NoteFile {
  path: string
  /** Text without BOM. */
  text: string
  bom: boolean
  eol: Eol
  /** sha256 of the bytes on disk. */
  hash: string
}

/** What the watcher reports for an open note that changed on disk. */
export type ExternalChange =
  | { kind: 'changed'; note: NoteFile }
  | { kind: 'unreadable'; path: string; reason: 'encoding' | 'error'; message: string }
  | { kind: 'deleted'; path: string }

export interface Settings {
  defaultFolder: string
  /** Read only when it exists; the app never creates it. */
  snippetFolder: string
  presentFontFactor: number
  /** How the YAML header of a note opened without a session entry shows in the Preview. */
  headerDefault: HeaderDefault
  /** Spell checking in the editor (never in Present, never in code blocks or front matter). */
  spellcheck: boolean
  /** Windows/Linux: look for dictionary updates at start (at most once a day). */
  dictionaryAutoUpdate: boolean
}

export type HeaderDefault = 'yaml' | 'titleblock'

export type SettingsPatch = Partial<Settings>

export type ChooseKind = 'folder'

/** Read-only status for the settings dialog. */
export interface SettingsStatus {
  /** The app version, which is also the bundled pipeline's version. */
  version: string
  /** null: the bundled `typst --version` gave no answer. */
  typst: string | null
}

export type Mode = 'edit' | 'present'
export type View = 'code' | 'preview'

export interface SessionTab {
  path: string
  headerHidden: boolean
}

export interface Session {
  tabs: SessionTab[]
  activeIndex: number
  mode: Mode
  view: View
  zoom: { edit: number; present: number }
  /** Outline sidebar on/off per mode. */
  outline: { edit: boolean; present: boolean }
  /** Formatting toolbar on/off in Edit mode (Present never shows it); default on. */
  toolbar: { edit: boolean }
  recent: string[]
}

export type SessionPatch = Partial<
  Pick<Session, 'tabs' | 'activeIndex' | 'mode' | 'view' | 'zoom' | 'outline' | 'toolbar'>
>

export interface StartupState {
  session: Session
  openPaths: string[]
  settings: Settings
}

export type SaveResult =
  /** path: the note's canonical path when it differs from the one passed (renamed outside). */
  | { ok: true; hash: string; path?: string }
  | { ok: false; error: string }
  /** Refused without writing: the file changed outside since the tab's base (path: see ok). */
  | { ok: false; conflict: ExternalChange; path?: string }
/** „Profil anlegen …“: path is the new profile YAML's canonical path (allowed for the renderer). */
export type CreateProfileResult = { ok: true; path: string } | { ok: false; error: string }
export type RenameResult = { ok: true; path: string } | { ok: false; error: string }
export type ExportResult =
  | { kind: 'ok'; message: string }
  | { kind: 'failed'; code: number | null; stderr: string }

export type MenuCommand =
  | 'new'
  | 'new-from-template'
  | 'create-profile'
  | 'open'
  | 'rename'
  | 'reveal'
  | 'close-tab'
  | 'export'
  | 'next-tab'
  | 'prev-tab'
  | 'undo'
  | 'redo'
  | 'select-all'
  // Find and replace (renderer/editor/search.ts).
  | 'find'
  | 'replace'
  | 'find-next'
  | 'find-previous'
  | 'insert-pagebreak'
  | 'insert-template'
  // Formatting toolbar commands (renderer/editor/format.ts, table-edit.ts); editor-only.
  | 'format-bold'
  | 'format-italic'
  | 'format-strike'
  | 'format-mark'
  | 'format-code'
  | 'format-h1'
  | 'format-h2'
  | 'format-h3'
  | 'format-bullet'
  | 'format-numbered'
  | 'format-task'
  | 'format-quote'
  | 'format-link'
  | 'insert-alert-note'
  | 'insert-alert-tip'
  | 'insert-alert-important'
  | 'insert-alert-warning'
  | 'insert-alert-caution'
  | 'insert-table'
  | 'table-row-below'
  | 'table-col-right'
  | 'table-row-delete'
  | 'table-col-delete'
  | 'toggle-toolbar'
  | 'toggle-present'
  | 'toggle-view'
  | 'toggle-header'
  | 'toggle-outline'
  | 'toggle-spellcheck'
  | 'validate-yaml'
  | 'fold'
  | 'unfold'
  | 'fold-all'
  | 'unfold-all'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'settings'

export interface MdoApi {
  startup(): Promise<StartupState>
  readNote(path: string): Promise<NoteFile | { error: string }>
  newNotePath(): Promise<string>
  releasePath(path: string): Promise<void>
  /**
   * base: hash of the bytes the tab last loaded or saved (null for a note not on disk yet);
   * force: the user chose to overwrite whatever is on disk.
   */
  saveNote(
    path: string,
    text: string,
    bom: boolean,
    base: string | null,
    force: boolean,
  ): Promise<SaveResult>
  renameNote(from: string, newName: string): Promise<RenameResult>
  showOpenDialog(): Promise<string[]>
  exportPdf(path: string): Promise<ExportResult>
  saveSession(patch: SessionPatch): Promise<void>
  watch(paths: string[]): Promise<void>
  confirmDiscard(names: string[]): Promise<boolean>
  onMenu(cb: (cmd: MenuCommand) => void): void
  /** A spelling correction chosen in the context menu (x/y: window coordinates of the click). */
  onSpellReplace(cb: (m: { word: string; replacement: string; x: number; y: number }) => void): void
  /** A dictionary became active (Windows/Linux): the text already shown must be checked again. */
  onSpellRecheck(cb: () => void): void
  /** Tells main the shown note's lang: ('' = none); answers which dictionary is missing, if any. */
  setSpellLanguage(lang: string): Promise<{ missing: { code: string; name: string } } | null>
  downloadDictionary(code: string): Promise<boolean>
  /** Checks the dictionary repo now (Windows/Linux); macOS answers skipped. */
  checkDictionaryUpdates(): Promise<UpdateResult>
  declineDictionary(code: string): Promise<void>
  /** The user's own words in the spellchecker dictionary (settings dialog). */
  spellWords(): Promise<string[]>
  /** Removes one own word; false when main refused the string or the word was not there. */
  removeSpellWord(word: string): Promise<boolean>
  onOpenPaths(cb: (paths: string[]) => void): void
  onExternalChange(cb: (change: ExternalChange) => void): void
  /** cb resolves true when the window may close. */
  onBeforeClose(cb: () => Promise<boolean>): void
  /** Resolves to whether the user (not the app) had the window fullscreen before the change. */
  setFullScreen(on: boolean): Promise<boolean>
  onFullScreenLeft(cb: () => void): void
  /** The OS did not enter the fullscreen the app requested; Present continues windowed. */
  onFullScreenRefused(cb: () => void): void
  listSnippets(): Promise<SnippetDef[]>
  /** Every template set the export can resolve (bundled and user sets, memo included). */
  listSets(): Promise<SetInfo[]>
  /**
   * The header a new note of this set starts with (its `<name>.header.md`, else a minimal
   * `template: <name>` header); null for an invalid name or a set that does not exist.
   */
  readSetHeader(name: string): Promise<string | null>
  /** Profile names offered for this set (user profiles first in lookup, sorted); [] if none. */
  listProfiles(name: string): Promise<string[]>
  /**
   * Copies the set's example profile (and its companion files) to
   * `Vorlagen/<set>/profiles/<name>.yaml`; never overwrites. Main validates both names.
   */
  createProfile(set: string, name: string): Promise<CreateProfileResult>
  /**
   * Disk inputs of „YAML prüfen“ for a note: installed sets, the set's header and schema, and
   * the `profile:` lookup. `path` is the note's file (null = unsaved, no note folder); main
   * rejects a path it did not allow. `template`/`profile` are the note's raw values.
   */
  validationInputs(
    path: string | null,
    template: string,
    profile: string,
  ): Promise<ValidationInputs>
  /**
   * Disk inputs of the editor preview for a note (set CSS, preview description, profile,
   * signature). Same argument rules as `validationInputs`; the note's raw values.
   */
  previewInputs(path: string | null, template: string, profile: string): Promise<PreviewInputs>
  /** Shows the shown note's context menu (rename, reveal, export, close) at the mouse. */
  showNoteMenu(): Promise<void>
  /**
   * Shows the note in the OS file manager (Finder/Explorer). Main rejects a path it did not
   * allow. Resolves to null when shown, else the message for the user (e.g. file missing).
   */
  revealPath(path: string): Promise<string | null>
  /** Opens an http(s)/mailto link in the system's program; an error text or null. */
  openExternal(url: string): Promise<string | null>
  /**
   * Opens the user templates folder (`Vorlagen`, created when missing) in the file manager.
   * Resolves to null when opened, else the message for the user.
   */
  openTemplatesFolder(): Promise<string | null>
  getSettingsStatus(): Promise<SettingsStatus>
  /** Main validates every value; resolves to the settings now in effect (invalid ones dropped). */
  updateSettings(patch: SettingsPatch): Promise<Settings>
  /** Native picker; resolves to the canonical path, or null when cancelled. */
  choosePath(kind: ChooseKind, current: string): Promise<string | null>
  /** Bytes of a pipeline WebAssembly plugin (same file the PDF uses); main owns the path. */
  pluginWasm(name: 'mmdr' | 'mitex'): Promise<Uint8Array>
  /**
   * Formulas set by the bundled Typst + mitex, one result per item in order (sizes in em).
   * Main rejects a batch that is not exactly `{ tex, display }` entries within the limits.
   */
  renderMath(items: MathItem[]): Promise<MathResult[]>
}

/** A template set as the "new from template" picker lists it (discovered on disk, never hard-coded). */
export interface SetInfo {
  name: string
  /** bundled: `<sets>/<name>/`; user: the templates folder (a user set shadows a bundled one). */
  source: 'bundled' | 'user'
  /** First comment line of the set's header file, or a note that it has none. */
  hint: string
  /** The header has a column-0 `profile:` key, so the picker offers the existing profiles. */
  hasProfile: boolean
}

/** What the editor preview needs from disk to show a note like its PDF (`previewInputs`). */
export interface PreviewInputs {
  /** The resolved set; '' = none (a .typ path or a set that is not installed): built-in look. */
  set: string
  /** Sanitised rules of <set>.css; [] without a file. */
  css: SetCssRule[]
  /** <set>.preview.yaml as text; null without a readable file. */
  preview: string | null
  /** The resolved profile, flat source text; {} without a found profile. */
  profile: Record<string, string>
  /** The profile's signature as data:image/svg+xml;base64,…; null when absent or refused. */
  signature: string | null
}

export interface SnippetDef {
  name: string
  body: string
  source: 'builtin' | 'user'
}

/** Outcome of a dictionary update check (MarkdownOffice-dictionaries releases). */
export type UpdateResult =
  | { kind: 'current' }
  // pending: at least one file replaced an open dictionary and becomes active after a restart.
  | { kind: 'updated'; version: string; files: string[]; pending: boolean }
  | { kind: 'skipped' }
  | { kind: 'failed'; reason: string }
