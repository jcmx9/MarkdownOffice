import type { OutlineEntry } from '../editor/outline'

export interface OutlineHandlers {
  jump(entry: OutlineEntry): void
  toggle(entry: OutlineEntry): void
}

interface Row {
  li: HTMLLIElement
  chevron: HTMLButtonElement
  /** Empty slot for an entry without children, so its label lines up with the chevron rows. */
  spacer: HTMLSpanElement
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
  /**
   * Room above the list (px) that puts it in the optical centre; null = measure on the next
   * render. Measured only on showing, a tab switch, a resize or a zoom change, never after a
   * fold or an edit, so the list does not move under the pointer.
   */
  private offset: number | null = null
  /** Room below the list (px) that keeps a collapse at the scroll end from pulling it down. */
  private tail = 0
  private zoom = ''
  /** Row whose chevron was clicked and its viewport top then; the next render holds it there. */
  private anchor: { row: Row; top: number } | null = null

  constructor(
    private readonly el: HTMLElement,
    private readonly handlers: OutlineHandlers,
  ) {
    this.empty.className = 'mdo-ol-empty'
    this.empty.textContent = 'Keine Überschriften'
    el.addEventListener('scroll', () => this.hideTip(), { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      let height = -1
      new ResizeObserver(() => {
        if (el.clientHeight === height) return
        height = el.clientHeight
        this.recentre()
        this.place()
      }).observe(el)
    }
  }

  setVisible(on: boolean): void {
    if (on && this.el.hidden) this.recentre()
    this.el.hidden = !on
  }

  /** The next render places the list in the optical centre again (tab switch, reload). */
  recentre(): void {
    this.offset = null
    this.anchor = null
  }

  render(entries: OutlineEntry[], active: OutlineEntry | null): void {
    this.hideTip()
    if (entries.length === 0) {
      this.recentre()
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

    this.place()

    const key = active ? (this.keys.get(active) ?? null) : null
    const row = key ? (this.rows.get(key) ?? null) : null
    this.activeRow?.label.classList.remove('active')
    row?.label.classList.add('active')
    if (row && key !== this.activeKey) row.label.scrollIntoView({ block: 'nearest' })
    this.activeRow = row
    this.activeKey = row ? key : null
  }

  /**
   * Places the list: two parts of the free height above it, three below, so it sits a little
   * above the middle, where a centred block looks centred; a list taller than the bar starts
   * at the top and scrolls. After a fold the clicked row stays exactly where it was.
   */
  private place(): void {
    const list = this.list
    if (!list) return
    const zoom = this.el.style.getPropertyValue('--mdo-ol-zoom')
    if (zoom !== this.zoom) {
      this.zoom = zoom
      this.recentre()
    }
    const anchor = this.anchor
    this.anchor = null
    if (this.offset === null) {
      this.tail = 0
      const pad = getComputedStyle(this.el)
      const inner =
        this.el.clientHeight -
        (Number.parseFloat(pad.paddingTop) || 0) -
        (Number.parseFloat(pad.paddingBottom) || 0)
      this.offset = Math.max(0, Math.round((inner - list.offsetHeight) * 0.4))
      this.apply(list)
      return
    }
    if (!anchor || !this.el.contains(anchor.row.li)) return
    // Expanding or collapsing changes only what follows the row; the browser may still pull
    // the list down when a collapse shortens it below the scroll position.
    const delta = anchor.row.label.getBoundingClientRect().top - anchor.top
    if (delta > 0) {
      const less = Math.min(this.offset, delta)
      this.offset -= less
      const rest = delta - less
      if (rest > 0) {
        this.tail += rest
        this.apply(list)
        this.el.scrollTop += rest
      }
    } else if (delta < 0) {
      const up = Math.min(this.el.scrollTop, -delta)
      this.el.scrollTop -= up
      this.offset += -delta - up
    }
    this.apply(list)
  }

  private apply(list: HTMLUListElement): void {
    list.style.marginTop = `${this.offset ?? 0}px`
    list.style.marginBottom = this.tail > 0 ? `${this.tail}px` : ''
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
    // keeps the slot empty (no bullet: the owner found the bullets restless, 2026-10-20).
    const hasFold = e.fold !== null && e.children.length > 0
    // parentNode, not isConnected: the list may be detached while it is being built.
    if ((row.chevron.parentNode !== null) !== hasFold) {
      // Chevron and spacer occupy the same slot.
      if (hasFold) row.spacer.replaceWith(row.chevron)
      else row.chevron.replaceWith(row.spacer)
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
    const spacer = document.createElement('span')
    spacer.className = 'mdo-ol-spacer'
    spacer.setAttribute('aria-hidden', 'true')
    const label = this.button('mdo-ol-label', e.text)
    const row: Row = { li, chevron, spacer, label, sub: null, entry: e }
    chevron.addEventListener('click', (ev) => {
      if (ev.button !== 0) return
      this.anchor = { row, top: row.label.getBoundingClientRect().top }
      this.handlers.toggle(row.entry)
    })
    label.addEventListener('click', (ev) => {
      if (ev.button === 0) this.handlers.jump(row.entry)
    })
    label.addEventListener('mouseenter', () => this.showTip(row))
    label.addEventListener('mouseleave', () => this.hideTip())
    li.append(e.fold && e.children.length > 0 ? chevron : spacer, label)
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
