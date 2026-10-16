import { chromeButton } from './chrome-button'
import { Clock } from './clock'
import { ModeSwitches } from './switches'
import { zoomLabel } from './zoom'

export { formatClock } from './clock'

export interface InfoLineTab {
  name: string
  dirty: boolean
}

export interface InfoLineActions {
  selectTab(index: number): void
  exitPresent(): void
  /** Ends Present and shows the Code view. */
  showCode(): void
  zoomIn(): void
  zoomOut(): void
}

/** Present's only chrome: clock, mode and view switches, tabs, zoom, save state. */
export class InfoLine {
  private readonly clock: Clock
  private readonly switches: ModeSwitches
  private readonly tabs = document.createElement('span')
  private readonly zoom = document.createElement('span')
  private readonly state = document.createElement('span')
  /** Kept across refreshes: replacing a button between mousedown and mouseup loses the click. */
  private readonly tabButtons: HTMLButtonElement[] = []

  constructor(
    el: HTMLElement,
    private readonly actions: InfoLineActions,
    now: () => Date = () => new Date(),
  ) {
    this.clock = new Clock('mdo-il-clock', 'il-clock', now)
    this.switches = new ModeSwitches('il', {
      setMode: (mode) => {
        if (mode === 'edit') actions.exitPresent()
      },
      // Present always shows Preview: Vorschau is a no-op, Code ends Present.
      setView: (view) => {
        if (view === 'code') actions.showCode()
      },
    })
    this.switches.render('present', 'preview', true)
    this.tabs.className = 'mdo-il-tabs'
    this.zoom.className = 'mdo-il-zoom'
    this.zoom.dataset.testid = 'il-zoom'
    this.state.className = 'mdo-il-state'
    this.state.dataset.testid = 'il-state'
    const spacer = document.createElement('span')
    spacer.className = 'mdo-il-spacer'
    el.replaceChildren(
      this.clock.el,
      this.switches.el,
      this.tabs,
      spacer,
      chromeButton('il-zoom-out', '−', 'Verkleinern', () => actions.zoomOut()),
      this.zoom,
      chromeButton('il-zoom-in', '+', 'Vergrößern', () => actions.zoomIn()),
      this.state,
    )
  }

  start(): void {
    this.clock.start()
  }

  stop(): void {
    this.clock.stop()
  }

  render(tabs: readonly InfoLineTab[], active: number, saveText: string, zoom: number): void {
    // Update in place; only a changed tab count adds or removes buttons at the end.
    while (this.tabButtons.length > tabs.length) this.tabButtons.pop()?.remove()
    while (this.tabButtons.length < tabs.length) {
      const i = this.tabButtons.length
      const b = chromeButton('il-tab', '', '', () => this.actions.selectTab(i))
      b.classList.add('mdo-il-tab')
      this.tabButtons.push(b)
      this.tabs.append(b)
    }
    tabs.forEach((t, i) => {
      const b = this.tabButtons[i] as HTMLButtonElement
      if (b.textContent !== t.name) b.textContent = t.name
      if (b.title !== t.name) b.title = t.name
      b.classList.toggle('active', i === active)
      b.classList.toggle('dirty', t.dirty)
    })
    this.state.textContent = saveText
    this.zoom.textContent = zoomLabel(zoom)
  }
}
