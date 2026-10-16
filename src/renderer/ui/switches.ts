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
