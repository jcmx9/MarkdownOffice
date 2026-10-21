import type { Finding, Severity, ValidationResult } from '../../core/frontmatter-validate'
import { findingMessage } from '../../core/validate-messages'

/** What the user ticked: finding ids, and whether the missing keys are added. */
export interface ValidateChoice {
  ids: Set<string>
  addMissing: boolean
}

export interface ValidateDialogOptions {
  /** The set the note was checked against ('' = a `.typ` path, no set). */
  set: string
  result: Extract<ValidationResult, { kind: 'checked' }>
  /** Neutral notice above the findings (a broken set schema); none when absent. */
  notice?: string | null
}

const SEVERITY_TEXT: Record<Severity, string> = {
  error: 'Fehler',
  warning: 'Warnung',
  hint: 'Hinweis',
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
 * One finding: line, key, severity, message and the suggestion its fix writes. Only a finding
 * with changes gets a checkbox (preselected as the validator says: hints and fixes that are
 * guesses stay unticked); one without is shown for information and fixed by hand.
 */
function findingRow(f: Finding): { row: HTMLElement; box: HTMLInputElement | null } {
  const fixable = f.changes.length > 0
  const box = fixable ? el('input', { type: 'checkbox', checked: f.preselected }) : null
  const text = el('span', { className: 'val-text' })
  const where = f.key ? `Zeile ${f.line} · ${f.key}` : `Zeile ${f.line}`
  text.append(
    el('span', { className: 'val-where', textContent: where }),
    el('span', {
      className: `val-severity val-${f.severity}`,
      textContent: SEVERITY_TEXT[f.severity],
    }),
    el('span', { className: 'val-message', textContent: findingMessage(f) }),
  )
  if (f.suggestion !== null && fixable) {
    text.append(el('span', { className: 'val-suggestion', textContent: `→ ${f.suggestion}` }))
  }
  // A label makes the whole row toggle its checkbox; a row without one is plain text.
  const row = fixable
    ? el('label', { className: 'val-row' }, 'validate-row')
    : el('div', { className: 'val-row val-info' }, 'validate-row')
  if (box) row.append(box)
  row.append(text)
  return { row, box }
}

/**
 * „YAML prüfen …“ (the template picker's look and keys): the findings with a checkbox each,
 * the set's missing keys as one section with one checkbox (off: added only on request), and
 * Übernehmen/Abbrechen. Enter or Übernehmen resolve the ticked choice, Abbrechen/Esc/the native
 * close resolve null. The dialog only chooses; the caller applies the choice to the note as it
 * is then (see choiceSpec), since the note may change while the dialog is open.
 */
export function openValidateDialog(o: ValidateDialogOptions): Promise<ValidateChoice | null> {
  return new Promise((resolve) => {
    const dialog = el('dialog', { className: 'prompt validate' }, 'validate-dialog')
    const form = el('form', { noValidate: true })
    form.append(el('h2', { textContent: 'YAML prüfen' }))
    form.append(
      el('p', {
        className: 'val-note',
        textContent: o.set ? `Vorlagen-Set: ${o.set}` : 'Vorlage: eigene .typ-Datei',
      }),
    )
    if (o.notice) {
      form.append(el('p', { className: 'val-notice', textContent: o.notice }, 'validate-notice'))
    }

    const boxes = new Map<string, HTMLInputElement>()
    if (o.result.findings.length > 0) {
      const list = el('div', { className: 'val-list' })
      for (const f of o.result.findings) {
        const { row, box } = findingRow(f)
        if (box) boxes.set(f.id, box)
        list.append(row)
      }
      form.append(list)
    }

    let missingBox: HTMLInputElement | null = null
    if (o.result.missing.length > 0) {
      const section = el('fieldset', { className: 'val-missing' }, 'validate-missing')
      missingBox = el('input', { type: 'checkbox', checked: false })
      const label = el('label', { className: 'val-row' })
      const text = el('span', { className: 'val-text' })
      text.append(
        el('strong', { textContent: `Fehlende ergänzen (${o.result.missing.length})` }),
        el('span', { className: 'val-keys', textContent: o.result.missing.join(', ') }),
      )
      label.append(missingBox, text)
      section.append(label)
      form.append(section)
    }

    const cancel = el('button', { type: 'button', textContent: 'Abbrechen' }, 'validate-cancel')
    const ok = el('button', { type: 'submit', textContent: 'Übernehmen' }, 'validate-apply')
    const actions = el('div', { className: 'actions' })
    actions.append(cancel, ok)
    form.append(actions)
    dialog.append(form)

    let settled = false
    const finish = (result: ValidateChoice | null) => {
      if (settled) return
      settled = true
      if (dialog.open) dialog.close()
      dialog.remove()
      resolve(result)
    }
    const submit = () => {
      const ids = new Set([...boxes].filter(([, box]) => box.checked).map(([id]) => id))
      finish({ ids, addMissing: missingBox?.checked ?? false })
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
    // The first choice gets the focus (Space ticks, Enter applies), else the confirm button.
    const first = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')
    ;(first ?? ok).focus()
  })
}
