import { DEFAULT_SET, headerProfile } from '../../shared/sets'
import type { SetInfo } from '../../shared/types'

export interface TemplatePickerDeps {
  /** Dialog heading, e.g. „Neu aus Vorlage“. */
  title: string
  /** Label of the confirm button. */
  confirm: string
  /** Sets in display order (see pickerSets). */
  sets: readonly SetInfo[]
  /** Set selected when the dialog opens; else the first. */
  selected?: string
  /** The set's header (main reads it); its `profile:` value is the preselected profile. */
  header(name: string): Promise<string | null>
  /** Profile names main found for the set. */
  profiles(name: string): Promise<string[]>
}

/** The user's choice; profile is null when the set offers none (the header keeps its value). */
export interface TemplateChoice {
  name: string
  profile: string | null
}

const SOURCE_TEXT: Record<SetInfo['source'], string> = {
  bundled: 'mitgeliefert',
  user: 'eigene',
}

const NO_PROFILES = 'Kein Profil gefunden – Profile liegen in Vorlagen/profiles/'
const NO_SETS = 'Keine Vorlagen gefunden – eigene Sets liegen im Ordner Vorlagen/.'

/**
 * Picker order: the default set first (preselected by the caller, so the usual choice is one
 * Enter away), then the others in main's order (sorted by name). „Neu aus Vorlage …“ lists the
 * default set too: every set is offered in one place, even though Mod+N already makes a memo
 * note.
 */
export function pickerSets(sets: readonly SetInfo[]): SetInfo[] {
  const rest = sets.filter((s) => s.name !== DEFAULT_SET)
  const def = sets.find((s) => s.name === DEFAULT_SET)
  return def ? [def, ...rest] : rest
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
 * Modal set picker (the settings dialog's look and keys): a radio list of the sets and, for a
 * set whose header has a `profile:` key, a choice of the profiles found on disk. Enter
 * confirms, Abbrechen/Esc/the native close resolve null. Everything shown comes from main's
 * discovery, so no set besides the default is named here.
 */
export function pickTemplate(deps: TemplatePickerDeps): Promise<TemplateChoice | null> {
  return new Promise((resolve) => {
    const dialog = el('dialog', { className: 'prompt templates' }, 'tpl-dialog')
    const form = el('form', { noValidate: true })
    const list = el('fieldset', { className: 'tpl-sets' })
    list.append(el('legend', { textContent: 'Vorlagen-Set:' }))
    const radios = new Map<string, HTMLInputElement>()
    const initial = deps.sets.some((s) => s.name === deps.selected)
      ? deps.selected
      : deps.sets[0]?.name
    for (const set of deps.sets) {
      const radio = el(
        'input',
        { type: 'radio', name: 'tpl-set', value: set.name, checked: set.name === initial },
        `tpl-set-${set.name}`,
      )
      radios.set(set.name, radio)
      const text = el('span', { className: 'tpl-text' })
      text.append(
        el('strong', { textContent: set.name }),
        el('span', { className: 'tpl-hint', textContent: set.hint }),
        el('span', { className: 'tpl-source', textContent: SOURCE_TEXT[set.source] }),
      )
      const row = el('label', { className: 'tpl-row' }, `tpl-row-${set.name}`)
      row.append(radio, text)
      list.append(row)
    }

    const profileRow = el('div', { className: 'tpl-profile', hidden: true }, 'tpl-profile-row')
    const profileLabel = el('label', { textContent: 'Profil' })
    const select = el('select', { hidden: true }, 'tpl-profile')
    profileLabel.append(select)
    const profileHint = el(
      'p',
      { className: 'tpl-note', textContent: NO_PROFILES, hidden: true },
      'tpl-profile-hint',
    )
    profileRow.append(profileLabel, profileHint)

    const cancel = el('button', { type: 'button', textContent: 'Abbrechen' }, 'tpl-cancel')
    const actions = el('div', { className: 'actions' })
    actions.append(cancel)
    let ok: HTMLButtonElement | null = null
    form.append(el('h2', { textContent: deps.title }))
    if (deps.sets.length === 0) {
      form.append(el('p', { className: 'tpl-note', textContent: NO_SETS }, 'tpl-empty'))
    } else {
      ok = el('button', { type: 'submit', textContent: deps.confirm }, 'tpl-ok')
      actions.append(ok)
      form.append(list, profileRow)
    }
    form.append(actions)
    dialog.append(form)

    const selectedSet = (): SetInfo | undefined =>
      deps.sets.find((s) => radios.get(s.name)?.checked)

    let settled = false
    // Each selection starts a lookup; only the latest may fill the profile choice.
    let lookup = 0
    const showProfiles = async () => {
      const ticket = ++lookup
      const set = selectedSet()
      select.replaceChildren()
      select.hidden = true
      profileHint.hidden = true
      profileRow.hidden = !set?.hasProfile
      if (!set?.hasProfile) return
      let names: string[] = []
      let current: string | null = null
      try {
        const [list, header] = await Promise.all([deps.profiles(set.name), deps.header(set.name)])
        names = list
        current = header === null ? null : headerProfile(header)
      } catch (e) {
        console.warn('template picker: profiles could not be read', e)
      }
      if (ticket !== lookup || settled) return
      if (names.length === 0) {
        profileHint.hidden = false
        return
      }
      for (const n of names) select.append(el('option', { value: n, textContent: n }))
      select.value = current !== null && names.includes(current) ? current : (names[0] ?? '')
      select.hidden = false
    }

    const finish = (result: TemplateChoice | null) => {
      if (settled) return
      settled = true
      if (dialog.open) dialog.close()
      dialog.remove()
      resolve(result)
    }

    const submit = () => {
      const set = selectedSet()
      if (!ok || !set) return
      // A profile only counts when the choice is shown (lookup done, profiles found).
      const profile = set.hasProfile && !select.hidden && select.value ? select.value : null
      finish({ name: set.name, profile })
    }

    list.addEventListener('change', () => void showProfiles())
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
    if (initial !== undefined) {
      radios.get(initial)?.focus()
      void showProfiles()
    } else cancel.focus()
  })
}
