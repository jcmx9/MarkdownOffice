import type {
  ChooseKind,
  DefaultAppResult,
  DefaultAppStatus,
  HeaderDefault,
  Settings,
  SettingsPatch,
  SettingsStatus,
  UpdateResult,
} from '../../shared/types'

export interface SettingsDialogDeps {
  settings: Settings
  /** Resolves while the dialog is open; the status block says so until then. */
  status: Promise<SettingsStatus>
  choose(kind: ChooseKind, current: string): Promise<string | null>
  /** „Vorlagen-Ordner öffnen“: main opens (and creates) it; null = opened, else the message. */
  openTemplatesFolder(): Promise<string | null>
  /** `process.platform` value; macOS uses the system spellchecker and has no update controls. */
  platform: NodeJS.Platform | string
  /** „Jetzt prüfen“: asks main to look for dictionary updates. */
  checkDictionaries(): Promise<UpdateResult>
  /** The user's own words. */
  words(): Promise<string[]>
  removeWord(word: string): Promise<boolean>
  /** Whether this app opens `.md` files by default. */
  defaultAppStatus(): Promise<DefaultAppStatus>
  /** „Als Standard für Markdown festlegen“. */
  makeDefaultApp(): Promise<DefaultAppResult>
}

/** The status line of the „Standardprogramm“ block. */
export function defaultAppText(s: DefaultAppStatus): string {
  switch (s.state) {
    case 'default':
      return 'Markdown-Dateien (.md) öffnen mit Markdown Office.'
    case 'other':
      return 'Markdown-Dateien (.md) öffnet ein anderes Programm.'
    case 'unknown':
      return 'Nicht feststellbar, welches Programm Markdown-Dateien öffnet.'
  }
}

export const MAC_SPELL_HINT =
  'Sprachen und Wörterbücher verwaltet macOS: Systemeinstellungen → Tastatur → Texteingabe'

/** The status line after „Jetzt prüfen“. */
export function updateResultText(r: UpdateResult): string {
  switch (r.kind) {
    case 'current':
      return 'Wörterbücher aktuell'
    case 'updated':
      // Staged files replace open dictionaries only at the next start (Windows locks them).
      return r.pending
        ? `Aktualisiert auf ${r.version} – aktiv nach Neustart`
        : `Aktualisiert auf ${r.version}`
    case 'skipped':
      return 'Prüfung übersprungen'
    case 'failed':
      return `Prüfung fehlgeschlagen: ${r.reason}`
  }
}

const FACTOR_MIN = 1
const FACTOR_MAX = 3
const FACTOR_ERROR = 'Schriftfaktor: bitte eine Zahl von 1.0 bis 3.0 angeben.'

/** Present font factor from the input; accepts a German decimal comma. Null when invalid. */
export function parseFactor(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return n >= FACTOR_MIN && n <= FACTOR_MAX ? n : null
}

/** POSIX, drive-letter or UNC path; the renderer has no `path` module. */
export function isAbsolutePath(p: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p)
}

/** The read-only pipeline line, e.g. „Pipeline: Markdown Office 26.10.0, Typst 0.15.0“. */
export function pipelineLine(s: SettingsStatus): string {
  return `Pipeline: Markdown Office ${s.version}, ${s.typst ? `Typst ${s.typst}` : 'Typst nicht gefunden'}`
}

/** The status block gives up after this long (a hanging `typst --version`). */
export const STATUS_TIMEOUT_MS = 15_000

export class StatusTimeout extends Error {
  constructor(readonly ms: number) {
    super(`keine Antwort nach ${Math.round(ms / 1000)} s`)
  }
}

/** Rejects with StatusTimeout unless `promise` settles within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StatusTimeout(ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

interface PathField {
  key: 'defaultFolder' | 'snippetFolder'
  testid: string
  label: string
  kind: ChooseKind
}

const PATH_FIELDS: readonly PathField[] = [
  {
    key: 'defaultFolder',
    testid: 'default-folder',
    label: 'Standardordner für neue Notizen',
    kind: 'folder',
  },
  {
    key: 'snippetFolder',
    testid: 'snippet-folder',
    label: 'Snippet-Ordner',
    kind: 'folder',
  },
]

const DROP_REASONS: Record<keyof Settings, string> = {
  defaultFolder: 'kein gültiger absoluter Pfad',
  snippetFolder: 'kein gültiger absoluter Pfad',
  presentFontFactor: 'ungültiger Wert',
  headerDefault: 'ungültiger Wert',
  // The spellcheck switches are booleans; main rejects anything else.
  spellcheck: 'ungültiger Wert',
  dictionaryAutoUpdate: 'ungültiger Wert',
  appUpdateCheck: 'ungültiger Wert',
}

const FACTOR_LABEL = 'Schriftfaktor im Präsentationsmodus'

const FIELD_LABELS: Record<keyof Settings, string> = {
  ...(Object.fromEntries(PATH_FIELDS.map((f) => [f.key, f.label])) as Record<
    PathField['key'],
    string
  >),
  presentFontFactor: FACTOR_LABEL,
  headerDefault: 'YAML-Header in der Vorschau',
  // Labels for the spellcheck switches, so a refused value is named in the dialog's notice.
  spellcheck: 'Rechtschreibprüfung',
  dictionaryAutoUpdate: 'Wörterbücher automatisch aktualisieren',
  appUpdateCheck: 'Nach Updates suchen',
}

/**
 * The dialog's values that main refused (it keeps the current one instead), as
 * "<label>: <reason>" lines in dialog order. Empty when everything was stored.
 */
export function droppedFields(patch: SettingsPatch, saved: Settings): string[] {
  return (Object.keys(FIELD_LABELS) as (keyof Settings)[])
    .filter((key) => patch[key] !== undefined && patch[key] !== saved[key])
    .map((key) => `${FIELD_LABELS[key]}: ${DROP_REASONS[key]}`)
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  testid?: string,
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  if (testid) node.setAttribute('data-testid', testid)
  return node
}

/**
 * Modal settings dialog (same look as the rename prompt). Resolves to the changed values, or
 * null on Abbrechen/Esc. Enter saves. Invalid input keeps the dialog open with a message;
 * main validates again before anything is stored.
 */
export function openSettings(deps: SettingsDialogDeps): Promise<SettingsPatch | null> {
  const { settings } = deps
  return new Promise((resolve) => {
    const dialog = el('dialog', { className: 'prompt settings' })
    // Own validation with German messages; native validation would silently refuse e.g. 2.2
    // (step mismatch from floating point) without a submit event.
    const form = el('form', { noValidate: true })
    const inputs = new Map<PathField['key'], HTMLInputElement>()
    const rows: HTMLElement[] = []

    for (const f of PATH_FIELDS) {
      const input = el(
        'input',
        { type: 'text', value: settings[f.key], spellcheck: false },
        `settings-${f.testid}`,
      )
      input.setAttribute('aria-label', f.label)
      inputs.set(f.key, input)
      const choose = el(
        'button',
        { type: 'button', textContent: 'Wählen …' },
        `settings-choose-${f.testid}`,
      )
      choose.addEventListener('click', () => {
        void deps.choose(f.kind, input.value.trim()).then((picked) => {
          if (picked) input.value = picked
        })
      })
      const row = el('div', { className: 'settings-path' })
      row.append(input, choose)
      const label = el('label', { textContent: f.label })
      label.append(row)
      rows.push(label)
    }

    // User sets live in a fixed folder (~/Documents/Markdown Office/Vorlagen) that has no path
    // field: this button is the way to find it. A failure shows next to the button, the dialog
    // stays usable.
    const templates = el(
      'button',
      { type: 'button', textContent: 'Vorlagen-Ordner öffnen' },
      'settings-open-templates',
    )
    const templatesStatus = el('span', { className: 'settings-hint' }, 'settings-templates-status')
    templatesStatus.setAttribute('role', 'status')
    templates.addEventListener('click', () => {
      templatesStatus.textContent = ''
      deps.openTemplatesFolder().then(
        (err) => {
          templatesStatus.textContent = err ?? ''
        },
        (e: unknown) => {
          templatesStatus.textContent = `Vorlagen-Ordner nicht geöffnet: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`
        },
      )
    })
    const templatesRow = el('div', { className: 'settings-path' })
    templatesRow.append(templates, templatesStatus)
    rows.push(templatesRow)

    const factor = el(
      'input',
      { type: 'number', value: String(settings.presentFontFactor) },
      'settings-factor',
    )
    factor.min = String(FACTOR_MIN)
    factor.max = String(FACTOR_MAX)
    factor.step = '0.1'
    const factorLabel = el('label', { textContent: FACTOR_LABEL })
    factorLabel.append(factor)

    const header = el('fieldset', { className: 'settings-header' })
    header.append(el('legend', { textContent: 'YAML-Header in der Vorschau:' }))
    const radios = new Map<HeaderDefault, HTMLInputElement>()
    for (const [value, text] of [
      ['yaml', 'als YAML'],
      ['titleblock', 'als Titelblock'],
    ] as const) {
      const radio = el(
        'input',
        { type: 'radio', name: 'headerDefault', value, checked: settings.headerDefault === value },
        `settings-header-${value}`,
      )
      radios.set(value, radio)
      const label = el('label', { className: 'settings-radio' })
      label.append(radio, ` ${text}`)
      header.append(label)
    }

    // Spell checking: switches, update check (Windows/Linux only) and own words.
    const spell = el('fieldset', { className: 'settings-spell' })
    spell.append(el('legend', { textContent: 'Rechtschreibung' }))
    const checkbox = (testid: string, text: string, checked: boolean) => {
      const box = el('input', { type: 'checkbox', checked }, testid)
      const label = el('label', { className: 'settings-radio' })
      label.append(box, ` ${text}`)
      spell.append(label)
      return box
    }
    const spellBox = checkbox('set-spellcheck', 'Rechtschreibprüfung', settings.spellcheck)
    let autoBox: HTMLInputElement | null = null
    if (deps.platform === 'darwin') {
      spell.append(
        el('p', { className: 'settings-hint', textContent: MAC_SPELL_HINT }, 'set-mac-spell-hint'),
      )
    } else {
      autoBox = checkbox(
        'set-dict-auto',
        'Wörterbücher automatisch aktualisieren',
        settings.dictionaryAutoUpdate,
      )
      const check = el('button', { type: 'button', textContent: 'Jetzt prüfen' }, 'set-dict-check')
      const dictStatus = el('span', { className: 'settings-hint' }, 'set-dict-status')
      dictStatus.setAttribute('role', 'status')
      check.addEventListener('click', () => {
        check.disabled = true
        dictStatus.textContent = 'Prüfe …'
        deps
          .checkDictionaries()
          .then(
            (r) => {
              dictStatus.textContent = updateResultText(r)
            },
            (e: unknown) => {
              dictStatus.textContent = `Prüfung fehlgeschlagen: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`
            },
          )
          .finally(() => {
            check.disabled = false
          })
      })
      const row = el('div', { className: 'settings-path' })
      row.append(check, dictStatus)
      spell.append(row)
    }
    const words = el('ul', { className: 'settings-words' }, 'set-words')
    const addWordRow = (word: string, i: number) => {
      const item = el('li')
      const remove = el(
        'button',
        { type: 'button', textContent: 'Entfernen' },
        `set-word-remove-${i}`,
      )
      remove.setAttribute('aria-label', `${word} entfernen`)
      remove.addEventListener('click', () => {
        remove.disabled = true
        deps.removeWord(word).then(
          (ok) => {
            if (ok) item.remove()
            else remove.disabled = false
          },
          () => {
            remove.disabled = false
          },
        )
      })
      item.append(el('span', { textContent: word }), ' ', remove)
      words.append(item)
    }
    spell.append(el('h3', { textContent: 'Eigene Wörter' }), words)
    // A failed read leaves the list empty; the rest of the dialog still works.
    deps.words().then(
      (list) => list.forEach(addWordRow),
      () => undefined,
    )

    // App updates: the start looks for a newer release (at most once a day, app-update.ts);
    // the menu's „Nach Updates suchen …“ always works.
    const updates = el('fieldset', { className: 'settings-updates' })
    updates.append(el('legend', { textContent: 'Updates' }))
    const updateBox = el(
      'input',
      { type: 'checkbox', checked: settings.appUpdateCheck },
      'set-app-update',
    )
    const updateLabel = el('label', { className: 'settings-radio' })
    updateLabel.append(updateBox, ' Nach Updates suchen')
    updates.append(updateLabel)

    // Default program for .md: status, and a button where this app is not (yet) the default.
    // Windows only lets the user pick in its settings; the button opens them (default-app.ts).
    const defaultApp = el('fieldset', { className: 'settings-default-app' })
    defaultApp.append(el('legend', { textContent: 'Standardprogramm' }))
    const defaultText = el(
      'p',
      { className: 'settings-hint', textContent: 'Wird geprüft …' },
      'set-default-app-status',
    )
    defaultText.setAttribute('role', 'status')
    const makeDefault = el(
      'button',
      { type: 'button', textContent: 'Als Standard für Markdown festlegen', hidden: true },
      'set-default-app',
    )
    const defaultResult = el('span', { className: 'settings-hint' }, 'set-default-app-result')
    defaultResult.setAttribute('role', 'status')
    const showDefault = (s: DefaultAppStatus) => {
      defaultText.textContent = defaultAppText(s)
      makeDefault.hidden = s.state === 'default'
    }
    const queryDefault = () =>
      deps
        .defaultAppStatus()
        .then(showDefault, () => showDefault({ state: 'unknown', platform: String(deps.platform) }))
    makeDefault.addEventListener('click', () => {
      makeDefault.disabled = true
      defaultResult.textContent = ''
      deps
        .makeDefaultApp()
        .then(
          (r) => {
            defaultResult.textContent = r.message
          },
          (e: unknown) => {
            defaultResult.textContent = `Nicht gelungen: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`
          },
        )
        .finally(() => {
          makeDefault.disabled = false
          void queryDefault()
        })
    })
    void queryDefault()
    const defaultRow = el('div', { className: 'settings-path' })
    defaultRow.append(makeDefault, defaultResult)
    defaultApp.append(defaultText, defaultRow)

    const status = el('div', { className: 'settings-status' })
    const pipeline = el(
      'div',
      { textContent: 'Pipeline: wird geprüft …' },
      'settings-status-pipeline',
    )
    status.append(el('h3', { textContent: 'Status' }), pipeline)
    deps.status.then(
      (s) => {
        pipeline.textContent = pipelineLine(s)
      },
      (e: unknown) => {
        pipeline.textContent =
          e instanceof StatusTimeout
            ? `Status nicht verfügbar (${e.message})`
            : 'Status nicht verfügbar'
      },
    )

    const error = el('p', { className: 'settings-error', hidden: true }, 'settings-error')
    error.setAttribute('role', 'alert')
    const cancel = el('button', { type: 'button', textContent: 'Abbrechen' }, 'settings-cancel')
    const save = el('button', { type: 'submit', textContent: 'Speichern' }, 'settings-save')
    const actions = el('div', { className: 'actions' })
    actions.append(cancel, save)
    form.append(
      el('h2', { textContent: 'Einstellungen' }),
      ...rows,
      factorLabel,
      header,
      spell,
      updates,
      defaultApp,
      status,
      error,
      actions,
    )
    dialog.append(form)

    let settled = false
    const finish = (result: SettingsPatch | null) => {
      if (settled) return
      settled = true
      if (dialog.open) dialog.close()
      dialog.remove()
      resolve(result)
    }

    const fail = (message: string, focus: HTMLInputElement) => {
      error.textContent = message
      error.hidden = false
      focus.focus()
    }

    const submit = () => {
      const patch: SettingsPatch = {}
      for (const f of PATH_FIELDS) {
        const input = inputs.get(f.key) as HTMLInputElement
        const value = input.value.trim()
        if (!isAbsolutePath(value)) {
          fail(`${f.label}: bitte einen absoluten Pfad angeben.`, input)
          return
        }
        if (value !== settings[f.key]) patch[f.key] = value
      }
      const n = parseFactor(factor.value)
      if (n === null) {
        fail(FACTOR_ERROR, factor)
        return
      }
      if (n !== settings.presentFontFactor) patch.presentFontFactor = n
      const chosen = radios.get('titleblock')?.checked ? 'titleblock' : 'yaml'
      if (chosen !== settings.headerDefault) patch.headerDefault = chosen
      if (spellBox.checked !== settings.spellcheck) patch.spellcheck = spellBox.checked
      if (autoBox && autoBox.checked !== settings.dictionaryAutoUpdate)
        patch.dictionaryAutoUpdate = autoBox.checked
      if (updateBox.checked !== settings.appUpdateCheck) patch.appUpdateCheck = updateBox.checked
      finish(patch)
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      submit()
    })
    cancel.addEventListener('click', () => finish(null))
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      } else if (e.key === 'Enter' && !e.isComposing && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        submit()
      }
    })
    // The native cancel (Esc handled by the browser) closes the dialog: treat it as Abbrechen.
    dialog.addEventListener('close', () => finish(null))

    document.body.append(dialog)
    dialog.showModal()
    inputs.get('defaultFolder')?.focus()
  })
}
