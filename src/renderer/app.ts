import { closeCompletion } from '@codemirror/autocomplete'
import { redo, selectAll, undo } from '@codemirror/commands'
import { foldCode, unfoldAll, unfoldCode } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { PIPELINE_SCHEMA } from '../core/frontmatter-schema'
import {
  errorCount,
  noteSet,
  topLevelValue,
  type ValidationContext,
  validateFrontmatter,
} from '../core/frontmatter-validate'
import { DEFAULT_SET, SET_NAME_RE, withProfile } from '../core/sets'
import { validationContext } from '../core/validation-context'
import type {
  ExportResult,
  ExternalChange,
  MenuCommand,
  Mode,
  NoteFile,
  PreviewInputs,
  Settings,
  View,
} from '../shared/types'
import { AutosaveScheduler } from './editor/autosave'
import { frontmatterFields, frontmatterRange } from './editor/frontmatter'
import { headerHidden, headerToggleSpec, moveOutOfHeader } from './editor/header'
import { headerNote, insertTemplate } from './editor/insert-header'
import { modeCompartment, modeExtensions } from './editor/mode'
import { setNoteProfile } from './editor/note-profile'
import { jumpToEntry, OutlineSync, toggleEntryFold } from './editor/outline-actions'
import { insertPageBreak } from './editor/pagebreak'
import { previewSource, previewSourceFrom, setPreviewSource } from './editor/preview-source'
import { foldAllSections } from './editor/sections'
import {
  createState,
  type DocKind,
  freezeSpec,
  isFrozen,
  serializeDoc,
  viewCompartment,
  viewExtensions,
} from './editor/setup'
import { snippetRegistry } from './editor/snippets'
import {
  forgetDismissedNotices,
  offerDictionaryNotice,
  recheckSpelling,
  replaceWordAt,
  SPELL_RECHECK_FOLLOW_UP_MS,
  SpellLanguageTracker,
  spellAnswerCurrent,
  spellcheckCompartment,
  spellcheckExtensions,
} from './editor/spellcheck'
import { choiceSpec } from './editor/validate'
import { isMarkdownTab, type Tab, TabStore } from './tabs/tab-store'
import { allowedWithDialog, editTarget } from './ui/edit-target'
import { InfoLine } from './ui/infoline'
import { Notices } from './ui/notices'
import { Outline } from './ui/outline'
import { applyOutlineWidth, attachOutlineResize } from './ui/outline-resize'
import { askText } from './ui/prompt'
import { SetPreview } from './ui/set-preview'
import { inputsKey, SetCheck } from './ui/set-status'
import { SetStyles } from './ui/set-styles'
import { droppedFields, openSettings, STATUS_TIMEOUT_MS, withTimeout } from './ui/settings'
import { SpaceAdvance } from './ui/space-advance'
import { type SaveState, StatusLine, saveText } from './ui/statusline'
import { TabBar } from './ui/tabbar'
import { pickerSets, pickTemplate, type TemplateChoice } from './ui/template-picker'
import { openValidateDialog } from './ui/validate-dialog'
import { editorScale, handleZoomKey, zoomIn, zoomOut } from './ui/zoom'
import { closeWindow } from './util/close-guard'
import { fileName } from './util/path'
import { LatestToggle, SerialQueue } from './util/serial'

const CONFLICT_ERROR = 'Externe Änderung – bitte im Hinweis entscheiden'
const UNREADABLE_ERROR = 'Externe Fassung nicht lesbar – bitte im Hinweis entscheiden'
const DELETED_ERROR = 'Datei außerhalb gelöscht – bitte im Hinweis entscheiden'

const MAX_SAVE_ROUNDS = 3

const MARKDOWN_ONLY = 'Nur in Markdown-Notizen verfügbar.'

/** A `template:` main answers for: empty, a .typ path or a set name (within main's lengths). */
const mainAccepts = (template: string): boolean =>
  template === '' ||
  (template.length <= 256 && template.toLowerCase().endsWith('.typ')) ||
  (template.length <= 64 && SET_NAME_RE.test(template))

const docKind = (path: string): DocKind => (isMarkdownTab({ path }) ? 'markdown' : 'yaml')

/** One conflict banner per tab: a tab keeps its banner when its path changes (case-only rename). */
const bannerKey = (tabId: number): string => `tab:${tabId}`

const isMac = navigator.userAgent.includes('Mac')

export interface AppRoot {
  tabbar: HTMLElement
  editor: HTMLElement
  empty: HTMLElement
  status: HTMLElement
  infoline: HTMLElement
  outline: HTMLElement
  outlineGrip: HTMLElement
  notices: HTMLElement
}

export class App {
  private readonly mdo = window.mdo
  private readonly store = new TabStore()
  private readonly autosave = new AutosaveScheduler(() => this.saveAll())
  private readonly editor: EditorView
  private readonly tabBar: TabBar
  private readonly status: StatusLine
  /** The silent YAML check behind the status line's set name. */
  private readonly setCheck: SetCheck
  /** The shown note's set look: its scoped CSS and its head/foot description per tab. */
  private readonly setPreview: SetPreview
  private readonly setStyles: SetStyles
  private readonly spaceAdvance: SpaceAdvance
  /** Sets whose broken `.preview.yaml` notice was already shown this session. */
  private readonly previewNoticed = new Set<string>()
  private readonly notices: Notices
  private readonly infoLine: InfoLine
  private readonly outline: OutlineSync
  /** Outline sidebar on/off per mode (persisted in the session). */
  private outlineOn = { edit: false, present: false }
  /** Dragged outline width in em (Edit mode, persisted); null = default. */
  private outlineWidth: number | null = null
  /** Width dragged during the current Present; never persisted, reset on every entry. */
  private presentOutlineWidth: number | null = null
  private view: View = 'preview'
  private mode: Mode = 'edit'
  private zoom = { edit: 1, present: 1 }
  private presentFactor = 1.6
  private settings: Settings | null = null
  private settingsOpen = false
  /**
   * The template picker or „YAML prüfen …“ is open or loading its inputs (Mod+Shift+N or
   * Mod+Shift+Y twice opens it once).
   */
  private pickerOpen = false
  /** Spell checking switch (Settings.spellcheck); applied only in Edit mode. */
  private spellcheckOn = true
  /**
   * Serializes fullscreen requests so fast toggles reach main in order. Main owns the
   * fullscreen decision: it only leaves a fullscreen the app started (a user's own
   * fullscreen survives Present) and never reports its own leave as an OS leave.
   */
  private readonly fullScreenOps = new SerialQueue()
  /**
   * Toggle-present while a fullscreen request is in flight (main settles an enter only once
   * the window is fullscreen or the OS refused it) is remembered, not dropped: last intent wins.
   */
  private readonly presentToggle = new LatestToggle(
    () => this.mode === 'present',
    (on) => (on ? this.enterPresent() : this.exitPresent()),
  )
  private shownId: number | null = null
  /** Last lang: reported to main, so unchanged values cause no IPC. */
  private readonly spellLang = new SpellLanguageTracker()
  private spellLangTimer: ReturnType<typeof setTimeout> | null = null
  /** The follow-up recheck after a newly loaded dictionary (see onSpellRecheck). */
  private spellRecheckTimer: ReturnType<typeof setTimeout> | null = null
  /** Dictionaries whose „fehlt“ notice was already shown this session. */
  private readonly dictNoticed = new Set<string>()
  private readonly saveErrors = new Map<number, string>()
  /** Tabs held after an external change: no saving until the user answers the banner. */
  private readonly conflicts = new Set<number>()
  /** Tabs whose content is not on disk although clean (file deleted or made unreadable outside). */
  private readonly unwritten = new Set<number>()
  /** Status warning of a tab held because its file was deleted or became unreadable. */
  private readonly holdWarnings = new Map<number, string>()
  /** Hash of the bytes each tab last loaded or saved, to recognise our own content on disk. */
  private readonly savedHashes = new Map<number, string>()
  /**
   * Tabs whose next write may replace whatever is on disk: the user chose to keep or save their
   * version over an external change, a deletion or unreadable bytes. Cleared by the next
   * successful write and by every new external change.
   */
  private readonly overwrite = new Set<number>()
  private readonly saving = new Map<number, Promise<boolean>>()
  private sessionTimer: ReturnType<typeof setTimeout> | null = null
  /** The running window close; input into every tab is frozen while it is set. */
  private closing: Promise<boolean> | null = null

  constructor(private readonly root: AppRoot) {
    this.editor = new EditorView({
      parent: root.editor,
      state: createState('', '\n', this.view),
      dispatchTransactions: (trs, view) => {
        view.update(trs)
        // Route to the tab actually shown, not store.active (which can run ahead of show()).
        const tab = this.shownId === null ? undefined : this.store.get(this.shownId)
        if (!tab) return
        this.store.updateState(tab.id, view.state)
        this.outline.update(trs)
        if (trs.some((tr) => tr.docChanged)) {
          this.autosave.touch()
          this.refresh()
          this.setCheck.schedule(tab.id)
          this.setPreview.schedule(tab.id)
          // lang: may have been edited; report it once typing pauses.
          if (this.spellLangTimer) clearTimeout(this.spellLangTimer)
          this.spellLangTimer = setTimeout(() => void this.reportSpellLanguage(false), 500)
        }
      },
    })
    this.tabBar = new TabBar(root.tabbar, {
      select: (i) => this.activate(i),
      close: (id) => void this.closeTab(id),
      menu: (i) => void this.noteMenu(i),
    })
    this.status = new StatusLine(root.status, {
      noteMenu: () => void this.noteMenu(),
      setMode: (mode) => {
        if (mode !== this.mode) void this.presentToggle.toggle()
      },
      setView: (view) => this.setView(view),
      // Through command(): the same guards as the menu (closing window, open dialog).
      toggleOutline: () => void this.command('toggle-outline'),
      toggleYaml: () => void this.command('toggle-header'),
      // The menu command, so Present refuses it with the same toast.
      validateYaml: () => void this.command('validate-yaml'),
    })
    this.setCheck = new SetCheck({
      snapshot: (id) => {
        const tab = this.store.get(id)
        if (!tab || id !== this.shownId) return null
        // A YAML file (a profile) is no note: no front matter, so no set to show.
        if (!isMarkdownTab(tab)) return { text: '', key: '' }
        const text = this.editor.state.doc.toString()
        return { text, key: inputsKey(tab.onDisk ? tab.path : null, text) }
      },
      context: async (id) => {
        const tab = this.store.get(id)
        if (!tab) return null
        const { ctx, answered } = await this.validationFor(tab)
        return { ctx, cache: answered }
      },
      paint: (id, status) => {
        if (id === this.shownId) this.status.renderSet(status)
      },
    })
    this.setStyles = new SetStyles(document, root.editor)
    // On the editor element: the set's scoped tokens sit there (`#editor[…] .mdo-preview`).
    this.spaceAdvance = new SpaceAdvance(() => this.editor.dom)
    this.setPreview = new SetPreview({
      // Same key as the set check: only path, template: and profile: change the inputs.
      key: (id) => {
        const tab = this.store.get(id)
        if (!tab || id !== this.shownId || !isMarkdownTab(tab)) return null
        return inputsKey(tab.onDisk ? tab.path : null, this.editor.state.doc.toString())
      },
      fetch: (id) => this.previewFor(id),
      apply: (id, inputs) => this.applyPreview(id, inputs),
    })
    this.notices = new Notices(root.notices)
    this.infoLine = new InfoLine(root.infoline, {
      selectTab: (i) => this.activate(i),
      exitPresent: () => void this.exitPresent(),
      // Through command(): the same guards as Mod+Shift+M (closing window, open dialog).
      showCode: () => void this.command('toggle-view'),
      zoomIn: () => this.setZoom(zoomIn(this.zoom[this.mode])),
      zoomOut: () => this.setZoom(zoomOut(this.zoom[this.mode])),
    })
    this.outline = new OutlineSync(
      new Outline(root.outline, {
        jump: (e) => jumpToEntry(this.editor, e),
        toggle: (e) => toggleEntryFold(this.editor, e),
      }),
      () => (this.shownId === null ? null : this.editor.state),
    )
    attachOutlineResize(root.outlineGrip, root.outline, {
      commit: (em) => {
        root.outlineGrip.setAttribute('aria-valuenow', String(Math.round(em ?? 18)))
        // A width dragged in Present lasts only until Present ends.
        if (this.mode === 'present') {
          this.presentOutlineWidth = em
          return
        }
        this.outlineWidth = em
        this.mdo
          .saveSession({ outlineWidth: em })
          .catch((e: unknown) => console.error('saveSession(outlineWidth) failed', e))
      },
    })
    this.mdo.onFullScreenLeft(() => {
      if (this.mode === 'present') void this.exitPresent(false)
    })
    this.mdo.onFullScreenRefused(() => {
      // A meeting must not lose Present because the OS refused fullscreen. No notice when a
      // toggle during the refused enter already asked to leave Present (it ends right after).
      if (this.mode === 'present' && this.presentToggle.pendingWant !== false)
        this.notices.toast('Vollbild nicht verfügbar – Präsentation im Fenster')
    })
    root.empty
      .querySelector('[data-action=new]')
      ?.addEventListener('click', () => void this.newDefaultNote())
    root.empty
      .querySelector('[data-action=open]')
      ?.addEventListener('click', () => void this.open())
    this.mdo.onMenu((cmd) => void this.command(cmd))
    this.mdo.onSpellReplace(({ word, replacement, x, y }) => {
      // x/y are window coordinates of the right click (Electron context-menu params).
      replaceWordAt(this.editor, this.editor.posAtCoords({ x, y }), word, replacement)
    })
    this.mdo.onSpellRecheck(() => {
      const recheck = () => {
        // A shown profile (YAML) stays unchecked; a later switch to a note reconfigures anyway.
        const shown = this.shownId === null ? undefined : this.store.get(this.shownId)
        const on = this.spellcheckOn && (!shown || isMarkdownTab(shown))
        recheckSpelling(this.editor, on, this.mode)
      }
      recheck()
      // Chromium hands the renderer the new dictionary on a Mojo pipe of its own, which is not
      // ordered with this IPC message: the first recheck can still run with the old languages
      // (Windows CI: English suggestions in a German note even after the recheck, PR #45; a
      // second recheck seconds later fixed it). So once more, after a short delay.
      if (this.spellRecheckTimer) clearTimeout(this.spellRecheckTimer)
      this.spellRecheckTimer = setTimeout(() => {
        this.spellRecheckTimer = null
        recheck()
      }, SPELL_RECHECK_FOLLOW_UP_MS)
    })
    this.mdo.onOpenPaths((paths) => void this.openPaths(paths))
    this.mdo.onExternalChange((change) => this.externalChange(change))
    this.mdo.onBeforeClose(() => this.beforeClose())
    window.addEventListener('keydown', (e) => this.globalKeys(e))
    window.addEventListener('blur', () => void this.autosave.flush())
    window.addEventListener('focus', () => {
      void this.reloadSnippets()
      // Sets or profiles may have been installed in the file manager meanwhile.
      if (this.shownId !== null) {
        void this.setCheck.now(this.shownId, true)
        // An edited <set>.css, .preview.yaml or profile shows without reopening the note.
        void this.setPreview.now(this.shownId, true)
      }
    })
  }

  private async reloadSnippets(): Promise<void> {
    try {
      snippetRegistry.setUser(await this.mdo.listSnippets())
    } catch (err) {
      console.error('Markdown Office: Snippets konnten nicht geladen werden', err)
    }
  }

  async start(): Promise<void> {
    const startup = await this.mdo.startup()
    this.view = startup.session.view
    this.zoom = { ...startup.session.zoom }
    this.outlineOn = { ...startup.session.outline }
    this.outlineWidth = startup.session.outlineWidth
    this.settings = startup.settings
    this.spellcheckOn = startup.settings.spellcheck
    this.presentFactor = startup.settings.presentFontFactor
    this.applyZoom()
    for (const t of startup.session.tabs) await this.openPath(t.path, t.headerHidden)
    const activePath = startup.session.tabs[startup.session.activeIndex]?.path
    const activeTab = activePath === undefined ? undefined : this.store.findByPath(activePath)
    if (activeTab) this.store.activate(this.store.all.indexOf(activeTab))
    for (const p of startup.openPaths) await this.openPath(p)
    if (this.store.all.length === 0) await this.newNote()
    else this.show()
    void this.reloadSnippets()
  }

  // ── commands ────────────────────────────────────────────────────────────

  private async command(cmd: MenuCommand): Promise<void> {
    // While the window closes nothing may change a document, a path or the tab list.
    if (this.closing) return
    // Behind a modal dialog only the edit commands run (they serve its text fields).
    if (!allowedWithDialog(cmd, document.querySelector('dialog[open]') !== null)) return
    if (
      this.mode === 'present' &&
      (cmd === 'export' ||
        cmd === 'toggle-header' ||
        cmd === 'insert-template' ||
        cmd === 'validate-yaml' ||
        cmd === 'create-profile' ||
        // The file manager would come to the front over the shared Present screen.
        cmd === 'reveal' ||
        cmd === 'settings')
    ) {
      this.notices.toast('Im Präsentationsmodus nicht verfügbar – Esc beendet ihn.')
      return
    }
    switch (cmd) {
      case 'new':
        return this.newDefaultNote()
      case 'new-from-template':
        return this.newFromTemplate()
      case 'create-profile':
        return this.createProfile()
      case 'open':
        return this.open()
      case 'rename':
        return this.rename()
      case 'reveal':
        return this.reveal()
      case 'close-tab': {
        const tab = this.store.active
        if (tab) await this.closeTab(tab.id)
        return
      }
      case 'export':
        return this.exportPdf()
      case 'next-tab':
        await this.autosave.flush()
        this.store.next()
        return this.show()
      case 'prev-tab':
        await this.autosave.flush()
        this.store.prev()
        return this.show()
      case 'undo':
        return this.editCommand('undo', undo)
      case 'redo':
        return this.editCommand('redo', redo)
      case 'select-all':
        return this.editCommand('selectAll', selectAll)
      case 'insert-pagebreak':
        // A page break is Markdown; a profile tab (YAML) ignores the shortcut like its keymap does.
        if (this.store.active && !isMarkdownTab(this.store.active)) return
        return this.editCommand('insertPageBreak', insertPageBreak)
      case 'insert-template':
        return this.insertTemplate()
      case 'validate-yaml':
        return this.validateYaml()
      case 'toggle-view':
        if (this.mode === 'present') return this.presentToCode()
        return this.setView(this.view === 'code' ? 'preview' : 'code')
      case 'toggle-header':
        return this.toggleHeader()
      case 'toggle-outline':
        return this.toggleOutline()
      case 'toggle-spellcheck':
        return this.toggleSpellcheck()
      case 'fold':
        foldCode(this.editor)
        this.editor.focus()
        return
      case 'unfold':
        unfoldCode(this.editor)
        this.editor.focus()
        return
      case 'fold-all':
        foldAllSections(this.editor)
        this.editor.focus()
        return
      case 'unfold-all':
        unfoldAll(this.editor)
        this.editor.focus()
        return
      case 'zoom-in':
        return this.setZoom(zoomIn(this.zoom[this.mode]))
      case 'zoom-out':
        return this.setZoom(zoomOut(this.zoom[this.mode]))
      case 'zoom-reset':
        return this.setZoom(1)
      case 'toggle-present':
        return this.presentToggle.toggle()
      case 'settings':
        return this.editSettings()
    }
  }

  private async editSettings(): Promise<void> {
    const current = this.settings
    if (!current || this.settingsOpen || this.pickerOpen || document.querySelector('dialog[open]'))
      return
    this.settingsOpen = true
    try {
      const patch = await openSettings({
        settings: current,
        status: withTimeout(this.mdo.getSettingsStatus(), STATUS_TIMEOUT_MS),
        choose: (kind, path) => this.mdo.choosePath(kind, path),
        openTemplatesFolder: () => this.mdo.openTemplatesFolder(),
        platform: isMac ? 'darwin' : 'other',
        checkDictionaries: () => this.mdo.checkDictionaryUpdates(),
        words: () => this.mdo.spellWords(),
        removeWord: (w) => this.mdo.removeSpellWord(w),
      })
      if (!patch || Object.keys(patch).length === 0) return
      const next = await this.mdo.updateSettings(patch)
      this.settings = next
      const dropped = droppedFields(patch, next)
      if (dropped.length > 0)
        this.notices.panel(
          'Nicht alle Einstellungen übernommen',
          `${dropped.join('\n')}\nFür diese Felder gilt weiter der bisherige Wert.`,
        )
      if (next.spellcheck !== this.spellcheckOn) {
        // A settings change (not the menu) must reach the editor too.
        this.spellcheckOn = next.spellcheck
        this.reconfigureAll()
        this.spellSwitched()
      }
      if (next.presentFontFactor !== this.presentFactor) {
        this.presentFactor = next.presentFontFactor
        this.applyZoom()
        this.refresh()
      }
      if (next.snippetFolder !== current.snippetFolder) await this.reloadSnippets()
    } catch (e) {
      this.notices.panel(
        'Einstellungen nicht gespeichert',
        e instanceof Error ? e.message : String(e),
      )
    } finally {
      this.settingsOpen = false
      if (this.shownId !== null) this.editor.focus()
    }
  }

  /** Header state of a tab opened without a session entry (Einstellungen → YAML-Header). */
  private headerDefaultHidden(): boolean {
    return this.settings?.headerDefault === 'titleblock'
  }

  /** Edit commands go to CodeMirror unless another text field (dialog, panel) has focus. */
  private editCommand(
    name: 'undo' | 'redo' | 'selectAll' | 'insertPageBreak',
    run: (v: EditorView) => unknown,
  ): void {
    const target = editTarget(
      document.activeElement,
      this.editor.dom,
      document.querySelector('dialog[open]') !== null,
    )
    if (target === 'blocked') return
    if (target === 'field') {
      // A page break only makes sense in the document; other fields ignore the shortcut.
      if (name !== 'insertPageBreak') document.execCommand(name)
      return
    }
    run(this.editor)
    this.editor.focus()
  }

  private globalKeys(e: KeyboardEvent): void {
    if (
      this.mode === 'present' &&
      e.key === 'Escape' &&
      !e.defaultPrevented &&
      !document.querySelector('dialog[open]')
    ) {
      e.preventDefault()
      void this.exitPresent()
      return
    }
    const zoomed = handleZoomKey(e, isMac, (action) => {
      const z = this.zoom[this.mode]
      this.setZoom(action === 'in' ? zoomIn(z) : action === 'out' ? zoomOut(z) : 1)
    })
    if (zoomed) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      this.activate(Number(e.key) - 1)
    }
  }

  private setZoom(next: number): void {
    this.zoom[this.mode] = Math.min(3, Math.max(0.5, next))
    this.applyZoom()
    this.refresh()
    this.syncMain()
  }

  /** Scales the editor via CSS custom properties (never Electron page zoom). */
  private applyZoom(): void {
    // Only the factor is set inline: the sizes are theme/set tokens built on it, so a set's
    // own --mdo-body-size is not overridden by an inline value.
    const scale = editorScale(this.mode, this.zoom[this.mode], this.presentFactor)
    this.root.editor.style.setProperty('--mdo-scale', String(scale))
    // The outline follows the zoom of the mode, not Present's larger text factor.
    this.root.outline.style.setProperty('--mdo-ol-zoom', String(this.zoom[this.mode]))
    this.editor.requestMeasure()
  }

  private activate(index: number): void {
    void this.autosave.flush()
    this.store.activate(index)
    this.show()
  }

  /**
   * A new tab. With a header, that header is the tab's initial and clean text (nothing is
   * written until the user types, so an untouched new note leaves no file) and stays visible
   * whatever the header default says, with the cursor inside `title: ""` like the header
   * insert. Present collapses every header, so there createState's cursor after it stays.
   */
  private async newNote(header?: string): Promise<void> {
    if (this.closing) return
    const path = await this.mdo.newNotePath()
    // The window may have started closing during the round-trip: no tab, and give the reserved
    // name back so it does not stay blocked.
    if (this.closing) {
      void this.mdo.releasePath(path)
      return
    }
    const hideHeader = header === undefined && this.headerDefaultHidden()
    const note = header === undefined ? null : headerNote(header)
    let state = createState(
      note?.text ?? '',
      '\n',
      this.effectiveView(path),
      hideHeader,
      this.mode,
      this.spellcheckOn,
    )
    // Selection only: the document stays equal to the saved one, so the tab is not dirty.
    if (note && this.mode !== 'present')
      state = state.update({ selection: { anchor: note.anchor } }).state
    this.store.add({
      path,
      state,
      bom: false,
      eol: '\n',
      onDisk: false,
      headerHidden: hideHeader,
    })
    this.show()
  }

  /**
   * Mod+N / „Neu“ / the empty state's button: a note of the default set, started with its
   * header. Without that set an empty note opens anyway, so „Neu“ never does nothing.
   */
  private async newDefaultNote(): Promise<void> {
    if (this.closing) return
    let header: string | null = null
    try {
      header = await this.mdo.readSetHeader(DEFAULT_SET)
    } catch (e) {
      console.warn('readSetHeader(default) failed', e)
    }
    if (this.closing) return
    if (header === null) this.notices.toast(`Vorlage ${DEFAULT_SET} nicht gefunden.`)
    await this.newNote(header ?? undefined)
  }

  /** „Neu aus Vorlage …“: every set (default first), then a new note with its header. */
  private async newFromTemplate(): Promise<void> {
    const header = await this.chosenHeader('Neu aus Vorlage', 'Erstellen', () => !this.closing)
    if (header !== null) await this.newNote(header)
  }

  /**
   * Datei → „Profil anlegen …“: for the shown note's `template:` set, main copies the set's
   * example profile to `Vorlagen/<set>/profiles/<name>.yaml`; then the note gets
   * `profile: <name>` (one undo step) and the new YAML opens as a tab for editing. Refused with a
   * toast when the note names no set, a `.typ` path instead of a set, or main refuses (unknown
   * set, no example profile, name taken: nothing is ever overwritten).
   */
  private async createProfile(): Promise<void> {
    const tab = this.shownId === null ? undefined : this.store.get(this.shownId)
    if (!tab || this.pickerOpen || this.settingsOpen) return
    if (!isMarkdownTab(tab)) {
      this.notices.toast(MARKDOWN_ONLY)
      return
    }
    const set = frontmatterFields(this.editor.state.doc).template ?? ''
    if (set === '') {
      this.notices.toast('Die Notiz nennt kein Vorlagen-Set (template:).')
      return
    }
    if (!SET_NAME_RE.test(set)) {
      this.notices.toast(`Profile gibt es nur für Vorlagen-Sets, nicht für „${set}“.`)
      return
    }
    const name = await askText(
      'Profil anlegen',
      `Name des neuen ${set}-Profils (a–z, 0–9, - _)`,
      '',
    )
    if (!name || this.closing) return
    let res: Awaited<ReturnType<typeof this.mdo.createProfile>>
    try {
      res = await this.mdo.createProfile(set, name)
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!res.ok) {
      this.notices.toast(res.error)
      return
    }
    // The note may no longer be shown (tab switched while main copied): change its stored state.
    const live = this.store.get(tab.id)
    if (live && !this.closing) {
      const shown = live.id === this.shownId
      const spec = setNoteProfile(shown ? this.editor.state : live.state, name)
      if (spec && shown) this.editor.dispatch(spec)
      else if (spec) {
        this.store.updateState(live.id, live.state.update(spec).state)
        this.autosave.touch()
      }
    }
    await this.openPaths([res.path])
  }

  /**
   * Asks for a set (and its profile) and returns that set's header with the chosen profile,
   * or null when cancelled or no longer wanted: `still` is checked after every await, since
   * the window may start closing or the tab change while main answers.
   */
  private async chosenHeader(
    title: string,
    confirm: string,
    still: () => boolean,
  ): Promise<string | null> {
    const choice = await this.chooseTemplate(title, confirm, still)
    if (!choice || !still()) return null
    let header: string | null = null
    try {
      header = await this.mdo.readSetHeader(choice.name)
    } catch (e) {
      console.warn('readSetHeader failed', e)
    }
    if (!still()) return null
    if (header === null) {
      this.notices.toast(`Vorlage ${choice.name} nicht gefunden.`)
      return null
    }
    return choice.profile === null ? header : withProfile(header, choice.profile)
  }

  private async chooseTemplate(
    title: string,
    confirm: string,
    still: () => boolean,
  ): Promise<TemplateChoice | null> {
    if (this.pickerOpen || this.settingsOpen || document.querySelector('dialog[open]')) return null
    this.pickerOpen = true
    try {
      const sets = await this.mdo.listSets()
      if (!still() || document.querySelector('dialog[open]')) return null
      return await pickTemplate({
        title,
        confirm,
        sets: pickerSets(sets),
        selected: DEFAULT_SET,
        header: (name) => this.mdo.readSetHeader(name),
        profiles: (name) => this.mdo.listProfiles(name),
      })
    } catch (e) {
      this.notices.panel('Vorlagen nicht lesbar', e instanceof Error ? e.message : String(e))
      return null
    } finally {
      this.pickerOpen = false
      if (this.shownId !== null) this.editor.focus()
    }
  }

  private async open(): Promise<void> {
    await this.openPaths(await this.mdo.showOpenDialog())
  }

  private async openPaths(paths: readonly string[]): Promise<void> {
    for (const p of paths) await this.openPath(p)
    this.show()
  }

  /** hideHeader: from the session entry; without one the header default applies. */
  private async openPath(path: string, hideHeader = this.headerDefaultHidden()): Promise<boolean> {
    const open = this.store.findByPath(path)
    if (open) {
      this.store.activate(this.store.all.indexOf(open))
      return true
    }
    const res = await this.mdo.readNote(path)
    if ('error' in res) {
      this.notices.panel('Nicht geöffnet', `${path}\n\n${res.error}`)
      return false
    }
    const tab = this.store.add({
      path,
      state: createState(
        res.text,
        res.eol,
        this.effectiveView(path),
        hideHeader,
        this.mode,
        this.spellcheckOn && isMarkdownTab({ path }),
        docKind(path),
      ),
      bom: res.bom,
      eol: res.eol,
      onDisk: true,
      headerHidden: hideHeader,
    })
    this.savedHashes.set(tab.id, res.hash)
    return true
  }

  /**
   * Present always shows Preview; the Code/Preview choice is kept in this.view. A YAML profile
   * is always shown as code: the rendered preview is for Markdown only.
   */
  private effectiveView(path: string): View {
    if (!isMarkdownTab({ path })) return 'code'
    return this.mode === 'present' ? 'preview' : this.view
  }

  /** Code <-> Preview for every tab; the documents are never touched. */
  private setView(view: View): void {
    if (view === this.view) return
    this.view = view
    this.reconfigureAll()
    this.outline.refresh()
    this.refresh()
    this.syncMain()
    this.editor.focus()
  }

  /**
   * Code chosen while presenting: Present ends the normal way (fullscreen included, through
   * presentToggle so it coalesces with toggles in flight), then the Code view shows. The view is
   * set first: while Present lasts effectiveView() stays Preview, and exitPresent's reconfigure
   * applies Code however long the fullscreen request takes.
   */
  private async presentToCode(): Promise<void> {
    this.setView('code')
    await this.presentToggle.set(false)
  }

  /** Menu checkbox: persisted in the settings; main switches Electron's checker and the menu tick. */
  private async toggleSpellcheck(): Promise<void> {
    const next = await this.mdo.updateSettings({ spellcheck: !this.spellcheckOn })
    this.settings = next
    this.spellcheckOn = next.spellcheck
    this.reconfigureAll()
    this.spellSwitched()
    this.editor.focus()
  }

  /**
   * After the spellcheck switch changed: off removes a pending „Wörterbuch fehlt“ notice; on
   * asks again (forced), since a notice suppressed while checking was off was never shown.
   */
  private spellSwitched(): void {
    if (this.spellcheckOn) void this.reportSpellLanguage(true)
    else this.dismissDictNotices()
  }

  /** App-initiated removal of the dictionary banners; their languages may be offered again later. */
  private dismissDictNotices(): void {
    forgetDismissedNotices(this.dictNoticed, this.notices.dismissPrefix('dict-'))
  }

  /** Applies view + mode to every tab; a cursor that would end inside a collapsed header moves out. */
  private reconfigureAll(): void {
    // Per tab: a YAML profile keeps the Code view and never gets spellchecked.
    const effects = (tab: Tab) => [
      viewCompartment.reconfigure(viewExtensions(this.effectiveView(tab.path))),
      modeCompartment.reconfigure(modeExtensions(this.mode)),
      spellcheckCompartment.reconfigure(
        spellcheckExtensions(this.spellcheckOn && isMarkdownTab(tab), this.mode),
      ),
    ]
    const collapses = (tab: Tab, state: EditorState) =>
      this.mode === 'present' ||
      (this.effectiveView(tab.path) === 'preview' && state.field(headerHidden))
    for (const tab of this.store.all) {
      const shown = tab.id === this.shownId
      const state = shown ? this.editor.state : tab.state
      const spec: TransactionSpec = {
        ...(collapses(tab, state) ? moveOutOfHeader(state) : {}),
        effects: effects(tab),
      }
      if (shown) this.editor.dispatch(spec)
      else this.store.updateState(tab.id, state.update(spec).state)
    }
  }

  private async enterPresent(): Promise<void> {
    if (this.mode === 'present' || this.shownId === null) return
    this.mode = 'present'
    this.presentOutlineWidth = null
    this.reconfigureAll()
    // Clients watch Present: no dictionary notice may stay on the shared screen.
    this.dismissDictNotices()
    document.body.classList.add('mdo-mode-present')
    this.root.tabbar.hidden = true
    this.root.status.hidden = true
    this.root.infoline.hidden = false
    this.infoLine.start()
    this.applyZoom()
    this.applyOutline()
    this.refresh()
    this.editor.focus()
    await this.fullScreenOps.run(async () => {
      try {
        await this.mdo.setFullScreen(true)
      } catch (e) {
        console.error('setFullScreen(true) failed', e)
        this.notices.toast('Vollbild nicht verfügbar')
      }
    })
  }

  /** fullScreen=false when the OS already left fullscreen (avoid a second toggle). */
  private async exitPresent(fullScreen = true): Promise<void> {
    if (this.mode !== 'present') return
    this.mode = 'edit'
    this.reconfigureAll()
    // Notices were held back during Present: ask again for the note now shown.
    void this.reportSpellLanguage(true)
    document.body.classList.remove('mdo-mode-present')
    this.root.tabbar.hidden = false
    this.root.status.hidden = false
    this.root.infoline.hidden = true
    this.infoLine.stop()
    this.applyZoom()
    this.applyOutline()
    this.refresh()
    this.editor.focus()
    await this.fullScreenOps.run(async () => {
      // Sent even for a user's own fullscreen: main keeps that and only restores the menu bar.
      if (!fullScreen) return
      try {
        await this.mdo.setFullScreen(false)
      } catch (e) {
        console.error('setFullScreen(false) failed', e)
      }
    })
  }

  /**
   * Einfügen → „Vorlage …“: for notes that came from elsewhere. The same picker as „Neu aus
   * Vorlage …“ (set, and profile when the set's header has `profile:`); the set's header is
   * merged into the note by src/core/header-merge.ts (no header → on top; else missing keys
   * appended, `template:`/`profile:` set, everything else untouched) as one undo step.
   * Afterwards a wrongly written `date:` gets a notice whose button fixes it (own undo step).
   */
  private async insertTemplate(): Promise<void> {
    const tab = this.shownId === null ? undefined : this.store.get(this.shownId)
    if (!tab) return
    if (!isMarkdownTab(tab)) {
      this.notices.toast(MARKDOWN_ONLY)
      return
    }
    // The user may switch tabs or start closing while the picker is open or main reads a file.
    const still = () => !this.closing && this.shownId === tab.id
    const choice = await this.chooseTemplate('Vorlage einfügen', 'Einfügen', still)
    if (!choice || !still()) return
    let header: string | null = null
    try {
      header = await this.mdo.readSetHeader(choice.name)
    } catch (e) {
      console.warn('readSetHeader failed', e)
    }
    if (!still()) return
    if (header === null) {
      this.notices.toast(`Vorlage ${choice.name} nicht gefunden.`)
      return
    }
    // Merged against the note as it is now: it may have changed while the picker was open.
    const state = this.editor.state
    const res = insertTemplate(state, header, { template: choice.name, profile: choice.profile })
    if (res.kind === 'unclosed') {
      this.notices.toast('Der YAML-Header der Notiz ist nicht geschlossen (---).')
      return
    }
    if (res.kind === 'unchanged') {
      this.notices.toast(`Der YAML-Header hat schon alle Schlüssel von ${choice.name}.`)
    } else {
      // A header put on top takes the cursor: a collapsed header is shown, never hiding it.
      const show =
        res.inserted && state.field(headerHidden)
          ? headerToggleSpec(state, false).effects
          : undefined
      this.editor.dispatch({ ...res.spec, effects: show })
      if (show) {
        tab.headerHidden = false
        this.syncMain()
      }
    }
    void this.offerYamlCheck(tab.id)
    this.editor.focus()
  }

  /**
   * Bearbeiten → „YAML prüfen …“: the shown note's front matter checked against the pipeline's
   * and its set's schema (src/core/frontmatter-validate.ts). No findings → a toast; else the
   * dialog, whose choice is applied as one undo step to the note as it is when the dialog
   * closes (choiceSpec validates again, so a note changed meanwhile never gets stale offsets).
   */
  private async validateYaml(): Promise<void> {
    const tab = this.shownId === null ? undefined : this.store.get(this.shownId)
    if (!tab || this.pickerOpen || this.settingsOpen) return
    if (!isMarkdownTab(tab)) {
      this.notices.toast(MARKDOWN_ONLY)
      return
    }
    // The user may switch tabs or start closing while main reads the set files.
    const still = () => !this.closing && this.shownId === tab.id
    this.pickerOpen = true
    try {
      const { ctx, set, notice } = await this.validationFor(tab)
      if (!still() || document.querySelector('dialog[open]')) return
      // Validated after the await: the text main's inputs belong to may have been typed on.
      const result = validateFrontmatter(this.editor.state.doc.toString(), ctx)
      if (result.kind === 'none') {
        this.notices.toast('Die Notiz hat keinen YAML-Header.')
        return
      }
      if (result.kind === 'unclosed') {
        this.notices.toast('Der YAML-Header der Notiz ist nicht geschlossen (---).')
        return
      }
      if (result.findings.length === 0 && result.missing.length === 0) {
        if (notice) this.notices.toast(notice)
        this.notices.toast('YAML in Ordnung')
        return
      }
      const choice = await openValidateDialog({ set, result, notice })
      if (!choice || !still()) return
      const spec = choiceSpec(this.editor.state, ctx, choice)
      if (spec) this.editor.dispatch(spec)
    } finally {
      this.pickerOpen = false
      if (this.shownId !== null) this.editor.focus()
    }
  }

  /**
   * The validator's context for a tab's note, from main's disk inputs. Never throws: when main
   * cannot answer, the note is checked against the pipeline layer alone (no set, no profile).
   * `notice` is the neutral hint for a broken set schema; `answered` is false for that fallback.
   */
  private async validationFor(
    tab: Tab,
  ): Promise<{ ctx: ValidationContext; set: string; notice: string | null; answered: boolean }> {
    const text =
      tab.id === this.shownId ? this.editor.state.doc.toString() : tab.state.doc.toString()
    const set = noteSet(text)
    const template = topLevelValue(text, 'template') ?? ''
    const profile = topLevelValue(text, 'profile') ?? ''
    // Main refuses a template that is neither a set name nor a .typ path (and over-long
    // values). Such a note is still checked: the installed sets come with the default request
    // (for the unknown-set finding), but none of the default set's files or profile lookup.
    const named = mainAccepts(template)
    try {
      const inputs = await this.mdo.validationInputs(
        tab.onDisk ? tab.path : null,
        named ? template : '',
        profile.length <= 256 ? profile : '',
      )
      const { ctx, schemaError } = validationContext(
        named ? inputs : { ...inputs, header: null, schemaText: null, profile: null },
      )
      if (schemaError !== null) console.warn(`schema of set ${set}: ${schemaError}`)
      const notice =
        schemaError === null
          ? null
          : `Das Schema des Sets ${set || 'der Vorlage'} ist fehlerhaft; geprüft wird nur gegen die Pipeline-Regeln.`
      return { ctx, set, notice, answered: true }
    } catch (e) {
      console.warn('validationInputs failed', e)
      return {
        ctx: { schema: PIPELINE_SCHEMA, sets: null, header: null, profile: null },
        set,
        notice: null,
        answered: false,
      }
    }
  }

  /**
   * Main's preview inputs for a tab's note. Not named (a `template:` main would refuse) → null,
   * the built-in look, like validationFor's rule. A failed IPC → undefined: nothing applied.
   */
  private async previewFor(id: number): Promise<PreviewInputs | null | undefined> {
    const tab = this.store.get(id)
    if (!tab) return undefined
    const text = id === this.shownId ? this.editor.state.doc.toString() : tab.state.doc.toString()
    const template = topLevelValue(text, 'template') ?? ''
    const profile = topLevelValue(text, 'profile') ?? ''
    if (!mainAccepts(template)) return null
    try {
      return await this.mdo.previewInputs(
        tab.onDisk ? tab.path : null,
        template,
        profile.length <= 256 ? profile : '',
      )
    } catch (e) {
      console.warn('previewInputs failed', e)
      return undefined
    }
  }

  /** Puts a tab's preview inputs into its state and, when shown, its set's scope on #editor. */
  private applyPreview(id: number, inputs: PreviewInputs | null): void {
    const tab = this.store.get(id)
    if (!tab) return
    const { source, problem } = previewSourceFrom(inputs)
    if (problem !== null && source && !this.previewNoticed.has(source.set)) {
      this.previewNoticed.add(source.set)
      this.notices.toast(problem)
    }
    if (inputs?.set) {
      try {
        this.setStyles.load(inputs.set, inputs.css)
      } catch (e) {
        // A broken set never throws into the editor: its rules stay out, the blocks still apply.
        console.warn(`styles of set ${inputs.set} not loaded`, e)
      }
    }
    const effects = setPreviewSource.of(source)
    if (id === this.shownId) {
      this.editor.dispatch({ effects })
      this.showSet(source?.set ?? null)
    } else this.store.updateState(id, tab.state.update({ effects }).state)
  }

  /** The set scope on #editor; an unexpected name falls back to no scope instead of throwing. */
  private showSet(set: string | null): void {
    try {
      this.setStyles.show(set)
    } catch (e) {
      console.warn(`set ${set} not shown`, e)
      this.setStyles.show(null)
    }
    // Another set (or its reloaded CSS) may bring another body font: measure its space again.
    this.spaceAdvance.update().catch((e) => console.warn('space advance not measured', e))
  }

  /**
   * The silent YAML check after an export's save or a template insert: only errors (what the
   * pipeline or the set would ignore, misread or fail on) raise a banner; the export itself
   * never waits for it. „Prüfen …“ opens the dialog of that tab when it is shown, else it
   * switches to the tab first (`activate` is synchronous), so the dialog never checks another
   * note than the banner counted. Any failure is only logged: a check must not disturb work.
   */
  private async offerYamlCheck(tabId: number): Promise<void> {
    try {
      const tab = this.store.get(tabId)
      if (!tab || !isMarkdownTab(tab) || this.closing) return
      const { ctx } = await this.validationFor(tab)
      const live = this.store.get(tabId)
      if (!live || this.closing) return
      const text =
        live.id === this.shownId ? this.editor.state.doc.toString() : live.state.doc.toString()
      const result = validateFrontmatter(text, ctx)
      const n = errorCount(result)
      if (n === 0) return
      this.notices.banner(
        `YAML hat ${n === 1 ? '1 Fehler' : `${n} Fehler`}`,
        [
          {
            label: 'Prüfen …',
            run: () => {
              const index = this.store.all.findIndex((t) => t.id === tabId)
              if (index < 0 || this.closing) return
              if (this.shownId !== tabId) this.activate(index)
              void this.validateYaml()
            },
          },
          { label: 'Schließen', run: () => undefined },
        ],
        `yaml:${tabId}`,
      )
    } catch (e) {
      console.warn('YAML check failed', e)
    }
  }

  private toggleHeader(): void {
    const tab = this.shownId === null ? undefined : this.store.get(this.shownId)
    if (!tab) return
    if (!isMarkdownTab(tab)) {
      this.notices.toast(MARKDOWN_ONLY)
      return
    }
    if (this.view !== 'preview') {
      this.notices.toast('Der YAML-Header lässt sich nur in der Preview ausblenden.')
      return
    }
    const hide = !this.editor.state.field(headerHidden)
    this.editor.dispatch(headerToggleSpec(this.editor.state, hide))
    tab.headerHidden = hide
    this.syncMain()
    this.refresh()
    this.editor.focus()
  }

  /** Outline on/off for the current mode; allowed in Present too. */
  private toggleOutline(): void {
    this.outlineOn[this.mode] = !this.outlineOn[this.mode]
    this.applyOutline()
    this.mdo
      .saveSession({ outline: { ...this.outlineOn } })
      .catch((e: unknown) => console.error('saveSession(outline) failed', e))
    this.refresh()
    this.editor.focus()
  }

  /**
   * Shown when enabled for the current mode and a tab is shown. The width can be dragged in
   * Edit mode only; Present always switches to the default width (the grip is hidden there).
   */
  private applyOutline(): void {
    const visible = this.outlineOn[this.mode] && this.shownId !== null
    this.outline.setVisible(visible)
    this.root.outlineGrip.hidden = !visible
    const width = this.mode === 'edit' ? this.outlineWidth : this.presentOutlineWidth
    applyOutlineWidth(this.root.outline, width)
    this.root.outlineGrip.setAttribute('aria-valuenow', String(Math.round(width ?? 18)))
    this.outline.refresh()
  }

  /** discard: the user already chose to drop unsaved content (no save, no prompt). */
  private async closeTab(id: number, discard = false): Promise<void> {
    const tab = this.store.get(id)
    if (!tab) return
    // A banner's „Tab schließen“ (discard) is the user's explicit choice and stays allowed.
    if (this.closing && !discard) return
    if (!discard) {
      let saved = true
      for (let i = 0; i < MAX_SAVE_ROUNDS && this.unsaved(tab); i++) {
        saved = await this.saveTab(tab)
        if (!saved) break
      }
      if (!saved || this.unsaved(tab)) {
        if (!(await this.mdo.confirmDiscard([fileName(tab.path)]))) return
      }
    }
    if (!tab.onDisk) {
      try {
        await this.mdo.releasePath(tab.path)
      } catch {
        // closing must not be blocked by a failed release
      }
    }
    this.store.close(id)
    this.notices.dismiss(bannerKey(id))
    this.saveErrors.delete(id)
    this.conflicts.delete(id)
    this.unwritten.delete(id)
    this.holdWarnings.delete(id)
    this.savedHashes.delete(id)
    this.overwrite.delete(id)
    this.saving.delete(id)
    this.setCheck.forget(id)
    this.setPreview.forget(id)
    // Present never shows the empty state.
    if (this.mode === 'present' && this.store.all.length === 0) await this.exitPresent()
    this.show()
  }

  private async rename(): Promise<void> {
    const tab = this.store.active
    if (!tab) return
    const name = await askText('Umbenennen', 'Neuer Dateiname', fileName(tab.path))
    // A dialog answered after the window started closing must not move the file under it.
    if (!name || this.closing) return
    if (!(await this.saveTab(tab, true))) {
      this.notices.panel(
        'Umbenennen nicht möglich',
        `Die Notiz konnte nicht gespeichert werden:\n${this.saveErrors.get(tab.id) ?? ''}`,
      )
      return
    }
    // Inside the tab's save chain, so an autosave cannot interleave with the rename.
    const prev = this.saving.get(tab.id) ?? Promise.resolve(true)
    const renamed = prev.then(async () => {
      try {
        const r = await this.mdo.renameNote(tab.path, name)
        // Switch the path inside the chain: queued saves must target the new file.
        if (r.ok) this.store.setPath(tab.id, r.path)
        return r
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
      }
    })
    this.saving.set(
      tab.id,
      renamed.then(() => true),
    )
    const res = await renamed
    if (!res.ok) {
      this.notices.panel('Umbenennen nicht möglich', res.error)
      return
    }
    this.show()
  }

  /**
   * „Im Finder zeigen“ for the active note. A new note has no file until its first save, so it
   * is saved first (like rename and export); otherwise the file manager would have nothing to show.
   */
  private async reveal(): Promise<void> {
    const tab = this.store.active
    if (!tab) return
    if (!(await this.saveTab(tab, true))) {
      this.notices.panel(
        'Anzeigen nicht möglich',
        `Die Notiz konnte nicht gespeichert werden:\n${this.saveErrors.get(tab.id) ?? ''}`,
      )
      return
    }
    try {
      const error = await this.mdo.revealPath(tab.path)
      if (error) this.notices.panel('Anzeigen nicht möglich', error)
    } catch (e) {
      this.notices.panel('Anzeigen nicht möglich', e instanceof Error ? e.message : String(e))
    }
  }

  /** Context menu of a note; a right click on another tab selects that tab first. */
  private async noteMenu(index?: number): Promise<void> {
    if (this.closing) return
    if (index !== undefined && index !== this.store.activeIndex) this.activate(index)
    if (!this.store.active) return
    await this.mdo.showNoteMenu()
  }

  private async exportPdf(): Promise<void> {
    const tab = this.store.active
    if (!tab || this.status.exporting) return
    // The pipeline converts Markdown; a profile tab would only fail there with a cryptic error.
    if (!isMarkdownTab(tab)) {
      this.notices.toast('Nur Markdown-Notizen lassen sich exportieren.')
      return
    }
    this.status.setExporting(true)
    try {
      if (!(await this.saveTab(tab, true))) {
        this.notices.panel(
          'Export abgebrochen',
          `Die Notiz konnte nicht gespeichert werden:\n${this.saveErrors.get(tab.id) ?? ''}`,
        )
        return
      }
      void this.offerYamlCheck(tab.id)
      this.showExport(await this.mdo.exportPdf(tab.path))
    } catch (e) {
      this.notices.panel('Export fehlgeschlagen', e instanceof Error ? e.message : String(e))
    } finally {
      this.status.setExporting(false)
    }
  }

  private showExport(r: ExportResult): void {
    if (r.kind === 'ok') this.notices.toast(r.message)
    else this.notices.panel('Export fehlgeschlagen', r.stderr)
  }

  // ── saving ──────────────────────────────────────────────────────────────

  /** force: also create a new note's file when it is still empty (rename, export). */
  private saveTab(tab: Tab, force = false): Promise<boolean> {
    // Chain per tab so forced saves never overlap an autosave of the same tab.
    const prev = this.saving.get(tab.id) ?? Promise.resolve(true)
    const next = prev.then(() => this.writeTab(tab, force))
    this.saving.set(
      tab.id,
      next.catch(() => false),
    )
    return next
  }

  private async writeTab(tab: Tab, force: boolean): Promise<boolean> {
    if (!this.unsaved(tab) && (tab.onDisk || !force)) return true
    if (this.conflicts.has(tab.id)) {
      if (!this.saveErrors.has(tab.id)) this.saveErrors.set(tab.id, CONFLICT_ERROR)
      this.refresh()
      return false
    }
    const doc = tab.state.doc
    let res: Awaited<ReturnType<typeof this.mdo.saveNote>>
    try {
      // Main writes only over the base (or our own newer write) unless the user chose to
      // overwrite: an external change inside the watcher's debounce is never replaced silently.
      res = await this.mdo.saveNote(
        tab.path,
        serializeDoc(doc, tab.eol),
        tab.bom,
        this.savedHashes.get(tab.id) ?? null,
        this.overwrite.has(tab.id),
      )
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!res.ok) {
      if ('conflict' in res) {
        // Follow a case-only rename outside first, so the conflict finds this tab.
        if (res.path !== undefined && res.path !== tab.path) {
          this.store.setPath(tab.id, res.path)
          this.syncMain()
        }
        this.externalChange(res.conflict)
      } else this.saveErrors.set(tab.id, res.error)
      this.refresh()
      return false
    }
    // A case-only rename outside (a.md → A.md): the tab follows the file's new spelling.
    const moved = res.path !== undefined && res.path !== tab.path
    if (moved && res.path) this.store.setPath(tab.id, res.path)
    const firstSave = !tab.onDisk
    this.store.markSaved(tab.id, doc)
    this.savedHashes.set(tab.id, res.hash)
    this.overwrite.delete(tab.id)
    this.unwritten.delete(tab.id)
    this.saveErrors.delete(tab.id)
    if (firstSave || moved) this.syncMain()
    this.refresh()
    return true
  }

  private async saveAll(): Promise<boolean> {
    let ok = true
    for (const tab of [...this.store.all]) {
      if (!(await this.saveTab(tab))) ok = false
    }
    return ok
  }

  /**
   * Input is frozen first, so saving converges: every keystroke is on disk or the user agreed
   * to discard it. A held tab cannot be saved and always reaches the prompt. A second close
   * request while one runs gets the same answer.
   */
  private beforeClose(): Promise<boolean> {
    if (this.closing) return this.closing
    const run = closeWindow({
      freeze: () => this.freezeInput(true),
      unfreeze: () => this.freezeInput(false),
      flush: () => this.autosave.flush(),
      saveAll: () => this.saveAll(),
      pending: () => this.store.all.filter((t) => this.unsaved(t)).map((t) => fileName(t.path)),
      persist: () => this.persistSession(),
      confirmDiscard: (names) => this.mdo.confirmDiscard(names),
    })
    this.closing = run
    // The window stays open after a cancel or an error: accept input and closes again.
    run.then(
      (ok) => {
        if (!ok) this.closing = null
      },
      () => {
        this.closing = null
      },
    )
    return run
  }

  /**
   * Freezes or thaws input in every tab: the shown view and the stored states.
   * IME: text an input method is still composing at the freeze is saved as CodeMirror already
   * mirrored it into the state (possibly the unconverted pre-edit text); the later commit and
   * any keystroke whose DOM change was not read yet are dropped. Both stay "up to the freeze".
   */
  private freezeInput(frozen: boolean): void {
    if (frozen) closeCompletion(this.editor)
    const spec = freezeSpec(frozen)
    for (const tab of this.store.all) {
      if (tab.id === this.shownId) this.editor.dispatch(spec)
      else this.store.updateState(tab.id, tab.state.update(spec).state)
    }
    if (!frozen && this.shownId !== null) this.editor.focus()
  }

  /** A state shown while closing (new tab, reload) is frozen like the others. */
  private closingState(state: EditorState): EditorState {
    return this.closing && !isFrozen(state) ? state.update(freezeSpec(true)).state : state
  }

  // ── external changes ────────────────────────────────────────────────────

  /**
   * Dirty, or clean but its content is no longer on disk. A note that never reached the disk and
   * is empty again is not worth a file: a Mod+N note starts with the memo header as its clean
   * text, so deleting that header must not leave an empty file behind (an explicit save still
   * creates it, see writeTab's `force`).
   */
  private unsaved(tab: Tab): boolean {
    if (!tab.onDisk && tab.state.doc.length === 0) return this.unwritten.has(tab.id)
    return this.store.isDirty(tab) || this.unwritten.has(tab.id)
  }

  private externalChange(change: ExternalChange): void {
    const changed = this.store.findByPath(
      change.kind === 'changed' ? change.note.path : change.path,
    )
    // A new external state needs a new decision before anything overwrites it.
    if (changed) this.overwrite.delete(changed.id)
    if (change.kind !== 'changed') {
      this.holdUnloadable(change)
      return
    }
    const note = change.note
    const tab = this.store.findByPath(note.path)
    if (!tab) return
    if (note.hash === this.savedHashes.get(tab.id)) {
      // Our own last saved bytes are back (after a deletion or a read error): nothing changed
      // externally, so only lift the hold; unsaved typing is autosaved as usual.
      if (this.unwritten.delete(tab.id)) {
        this.clearConflict(tab.id)
        this.notices.dismiss(bannerKey(tab.id))
        this.refresh()
        this.autosave.touch()
      }
      return
    }
    // Readable content is back on disk: the normal conflict/reload logic replaces any hold.
    this.unwritten.delete(tab.id)
    this.holdWarnings.delete(tab.id)
    if (!this.store.isDirty(tab)) {
      this.notices.dismiss(bannerKey(tab.id))
      this.clearConflict(tab.id)
      this.reload(tab, note)
      return
    }
    this.conflicts.add(tab.id)
    this.saveErrors.set(tab.id, CONFLICT_ERROR)
    this.refresh()
    this.notices.banner(
      `„${fileName(note.path)}“ wurde außerhalb von Markdown Office geändert.`,
      [
        {
          label: 'Neu laden (meine Änderungen verwerfen)',
          run: () => void this.reloadFromDisk(tab),
        },
        {
          label: 'Meine behalten',
          run: () => {
            this.clearConflict(tab.id)
            this.overwrite.add(tab.id)
            // The disk holds the outside version: write this tab even if it is clean again
            // (e.g. undone back to the last saved text).
            this.unwritten.add(tab.id)
            this.refresh()
            this.autosave.touch()
          },
        },
      ],
      bannerKey(tab.id),
    )
  }

  /** Holds the tab like a conflict, dirty or not: autosave must not write over this state. */
  private holdUnloadable(change: Exclude<ExternalChange, { kind: 'changed' }>): void {
    const tab = this.store.findByPath(change.path)
    if (!tab) return
    const name = fileName(change.path)
    let message: string
    let saveLabel: string
    if (change.kind === 'deleted') {
      message = `„${name}“ wurde außerhalb gelöscht.`
      saveLabel = 'Erneut speichern'
    } else {
      if (change.reason === 'encoding') {
        message = `„${name}“ wurde außerhalb geändert und ist kein gültiges UTF-8. Markdown Office speichert nicht darüber.`
      } else {
        message = `„${name}“ kann nicht mehr gelesen werden. Markdown Office speichert nicht darüber.`
        console.error(`${change.path}: ${change.message}`)
      }
      saveLabel = 'Meine Fassung speichern (überschreiben)'
    }
    this.conflicts.add(tab.id)
    this.unwritten.add(tab.id)
    const warning = change.kind === 'deleted' ? DELETED_ERROR : UNREADABLE_ERROR
    this.holdWarnings.set(tab.id, warning)
    this.saveErrors.set(tab.id, warning)
    this.refresh()
    this.notices.banner(
      message,
      [
        {
          label: saveLabel,
          run: () => {
            this.clearConflict(tab.id)
            this.overwrite.add(tab.id)
            this.refresh()
            void this.saveTab(tab)
          },
        },
        { label: 'Tab schließen', run: () => void this.closeTab(tab.id, true) },
      ],
      bannerKey(tab.id),
      change.kind === 'unreadable' && change.reason === 'error' ? change.message : undefined,
    )
  }

  private clearConflict(id: number): void {
    this.holdWarnings.delete(id)
    this.conflicts.delete(id)
    this.saveErrors.delete(id)
  }

  private async reloadFromDisk(tab: Tab): Promise<void> {
    const res = await this.mdo.readNote(tab.path)
    if ('error' in res) {
      this.notices.panel('Neu laden nicht möglich', `${tab.path}\n\n${res.error}`)
      return
    }
    this.clearConflict(tab.id)
    this.reload(tab, res)
  }

  private reload(tab: Tab, note: NoteFile): void {
    // The old set description stays until main answers for the new text, so a din5008a note
    // does not flash the memo look (blocks and scope) for one round trip.
    const source = tab.state.field(previewSource, false) ?? null
    const state = this.closingState(
      createState(
        note.text,
        note.eol,
        this.effectiveView(tab.path),
        tab.headerHidden,
        this.mode,
        this.spellcheckOn && isMarkdownTab(tab),
        docKind(tab.path),
      ).update({ effects: setPreviewSource.of(source) }).state,
    )
    const wasOnDisk = tab.onDisk
    tab.bom = note.bom
    tab.eol = note.eol
    this.savedHashes.set(tab.id, note.hash)
    this.unwritten.delete(tab.id)
    this.store.updateState(tab.id, state)
    this.store.markSaved(tab.id, state.doc)
    if (this.shownId === tab.id) {
      this.editor.setState(state)
      this.outline.invalidate()
      // setState bypasses dispatchTransactions, which schedules the check after edits.
      void this.setCheck.now(tab.id)
    }
    // The new text may name another set or profile, and the set's files may have changed too:
    // ask main again (fresh); a hidden tab asks on its next show (forgotten key).
    this.setPreview.forget(tab.id)
    if (this.shownId === tab.id) {
      this.showSet(source?.set ?? null)
      void this.setPreview.now(tab.id, true)
    }
    // A new note whose path a file took meanwhile (refused first save) is now watched.
    if (!wasOnDisk) this.syncMain()
    this.refresh()
  }

  // ── rendering ───────────────────────────────────────────────────────────

  private show(): void {
    const tab = this.store.active
    this.root.empty.hidden = tab !== null
    this.root.editor.hidden = tab === null
    if (tab && tab.id !== this.shownId) {
      // Close an open snippet list in the tab being left (routed to shownId), so it does not
      // reappear there later and a stray Enter inserts a snippet typed long ago.
      if (this.shownId !== null) closeCompletion(this.editor)
      const state = this.closingState(tab.state)
      if (state !== tab.state) this.store.updateState(tab.id, state)
      // The tab's own set scope before it paints (null until its inputs arrive).
      this.showSet(state.field(previewSource, false)?.set ?? null)
      this.editor.setState(state)
      this.editor.focus()
      this.outline.invalidate()
      // The last tab's set must not stay while main reads this one's inputs (a cache hit
      // repaints in the same tick, so there is no flicker).
      this.status.renderSet(null)
    }
    this.shownId = tab?.id ?? null
    void this.reportSpellLanguage(false)
    // On opening and switching (cached inputs unless path, template: or profile: changed).
    if (this.shownId === null) {
      this.setCheck.cancel()
      this.setPreview.cancel()
      this.showSet(null)
      this.status.renderSet(null)
    } else {
      void this.setCheck.now(this.shownId)
      void this.setPreview.now(this.shownId)
    }
    this.applyOutline()
    this.refresh()
    this.syncMain()
  }

  /**
   * Tells main the shown note's lang: (only when it changed, or when `force`) and offers a
   * missing dictionary once per language and session.
   */
  private async reportSpellLanguage(force: boolean): Promise<void> {
    if (this.shownId === null) return
    const lang = frontmatterFields(this.editor.state.doc).lang ?? ''
    if (force) this.spellLang.reset()
    if (!this.spellLang.next(lang)) return
    const asked = { id: this.shownId, lang }
    let r: Awaited<ReturnType<typeof this.mdo.setSpellLanguage>>
    try {
      r = await this.mdo.setSpellLanguage(lang)
    } catch (err) {
      // The value was stored by the tracker: forget it so the next report retries.
      console.warn('spellcheck: language could not be set', err)
      this.spellLang.reset()
      return
    }
    // A quick tab switch or lang: edit made this answer stale; the newer request brings its own.
    const now = {
      id: this.shownId,
      lang: frontmatterFields(this.editor.state.doc).lang ?? '',
    }
    if (!spellAnswerCurrent(asked, now)) return
    // Never in Present (shared screen) or with checking off; exitPresent and switching on
    // report again (forced), so the notice is not lost. Checked after the await: the mode may
    // have changed while main answered.
    if (!offerDictionaryNotice(this.spellcheckOn, this.mode)) return
    if (!r?.missing || this.dictNoticed.has(r.missing.code)) return
    const { code, name } = r.missing
    this.dictNoticed.add(code)
    this.notices.banner(
      `Wörterbuch für ${name} fehlt – laden?`,
      [
        {
          label: 'Laden',
          run: () =>
            void this.mdo.downloadDictionary(code).then((ok) => {
              if (ok) void this.reportSpellLanguage(true)
              else this.notices.toast('Wörterbuch konnte nicht geladen werden')
            }),
        },
        { label: 'Nicht mehr fragen', run: () => void this.mdo.declineDictionary(code) },
      ],
      `dict-${code}`,
    )
  }

  private refresh(): void {
    const tab = this.store.active
    this.tabBar.render(this.store.all, this.store.activeIndex, (t) => this.unsaved(t))
    const hold = tab ? (this.holdWarnings.get(tab.id) ?? null) : null
    const error = hold ?? (tab ? (this.saveErrors.get(tab.id) ?? null) : null)
    let state: SaveState = 'saved'
    if (hold) state = 'held'
    else if (error) state = 'error'
    else if (tab && this.store.isDirty(tab)) state = 'dirty'
    else if (tab && !tab.onDisk) state = 'new'
    const doc = this.shownId === null ? null : this.editor.state
    const md = tab === null || isMarkdownTab(tab)
    this.status.render(tab ? fileName(tab.path) : null, state, error, md ? this.view : 'code', {
      outline: this.outlineOn.edit,
      hasHeader: md && doc !== null && frontmatterRange(doc.doc) !== null,
      yamlOn: doc !== null && !doc.field(headerHidden),
    })
    document.title = tab
      ? `${fileName(tab.path)}${state === 'dirty' ? ' •' : ''} – Markdown Office`
      : 'Markdown Office'
    if (this.mode === 'present') {
      this.infoLine.render(
        this.store.all.map((t) => ({ name: fileName(t.path), dirty: this.unsaved(t) })),
        this.store.activeIndex,
        saveText(state, error),
        this.zoom.present,
      )
    }
  }

  /** Tells main which files to watch and schedules a session write. */
  private syncMain(): void {
    void this.mdo.watch(this.store.all.filter((t) => t.onDisk).map((t) => t.path))
    if (this.sessionTimer) clearTimeout(this.sessionTimer)
    this.sessionTimer = setTimeout(() => void this.persistSession(), 300)
  }

  private async persistSession(): Promise<void> {
    if (this.sessionTimer) clearTimeout(this.sessionTimer)
    this.sessionTimer = null
    const tabs = this.store.toSession()
    const activePath = this.store.active?.path
    const activeIndex = Math.max(
      0,
      tabs.findIndex((t) => t.path === activePath),
    )
    await this.mdo.saveSession({
      tabs,
      activeIndex,
      view: this.view,
      zoom: this.zoom,
      outline: { ...this.outlineOn },
    })
  }
}
