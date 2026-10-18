import type { Mode, View } from '../../shared/types'
import { chromeButton } from './chrome-button'

export type { Mode }

export interface SwitchActions {
  setMode(mode: Mode): void
  setView(view: View): void
}

/**
 * Two flat switches, `Editor | Präsentation` and `Code | Vorschau`: they read like info text,
 * the active side is lifted, a click on the other side switches. Test ids: `<prefix>-edit`,
 * `<prefix>-present`, `<prefix>-code`, `<prefix>-preview`.
 */
export class ModeSwitches {
  readonly el = document.createElement('span')
  private readonly edit: HTMLButtonElement
  private readonly present: HTMLButtonElement
  private readonly code: HTMLButtonElement
  private readonly preview: HTMLButtonElement

  constructor(prefix: string, actions: SwitchActions) {
    this.edit = chromeButton(`${prefix}-edit`, 'Editor', 'Bearbeiten (Esc)', () =>
      actions.setMode('edit'),
    )
    this.present = chromeButton(`${prefix}-present`, 'Präsentation', 'Präsentieren', () =>
      actions.setMode('present'),
    )
    this.code = chromeButton(`${prefix}-code`, 'Code', 'Code-Ansicht', () =>
      actions.setView('code'),
    )
    this.preview = chromeButton(`${prefix}-preview`, 'Vorschau', 'Vorschau', () =>
      actions.setView('preview'),
    )
    this.el.className = 'mdo-switches'
    this.el.append(group(this.edit, this.present), group(this.code, this.preview))
  }

  /** canPresent=false: no note is open. In Present the view is always Preview. */
  render(mode: Mode, view: View, canPresent: boolean): void {
    const shown: View = mode === 'present' ? 'preview' : view
    lift(this.edit, mode === 'edit')
    lift(this.present, mode === 'present')
    lift(this.code, shown === 'code')
    lift(this.preview, shown === 'preview')
    this.present.disabled = !canPresent && mode === 'edit'
    // In Present a click on Code ends Present and shows the Code view; Vorschau stays fixed.
    this.code.disabled = false
    this.preview.disabled = mode === 'present'
    this.code.title = mode === 'present' ? 'Präsentation beenden und Code zeigen' : 'Code-Ansicht'
    this.preview.title = mode === 'present' ? 'Beim Präsentieren immer Vorschau' : 'Vorschau'
  }
}

function group(a: HTMLButtonElement, b: HTMLButtonElement): HTMLSpanElement {
  const g = document.createElement('span')
  g.className = 'mdo-sw'
  const bar = document.createElement('span')
  bar.className = 'mdo-sw-bar'
  bar.textContent = '|'
  bar.setAttribute('aria-hidden', 'true')
  g.append(a, bar, b)
  return g
}

function lift(b: HTMLButtonElement, on: boolean): void {
  b.classList.toggle('active', on)
  b.setAttribute('aria-pressed', String(on))
}

export interface ToggleActions {
  toggleOutline(): void
  toggleYaml(): void
}

export interface ToggleState {
  /** A note is open. */
  hasNote: boolean
  /** The outline is visible in this mode. */
  outline: boolean
  /** The note has a front matter. */
  hasHeader: boolean
  /** The header is shown expanded; in Code it always is. */
  yamlOn: boolean
  /** Code view: the header cannot be collapsed there (toggle-header only works in Preview). */
  code: boolean
}

/**
 * Two single flat toggles right of `Code | Vorschau`: `Gliederung` and `YAML`. Same look as
 * ModeSwitches (lifted = on, grey = off). Test ids: `<prefix>-outline`, `<prefix>-yaml`.
 */
export class StatusToggles {
  readonly el = document.createElement('span')
  private readonly outline: HTMLButtonElement
  private readonly yaml: HTMLButtonElement

  constructor(prefix: string, actions: ToggleActions) {
    this.outline = chromeButton(
      `${prefix}-outline`,
      'Gliederung',
      'Gliederung ein/aus (Mod+Shift+O)',
      () => actions.toggleOutline(),
    )
    this.yaml = chromeButton(`${prefix}-yaml`, 'YAML', 'YAML-Header ein/aus (Mod+Shift+H)', () =>
      actions.toggleYaml(),
    )
    this.el.className = 'mdo-switches'
    this.el.append(this.outline, this.yaml)
  }

  render(s: ToggleState): void {
    lift(this.outline, s.hasNote && s.outline)
    this.outline.disabled = !s.hasNote
    // Intent: the lifted state mirrors what toggle-header changes (expanded = on). Code shows
    // the header always expanded, so the button stays lifted but cannot act there.
    lift(this.yaml, s.hasNote && s.hasHeader && s.yamlOn)
    this.yaml.disabled = !s.hasNote || !s.hasHeader || s.code
    this.yaml.title = !s.hasNote
      ? 'YAML-Header ein/aus (Mod+Shift+H)'
      : !s.hasHeader
        ? 'Die Notiz hat keinen YAML-Header'
        : s.code
          ? 'Der YAML-Header lässt sich nur in der Vorschau ausblenden'
          : 'YAML-Header ein/aus (Mod+Shift+H)'
  }
}
