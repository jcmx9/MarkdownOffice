import boldSvg from '../../../resources/toolbar-icons/bold.svg?raw'
import chevronDownSvg from '../../../resources/toolbar-icons/chevron-down.svg?raw'
import codeSvg from '../../../resources/toolbar-icons/code.svg?raw'
import heading1Svg from '../../../resources/toolbar-icons/heading-1.svg?raw'
import heading2Svg from '../../../resources/toolbar-icons/heading-2.svg?raw'
import heading3Svg from '../../../resources/toolbar-icons/heading-3.svg?raw'
import highlighterSvg from '../../../resources/toolbar-icons/highlighter.svg?raw'
import italicSvg from '../../../resources/toolbar-icons/italic.svg?raw'
import linkSvg from '../../../resources/toolbar-icons/link.svg?raw'
import listSvg from '../../../resources/toolbar-icons/list.svg?raw'
import listOrderedSvg from '../../../resources/toolbar-icons/list-ordered.svg?raw'
import boxSvg from '../../../resources/toolbar-icons/message-square-warning.svg?raw'
import pagebreakSvg from '../../../resources/toolbar-icons/separator-horizontal.svg?raw'
import squareCheckSvg from '../../../resources/toolbar-icons/square-check.svg?raw'
import strikethroughSvg from '../../../resources/toolbar-icons/strikethrough.svg?raw'
import tableSvg from '../../../resources/toolbar-icons/table.svg?raw'
import quoteSvg from '../../../resources/toolbar-icons/text-quote.svg?raw'
import { ALERT_ENTRIES, type AlertType, type FormatId } from '../editor/format'
import { chromeButton } from './chrome-button'
import { lift } from './switches'
import { TableGrid } from './table-grid'

export type ToolbarAction =
  | { kind: 'format'; id: FormatId }
  | { kind: 'alert'; type: AlertType }
  | { kind: 'pagebreak' }
  | { kind: 'table-insert'; cols: number; rows: number }
  | { kind: 'table'; op: 'row-below' | 'col-right' | 'row-delete' | 'col-delete' }

export interface ToolbarState {
  /** The row is shown (Edit mode, a note shown, the user's toggle on). */
  visible: boolean
  /** Buttons act (false on a profile tab or while the editor is frozen). */
  enabled: boolean
  /** activeFormats(state) of the main cursor. */
  active: ReadonlySet<FormatId | 'table'>
  /** tableCommandState(state). */
  table: { inTable: boolean; rowDelete: boolean; colDelete: boolean }
}

// Lucide icons (ISC, see THIRD_PARTY_NOTICES.md), bundled as text by Vite: nothing is loaded at
// runtime, no icon font.
const ICONS = {
  h1: heading1Svg,
  h2: heading2Svg,
  h3: heading3Svg,
  bold: boldSvg,
  italic: italicSvg,
  strike: strikethroughSvg,
  mark: highlighterSvg,
  code: codeSvg,
  bullet: listSvg,
  numbered: listOrderedSvg,
  task: squareCheckSvg,
  quote: quoteSvg,
  link: linkSvg,
  table: tableSvg,
  box: boxSvg,
  pagebreak: pagebreakSvg,
  chevron: chevronDownSvg,
} as const
type IconName = keyof typeof ICONS

const SVG_NS = 'http://www.w3.org/2000/svg'
const parsedIcons = new Map<IconName, Element>()

/**
 * The icon as SVG DOM. The files are ours and checked by licences.test.ts (plain shapes only),
 * still they are parsed as XML and imported as nodes rather than assigned via innerHTML, so no
 * markup string ever reaches the HTML parser (project rule, strict CSP).
 */
function icon(name: IconName): Element {
  let template = parsedIcons.get(name)
  if (!template) {
    const root = new DOMParser().parseFromString(ICONS[name], 'image/svg+xml').documentElement
    // A parse error yields a <parsererror> document instead of an <svg>.
    if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
      throw new Error(`toolbar icon ${name} is not an SVG`)
    }
    template = document.importNode(root, true)
    template.setAttribute('aria-hidden', 'true')
    template.setAttribute('focusable', 'false')
    template.setAttribute('width', '16')
    template.setAttribute('height', '16')
    parsedIcons.set(name, template)
  }
  return template.cloneNode(true) as Element
}

interface FormatSpec {
  id: FormatId
  label: string
}

/** The format groups in the spec order; the table, Box and page break groups follow. */
const FORMAT_GROUPS: FormatSpec[][] = [
  [
    { id: 'h1', label: 'Überschrift 1' },
    { id: 'h2', label: 'Überschrift 2' },
    { id: 'h3', label: 'Überschrift 3' },
  ],
  [
    { id: 'bold', label: 'Fett' },
    { id: 'italic', label: 'Kursiv' },
    { id: 'strike', label: 'Durchgestrichen' },
    { id: 'mark', label: 'Markieren' },
    { id: 'code', label: 'Code' },
  ],
  [
    { id: 'bullet', label: 'Aufzählung' },
    { id: 'numbered', label: 'Nummerierte Liste' },
    { id: 'task', label: 'Aufgabe' },
    { id: 'quote', label: 'Zitat' },
  ],
  [{ id: 'link', label: 'Link' }],
]

type TableOp = Extract<ToolbarAction, { kind: 'table' }>['op']

const TABLE_ENTRIES: ReadonlyArray<{ op: TableOp; label: string }> = [
  { op: 'row-below', label: 'Zeile darunter einfügen' },
  { op: 'col-right', label: 'Spalte rechts einfügen' },
  { op: 'row-delete', label: 'Zeile löschen' },
  { op: 'col-delete', label: 'Spalte löschen' },
]

interface MenuEntry {
  testid: string
  /** Visible content of the entry. */
  content: Node[]
  ariaLabel?: string
  disabled: boolean
  action: ToolbarAction
}

interface Popup {
  el: HTMLElement
  opener: HTMLButtonElement
  /** What had focus before the popup took it (the editor), given back on close. */
  restore: Element | null
}

/**
 * The formatting toolbar (spec section 1): one row below the tab bar, `H1 H2 H3 │ B I S Mark
 * Code │ • 1. ☐ Zitat │ Link │ Tabelle ▾ │ Box ▾ │ Seitenumbruch`. A pure view: it reports
 * clicks as ToolbarAction and App runs the command and focuses the editor again.
 *
 * Buttons never take focus (chromeButton: tabIndex -1, mousedown cancelled), so the editor's
 * selection survives a click. Popups (table grid, table menu, Box menu) do take focus while open
 * so their arrow keys work; Esc, an outside click or an action closes them, and focus goes back
 * to what held it before (the editor) when it was still inside the popup.
 */
export class Toolbar {
  private readonly formats = new Map<FormatId, HTMLButtonElement>()
  private readonly tableButton: HTMLButtonElement
  private readonly boxButton: HTMLButtonElement
  private readonly pagebreakButton: HTMLButtonElement
  private readonly grid: TableGrid
  private popup: Popup | null = null
  private state: ToolbarState = {
    visible: true,
    enabled: true,
    active: new Set(),
    table: { inTable: false, rowDelete: false, colDelete: false },
  }

  constructor(
    private readonly el: HTMLElement,
    private readonly onAction: (a: ToolbarAction) => void,
  ) {
    el.setAttribute('role', 'toolbar')
    el.setAttribute('aria-label', 'Formatierung')
    el.classList.add('mdo-fmt')

    const groups: HTMLElement[] = FORMAT_GROUPS.map((specs) =>
      group(
        specs.map((s) => {
          const b = button(`fmt-${s.id}`, s.label, s.label, [icon(s.id)], () =>
            this.onAction({ kind: 'format', id: s.id }),
          )
          this.formats.set(s.id, b)
          return b
        }),
      ),
    )

    this.tableButton = button(
      'fmt-table',
      'Tabelle',
      'Tabelle',
      [icon('table'), icon('chevron')],
      () => this.toggleTable(),
    )
    this.tableButton.setAttribute('aria-expanded', 'false')
    this.boxButton = button(
      'fmt-box',
      'Hinweisbox',
      'Hinweisbox',
      [icon('box'), icon('chevron')],
      () => this.toggleBox(),
    )
    this.boxButton.setAttribute('aria-haspopup', 'menu')
    this.boxButton.setAttribute('aria-expanded', 'false')
    this.pagebreakButton = button(
      'fmt-pagebreak',
      'Seitenumbruch',
      'Seitenumbruch (Mod+Enter)',
      [icon('pagebreak')],
      () => this.onAction({ kind: 'pagebreak' }),
    )
    groups.push(group([this.tableButton]), group([this.boxButton]), group([this.pagebreakButton]))

    const children: HTMLElement[] = []
    groups.forEach((g, i) => {
      if (i > 0) children.push(separator())
      children.push(g)
    })
    el.replaceChildren(...children)

    this.grid = new TableGrid(
      ({ cols, rows }) => this.act({ kind: 'table-insert', cols, rows }),
      () => this.close(),
    )
    this.syncTablePopupKind()
  }

  render(s: ToolbarState): void {
    const prev = this.state
    this.state = s
    this.el.hidden = !s.visible
    // An open popup must not outlive the state it was built for: hidden or disabled bar, or a
    // table menu whose flags (or the grid, once the cursor entered a table) no longer apply.
    if (!s.visible || !s.enabled) this.close()
    else if (this.popup?.opener === this.tableButton && !sameTable(prev.table, s.table)) {
      this.close()
    }
    for (const [id, b] of this.formats) {
      b.disabled = !s.enabled
      lift(b, s.active.has(id))
    }
    this.tableButton.disabled = !s.enabled
    lift(this.tableButton, s.active.has('table'))
    this.boxButton.disabled = !s.enabled
    this.pagebreakButton.disabled = !s.enabled
    this.syncTablePopupKind()
  }

  // In a table the button opens a real menu. The size picker is a labelled group, which no
  // aria-haspopup value names (`grid` would promise a grid role), so it only has aria-expanded.
  private syncTablePopupKind(): void {
    if (this.state.table.inTable) this.tableButton.setAttribute('aria-haspopup', 'menu')
    else this.tableButton.removeAttribute('aria-haspopup')
  }

  private toggleTable(): void {
    if (this.popup?.opener === this.tableButton) {
      this.close()
      return
    }
    const t = this.state.table
    if (!t.inTable) {
      this.grid.reset()
      this.open(this.tableButton, this.grid.el, this.grid.el)
      return
    }
    const flags: Record<TableOp, boolean> = {
      'row-below': true,
      'col-right': true,
      'row-delete': t.rowDelete,
      'col-delete': t.colDelete,
    }
    this.openMenu(
      this.tableButton,
      'fmt-table-menu',
      'Tabelle bearbeiten',
      TABLE_ENTRIES.map((e) => ({
        testid: `fmt-table-${e.op}`,
        content: [document.createTextNode(e.label)],
        disabled: !flags[e.op],
        action: { kind: 'table', op: e.op },
      })),
    )
  }

  private toggleBox(): void {
    if (this.popup?.opener === this.boxButton) {
      this.close()
      return
    }
    this.openMenu(
      this.boxButton,
      'fmt-box-menu',
      'Hinweisbox einfügen',
      ALERT_ENTRIES.map((e) => {
        // The German alias names the entry; the GFM keyword is shown because that is what gets
        // inserted (the box title in the PDF is the set's business).
        const label = document.createElement('span')
        label.className = 'mdo-fmt-label'
        label.textContent = e.label
        const keyword = document.createElement('span')
        keyword.className = 'mdo-fmt-keyword'
        keyword.textContent = e.keyword
        return {
          testid: `fmt-alert-${e.type}`,
          content: [label, keyword],
          ariaLabel: `${e.label} (${e.keyword})`,
          disabled: false,
          action: { kind: 'alert', type: e.type },
        }
      }),
    )
  }

  private openMenu(opener: HTMLButtonElement, testid: string, label: string, entries: MenuEntry[]) {
    const menu = document.createElement('div')
    menu.className = 'mdo-fmt-menu'
    menu.dataset.testid = testid
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', label)
    const items = entries.map((e) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.tabIndex = -1
      item.dataset.testid = e.testid
      item.setAttribute('role', 'menuitem')
      if (e.ariaLabel) item.setAttribute('aria-label', e.ariaLabel)
      item.disabled = e.disabled
      item.append(...e.content)
      // Focus stays on the menu's current entry; the click still fires.
      item.addEventListener('mousedown', (ev) => {
        if (ev.button === 0) ev.preventDefault()
      })
      item.addEventListener('click', () => this.act(e.action))
      return item
    })
    menu.append(...items)
    menu.addEventListener('keydown', (ev) => {
      const enabled = items.filter((i) => !i.disabled)
      const at = enabled.indexOf(document.activeElement as HTMLButtonElement)
      const focus = (i: number) => enabled[(i + enabled.length) % enabled.length]?.focus()
      if (ev.key === 'ArrowDown') focus(at + 1)
      else if (ev.key === 'ArrowUp') focus(at < 0 ? -1 : at - 1)
      else if (ev.key === 'Home') focus(0)
      else if (ev.key === 'End') focus(-1)
      else if (ev.key === 'Enter' || ev.key === ' ') {
        // Handled here, and the default cancelled, so the native button activation does not
        // fire a second click.
        enabled[at]?.click()
      } else if (ev.key === 'Escape' || ev.key === 'Tab') this.close()
      else return
      ev.preventDefault()
      ev.stopPropagation()
    })
    this.open(opener, menu, items.find((i) => !i.disabled) ?? menu)
  }

  private open(opener: HTMLButtonElement, el: HTMLElement, focusTarget: HTMLElement): void {
    this.close()
    const restore = document.activeElement
    el.classList.add('mdo-fmt-popup')
    this.el.append(el)
    // Under its button; #toolbar is the positioned parent (styles.css). The row does not wrap,
    // so on a narrow window a button near the right edge would push its popup out of view:
    // the left edge is clamped so the popup ends inside the window, but never left of the bar.
    const room = window.innerWidth - this.el.getBoundingClientRect().left - el.offsetWidth - 4
    el.style.left = `${Math.max(0, Math.min(opener.offsetLeft, room))}px`
    opener.setAttribute('aria-expanded', 'true')
    this.popup = { el, opener, restore }
    document.addEventListener('mousedown', this.outside, true)
    focusTarget.focus()
  }

  private close(): void {
    const p = this.popup
    if (!p) return
    this.popup = null
    document.removeEventListener('mousedown', this.outside, true)
    const hadFocus = p.el.contains(document.activeElement)
    p.el.remove()
    p.opener.setAttribute('aria-expanded', 'false')
    // Only when the popup held focus (Esc, Tab, an entry chosen, or an outside press: `outside`
    // runs in the capture phase, before the browser moves focus). Focus goes back to what held
    // it before; for an outside press the browser then moves it on to the pressed element, if
    // that takes focus, so a click into a text field still lands there.
    if (hadFocus && p.restore instanceof HTMLElement && p.restore.isConnected) p.restore.focus()
  }

  /** Closes the popup first, so the consumer's editor focus is the last word. */
  private act(a: ToolbarAction): void {
    this.close()
    this.onAction(a)
  }

  // A press outside the popup and its own button closes it (the button's click toggles itself).
  private readonly outside = (e: MouseEvent): void => {
    const p = this.popup
    if (!p || !(e.target instanceof Node)) return
    if (p.el.contains(e.target) || p.opener.contains(e.target)) return
    this.close()
  }
}

function button(
  testid: string,
  label: string,
  title: string,
  icons: Element[],
  onClick: () => void,
): HTMLButtonElement {
  const b = chromeButton(testid, '', title, onClick)
  b.setAttribute('aria-label', label)
  b.append(...icons)
  return b
}

function group(buttons: HTMLButtonElement[]): HTMLElement {
  const g = document.createElement('span')
  g.className = 'mdo-fmt-group'
  g.append(...buttons)
  return g
}

function separator(): HTMLElement {
  const s = document.createElement('span')
  s.className = 'mdo-fmt-sep'
  s.setAttribute('aria-hidden', 'true')
  return s
}

function sameTable(a: ToolbarState['table'], b: ToolbarState['table']): boolean {
  return a.inTable === b.inTable && a.rowDelete === b.rowDelete && a.colDelete === b.colDelete
}
