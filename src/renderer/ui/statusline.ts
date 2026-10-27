/** held: an external change blocks saving until the user answers the banner. */
export type SaveState = 'saved' | 'dirty' | 'new' | 'error' | 'held'

export const SAVE_STATE_LABEL: Record<SaveState, string> = {
  saved: 'Gespeichert',
  dirty: 'Ungespeichert',
  new: 'Neu – wird beim ersten Tippen angelegt',
  error: 'Speichern fehlgeschlagen',
  held: 'Nicht gespeichert',
}

import { platformFromUserAgent, revealLabel } from '../../shared/reveal'
import type { View } from '../../shared/types'
import { chromeButton } from './chrome-button'
import { Clock } from './clock'
import { type SetStatus, setTitle } from './set-status'
import {
  type Mode,
  ModeSwitches,
  StatusToggles,
  type ToggleActions,
  type ToggleState,
} from './switches'
import { zoomLabel } from './zoom'

export interface StatusActions extends ToggleActions {
  /** Right click on the file name: the note's context menu (rename, reveal, export, close). */
  noteMenu(): void
  setMode(mode: Mode): void
  setView(view: View): void
  /** Click on the set name: „YAML prüfen …“, through the menu command's guards. */
  validateYaml(): void
  zoomIn(): void
  zoomOut(): void
}

const DEFAULT_TOGGLES = {
  toolbar: false,
  outline: false,
  focus: false,
  hasHeader: false,
  yamlOn: false,
}

/**
 * Edit's bottom line: clock, mode and view switches, file name, the note's set, save state,
 * export progress and, on the right, the zoom like Present's info line.
 */
export class StatusLine {
  private readonly clock: Clock
  private readonly switches: ModeSwitches
  private readonly toggles: StatusToggles
  private readonly name = document.createElement('span')
  /** The note's `template:`; red when the silent YAML check finds errors. */
  private readonly set: HTMLButtonElement
  private readonly state = document.createElement('span')
  private readonly exportState = document.createElement('span')
  private readonly zoom = document.createElement('span')
  private busy = false

  constructor(el: HTMLElement, actions: StatusActions, now: () => Date = () => new Date()) {
    this.clock = new Clock('clock', 'status-clock', now)
    this.switches = new ModeSwitches('status', actions)
    this.toggles = new StatusToggles('status', actions)
    this.name.className = 'file'
    this.state.className = 'state'
    this.state.dataset.testid = 'status-state'
    this.name.dataset.testid = 'status-file'
    // Lists the note menu's entries (src/main/menu.ts noteMenuTemplate), same platform label.
    const reveal = revealLabel(platformFromUserAgent(navigator.userAgent))
    this.name.title = `Rechtsklick: Umbenennen, ${reveal}, PDF exportieren, Tab schließen`
    this.name.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (this.name.textContent) actions.noteMenu()
    })
    this.set = chromeButton('status-set', '', '', () => actions.validateYaml())
    this.set.className = 'set'
    this.renderSet(null)
    this.exportState.className = 'exporting'
    this.exportState.dataset.testid = 'status-export'
    this.exportState.textContent = 'PDF wird erstellt …'
    this.setExporting(false)
    this.zoom.className = 'zoom'
    this.zoom.dataset.testid = 'status-zoom'
    // Right-aligned as one group, so the export note sits just before the zoom.
    const right = document.createElement('span')
    right.className = 'right'
    right.append(
      this.exportState,
      chromeButton('status-zoom-out', '−', 'Verkleinern', () => actions.zoomOut()),
      this.zoom,
      chromeButton('status-zoom-in', '+', 'Vergrößern', () => actions.zoomIn()),
    )
    el.append(
      this.clock.el,
      this.switches.el,
      this.toggles.el,
      this.name,
      this.set,
      this.state,
      right,
    )
    this.clock.start()
  }

  /** Stops the clock (tests; the status line lives as long as the window). */
  stop(): void {
    this.clock.stop()
  }

  get exporting(): boolean {
    return this.busy
  }

  render(
    file: string | null,
    state: SaveState,
    error: string | null,
    view: View,
    toggles: Omit<ToggleState, 'hasNote' | 'code'> = DEFAULT_TOGGLES,
  ): void {
    this.switches.render('edit', view, file !== null)
    this.toggles.render({ ...toggles, hasNote: file !== null, code: view === 'code' })
    this.name.textContent = file ?? ''
    this.state.textContent = saveText(state, error)
    // A hold is as prominent as a failed save.
    this.state.classList.toggle('error', state === 'error' || state === 'held')
  }

  /** Edit's zoom factor, as the info line shows Present's. */
  renderZoom(zoom: number): void {
    this.zoom.textContent = zoomLabel(zoom)
  }

  /** The set name and its check result; null hides it (no note, or no `template:`). */
  renderSet(status: SetStatus | null): void {
    this.set.hidden = status === null
    this.set.textContent = status?.name ?? ''
    this.set.title = status ? setTitle(status) : ''
    this.set.classList.toggle('error', (status?.errors ?? 0) > 0)
  }

  setExporting(on: boolean): void {
    this.busy = on
    this.exportState.hidden = !on
  }
}

/** The status text; a reason is appended for a failed save or a hold. */
export function saveText(state: SaveState, reason: string | null): string {
  return (state === 'error' || state === 'held') && reason
    ? `${SAVE_STATE_LABEL[state]}: ${reason}`
    : SAVE_STATE_LABEL[state]
}
