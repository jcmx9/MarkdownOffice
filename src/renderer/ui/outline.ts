import type { OutlineEntry } from '../editor/outline'

export interface OutlineHandlers {
  jump(entry: OutlineEntry): void
  toggle(entry: OutlineEntry): void
}

interface Row {
  li: HTMLLIElement
  chevron: HTMLButtonElement
  /** List marker for an entry without children; same slot as the chevron. */
  marker: HTMLSpanElement
  label: HTMLButtonElement
  /** Children list of an H1, present only while the H1 is expanded. */
  sub: HTMLUListElement | null
  /** Latest entry for this key; handlers read it so they never act on stale data. */
  entry: OutlineEntry
}

/**
 * Row keys: level + text + occurrence of that pair, never positions, so typing above a
 * heading keeps its row (and a click spanning the refresh). Depth-first, folded children included.
 */
function keyEntries(entries: OutlineEntry[]): Map<OutlineEntry, string> {
  const keys = new Map<OutlineEntry, string>()
  const seen = new Map<string, number>()
  const walk = (list: OutlineEntry[]) => {
    for (const e of list) {
      const base = `${e.level}:${e.text}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      keys.set(e, `${base}:${n}`)
      walk(e.children)
    }
  }
  walk(entries)
  return keys
}

/** Right-hand heading list. Pure view: it renders entries and reports clicks. */
export class Outline {
  private readonly rows = new Map<string, Row>()
  private list: HTMLUListElement | null = null
  private readonly empty = document.createElement('p')
  private activeRow: Row | null = null
  private activeKey: string | null = null
  private keys = new Map<OutlineEntry, string>()
  /** Highest heading level in the note: its entries get the top-level look, the rest the child look. */
  private topLevel: 1 | 2 = 1
  /** Full text of a cut-off label on hover, right-aligned to it (created on first use). */
  private tip: HTMLDivElement | null = null

  constructor(
    private readonly el: HTMLElement,
    private readonly handlers: OutlineHandlers,
  ) {
    this.empty.className = 'mdo-ol-empty'
    this.empty.textContent = 'Keine Überschriften'
    el.addEventListener('scroll', () => this.hideTip(), { passive: true })
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
  }

  render(entries: OutlineEntry[], active: OutlineEntry | null): void {
    this.hideTip()
    if (entries.length === 0) {
      this.rows.clear()
      this.list = null
      this.activeRow = null
      this.activeKey = null
      this.el.replaceChildren(this.empty)
      return
    }
    if (!this.list) {
      this.list = document.createElement('ul')
      this.list.className = 'mdo-ol-list'
      this.el.replaceChildren(this.list)
    }
    this.keys = keyEntries(entries)
    // Levels are relative: a note with only H2 headings shows them as top-level entries.
    this.topLevel = entries.some((e) => e.level === 1) ? 1 : 2
    const seen = new Set<string>()
    this.reconcile(this.list, entries, seen)
    for (const k of this.rows.keys()) if (!seen.has(k)) this.rows.delete(k)

    const key = active ? (this.keys.get(active) ?? null) : null
    const row = key ? (this.rows.get(key) ?? null) : null
    this.activeRow?.label.classList.remove('active')
    row?.label.classList.add('active')
    if (row && key !== this.activeKey) row.label.scrollIntoView({ block: 'nearest' })
    this.activeRow = row
    this.activeKey = row ? key : null
  }

  private reconcile(ul: HTMLUListElement, entries: OutlineEntry[], seen: Set<string>): void {
    let at: ChildNode | null = ul.firstChild
    for (const e of entries) {
      const key = this.keys.get(e) ?? ''
      seen.add(key)
      let row = this.rows.get(key)
      if (!row) {
        row = this.createRow(e)
        this.rows.set(key, row)
      }
      row.entry = e
      this.update(row, e, seen)
      if (row.li === at) at = at.nextSibling
      else ul.insertBefore(row.li, at)
    }
    while (at) {
      const next: ChildNode | null = at.nextSibling
      at.remove()
      at = next
    }
  }

  private update(row: Row, e: OutlineEntry, seen: Set<string>): void {
    const top = e.level === this.topLevel
    row.li.classList.toggle('mdo-ol-top', top)
    row.li.classList.toggle('mdo-ol-sub', !top)
    // A chevron only where it shows something: an entry with children. Every other entry
    // gets a list marker in the same slot, so the outline reads as a list.
    const hasFold = e.fold !== null && e.children.length > 0
    // parentNode, not isConnected: the list may be detached while it is being built.
    if ((row.chevron.parentNode !== null) !== hasFold) {
      // Chevron and marker occupy the same slot.
      if (hasFold) row.marker.replaceWith(row.chevron)
      else row.chevron.replaceWith(row.marker)
    }
    row.chevron.setAttribute('aria-expanded', String(!e.folded))
    row.chevron.setAttribute(
      'aria-label',
      e.folded ? 'Abschnitt ausklappen' : 'Abschnitt einklappen',
    )
    row.chevron.classList.toggle('expanded', !e.folded)
    if (row.label.textContent !== e.text) row.label.textContent = e.text

    if (e.children.length > 0 && !e.folded) {
      if (!row.sub) {
        row.sub = document.createElement('ul')
        row.sub.className = 'mdo-ol-list'
        row.li.append(row.sub)
      }
      this.reconcile(row.sub, e.children, seen)
    } else if (row.sub) {
      row.sub.remove()
      row.sub = null
    }
  }

  private createRow(e: OutlineEntry): Row {
    const li = document.createElement('li')
    li.className = `mdo-ol-item mdo-ol-h${e.level} ${e.level === this.topLevel ? 'mdo-ol-top' : 'mdo-ol-sub'}`
    const chevron = this.button('mdo-ol-chevron', '▸')
    const marker = document.createElement('span')
    marker.className = 'mdo-ol-marker'
    marker.setAttribute('aria-hidden', 'true')
    marker.textContent = '\u2022'
    const label = this.button('mdo-ol-label', e.text)
    const row: Row = { li, chevron, marker, label, sub: null, entry: e }
    chevron.addEventListener('click', (ev) => {
      if (ev.button === 0) this.handlers.toggle(row.entry)
    })
    label.addEventListener('click', (ev) => {
      if (ev.button === 0) this.handlers.jump(row.entry)
    })
    label.addEventListener('mouseenter', () => this.showTip(row))
    label.addEventListener('mouseleave', () => this.hideTip())
    li.append(e.fold && e.children.length > 0 ? chevron : marker, label)
    return row
  }

  private showTip(row: Row): void {
    const label = row.label
    if (label.scrollWidth <= label.clientWidth) return
    if (!this.tip) {
      this.tip = document.createElement('div')
      this.tip.setAttribute('aria-hidden', 'true')
      document.body.append(this.tip)
    }
    const r = label.getBoundingClientRect()
    const tip = this.tip
    tip.className = `mdo-ol-tip mdo-ol-tip-${row.entry.level === this.topLevel ? 'top' : 'sub'}`
    tip.textContent = row.entry.text
    // Same font and zoom as the row; the right edges line up, the text grows to the left.
    tip.style.setProperty('--mdo-ol-zoom', this.el.style.getPropertyValue('--mdo-ol-zoom') || '1')
    tip.style.top = `${r.top}px`
    tip.style.right = `${window.innerWidth - r.right}px`
    tip.style.minHeight = `${r.height}px`
    tip.hidden = false
  }

  private hideTip(): void {
    if (this.tip) this.tip.hidden = true
  }

  private button(className: string, text: string): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.tabIndex = -1
    b.className = className
    b.textContent = text
    // Keep focus in the text: cancelling mousedown still lets click fire.
    b.addEventListener('mousedown', (ev) => {
      if (ev.button === 0) ev.preventDefault()
    })
    return b
  }
}
