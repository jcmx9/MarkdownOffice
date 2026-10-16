import type { Tab } from '../tabs/tab-store'
import { fileName } from '../util/path'

export interface TabBarActions {
  select(index: number): void
  close(id: number): void
  /** Right click on a tab: select it, then show the note's context menu. */
  menu(index: number): void
}

export class TabBar {
  constructor(
    private readonly el: HTMLElement,
    private readonly actions: TabBarActions,
  ) {}

  render(tabs: readonly Tab[], active: number, isDirty: (t: Tab) => boolean): void {
    this.el.replaceChildren(
      ...tabs.map((tab, i) => {
        const item = document.createElement('div')
        item.className = 'tab'
        item.dataset.testid = 'tab'
        item.setAttribute('role', 'tab')
        item.setAttribute('aria-selected', String(i === active))
        item.classList.toggle('active', i === active)
        item.classList.toggle('dirty', isDirty(tab))
        item.title = tab.path
        const label = document.createElement('span')
        label.className = 'tab-label'
        label.textContent = fileName(tab.path)
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'tab-close'
        close.textContent = '×'
        close.title = 'Tab schließen'
        close.addEventListener('click', (e) => {
          e.stopPropagation()
          this.actions.close(tab.id)
        })
        item.addEventListener('click', () => this.actions.select(i))
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          this.actions.menu(i)
        })
        item.addEventListener('auxclick', (e) => {
          if (e.button === 1) this.actions.close(tab.id)
        })
        item.append(label, close)
        return item
      }),
    )
  }
}
