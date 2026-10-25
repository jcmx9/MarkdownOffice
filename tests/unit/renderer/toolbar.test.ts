// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormatId } from '../../../src/renderer/editor/format'
import { ALERT_ENTRIES } from '../../../src/renderer/editor/format'
import { Toolbar } from '../../../src/renderer/ui/toolbar'

type State = Parameters<Toolbar['render']>[0]
const base = (over: Partial<State> = {}): State => ({
  visible: true,
  enabled: true,
  active: new Set(),
  table: { inTable: false, rowDelete: false, colDelete: false },
  ...over,
})

function setup(state: State = base()) {
  document.body.replaceChildren()
  const editor = document.createElement('textarea')
  const el = document.createElement('div')
  document.body.append(editor, el)
  editor.focus()
  const onAction = vi.fn()
  const bar = new Toolbar(el, onAction)
  bar.render(state)
  const q = (id: string) => el.querySelector(`[data-testid=${id}]`) as HTMLButtonElement
  const click = (id: string) => q(id).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const key = (target: Element, k: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  return { bar, el, editor, onAction, q, click, key }
}

afterEach(() => document.body.replaceChildren())

const ORDER = [
  ['fmt-h1', 'fmt-h2', 'fmt-h3'],
  ['fmt-bold', 'fmt-italic', 'fmt-strike', 'fmt-mark', 'fmt-code'],
  ['fmt-bullet', 'fmt-numbered', 'fmt-task', 'fmt-quote'],
  ['fmt-link'],
  ['fmt-table'],
  ['fmt-box'],
  ['fmt-pagebreak'],
]

describe('formatting toolbar', () => {
  it('is a toolbar with the groups in the spec order', () => {
    const { el } = setup()
    expect(el.getAttribute('role')).toBe('toolbar')
    expect(el.getAttribute('aria-label')).toBe('Formatierung')
    const groups = [...el.querySelectorAll('.mdo-fmt-group')].map((g) =>
      [...g.querySelectorAll('button')].map((b) => b.dataset.testid),
    )
    expect(groups).toEqual(ORDER)
    expect(el.querySelectorAll('.mdo-fmt-sep')).toHaveLength(ORDER.length - 1)
  })

  it('gives every button a German aria-label, a tooltip and an icon', () => {
    const { el, q } = setup()
    const labels: Record<string, string> = {
      'fmt-h1': 'Überschrift 1',
      'fmt-h2': 'Überschrift 2',
      'fmt-h3': 'Überschrift 3',
      'fmt-bold': 'Fett',
      'fmt-italic': 'Kursiv',
      'fmt-strike': 'Durchgestrichen',
      'fmt-mark': 'Markieren',
      'fmt-code': 'Code',
      'fmt-bullet': 'Aufzählung',
      'fmt-numbered': 'Nummerierte Liste',
      'fmt-task': 'Aufgabe',
      'fmt-quote': 'Zitat',
      'fmt-link': 'Link',
      'fmt-table': 'Tabelle',
      'fmt-box': 'Hinweisbox',
      'fmt-pagebreak': 'Seitenumbruch',
    }
    for (const [id, label] of Object.entries(labels)) {
      expect(q(id).getAttribute('aria-label')).toBe(label)
      expect(q(id).title.startsWith(label)).toBe(true)
      expect(q(id).querySelector('svg'), id).not.toBeNull()
    }
    expect(el.querySelectorAll('button')).toHaveLength(Object.keys(labels).length)
    expect(q('fmt-table').querySelectorAll('svg')).toHaveLength(2)
    expect(q('fmt-box').getAttribute('aria-haspopup')).toBe('menu')
  })

  it('inserts the icons as SVG DOM, hidden from assistive tech', () => {
    const { q } = setup()
    const svg = q('fmt-bold').querySelector('svg') as SVGElement
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelector('path')).not.toBeNull()
  })

  it('sets aria-pressed from the active formats and the table', () => {
    const { bar, q } = setup()
    bar.render(base({ active: new Set<FormatId | 'table'>(['bold', 'h2', 'table']) }))
    expect(q('fmt-bold').getAttribute('aria-pressed')).toBe('true')
    expect(q('fmt-bold').classList.contains('active')).toBe(true)
    expect(q('fmt-h2').getAttribute('aria-pressed')).toBe('true')
    expect(q('fmt-table').getAttribute('aria-pressed')).toBe('true')
    expect(q('fmt-italic').getAttribute('aria-pressed')).toBe('false')
    expect(q('fmt-box').hasAttribute('aria-pressed')).toBe(false)
    expect(q('fmt-pagebreak').hasAttribute('aria-pressed')).toBe(false)
    bar.render(base())
    expect(q('fmt-bold').getAttribute('aria-pressed')).toBe('false')
  })

  it('cancels mousedown on every button so the editor keeps focus', () => {
    const { el, editor } = setup()
    for (const b of el.querySelectorAll('button')) {
      expect(b.tabIndex).toBe(-1)
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
      b.dispatchEvent(e)
      expect(e.defaultPrevented, b.dataset.testid).toBe(true)
    }
    expect(document.activeElement).toBe(editor)
  })

  it('reports format and page break clicks', () => {
    const { click, onAction } = setup()
    click('fmt-italic')
    click('fmt-numbered')
    click('fmt-link')
    click('fmt-pagebreak')
    expect(onAction.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'format', id: 'italic' },
      { kind: 'format', id: 'numbered' },
      { kind: 'format', id: 'link' },
      { kind: 'pagebreak' },
    ])
  })

  it('hides the row when not visible and disables every button when not enabled', () => {
    const { bar, el } = setup()
    bar.render(base({ visible: false }))
    expect(el.hidden).toBe(true)
    bar.render(base({ enabled: false }))
    expect(el.hidden).toBe(false)
    for (const b of el.querySelectorAll('button')) expect(b.disabled).toBe(true)
    bar.render(base())
    for (const b of el.querySelectorAll('button')) expect(b.disabled).toBe(false)
  })

  describe('Tabelle ▾ outside a table', () => {
    it('opens the grid, focuses it, and Enter reports the size', () => {
      const { el, click, key, onAction, q } = setup()
      click('fmt-table')
      const grid = el.querySelector('[data-testid=fmt-grid]') as HTMLElement
      expect(grid).not.toBeNull()
      expect(q('fmt-table').getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(grid)
      key(grid, 'ArrowRight')
      key(grid, 'ArrowDown')
      key(grid, 'Enter')
      expect(onAction).toHaveBeenCalledWith({ kind: 'table-insert', cols: 2, rows: 2 })
      expect(el.querySelector('[data-testid=fmt-grid]')).toBeNull()
      expect(q('fmt-table').getAttribute('aria-expanded')).toBe('false')
    })

    it('Esc closes the grid and returns focus to the editor', () => {
      const { el, click, key, editor, onAction } = setup()
      click('fmt-table')
      key(el.querySelector('[data-testid=fmt-grid]') as HTMLElement, 'Escape')
      expect(el.querySelector('[data-testid=fmt-grid]')).toBeNull()
      expect(document.activeElement).toBe(editor)
      expect(onAction).not.toHaveBeenCalled()
    })

    it('an outside click closes the grid; a second click on the button toggles it', () => {
      const { el, click } = setup()
      click('fmt-table')
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      expect(el.querySelector('[data-testid=fmt-grid]')).toBeNull()
      click('fmt-table')
      expect(el.querySelector('[data-testid=fmt-grid]')).not.toBeNull()
      click('fmt-table')
      expect(el.querySelector('[data-testid=fmt-grid]')).toBeNull()
    })
  })

  describe('Tabelle ▾ in a table', () => {
    const inTable = (rowDelete: boolean, colDelete: boolean) =>
      base({ active: new Set(['table']), table: { inTable: true, rowDelete, colDelete } })

    it('shows the four row/column entries with their enabled flags', () => {
      const { el, click } = setup(inTable(false, true))
      click('fmt-table')
      const menu = el.querySelector('[data-testid=fmt-table-menu]') as HTMLElement
      expect(menu.getAttribute('role')).toBe('menu')
      expect(el.querySelector('[data-testid=fmt-grid]')).toBeNull()
      const items = [...menu.querySelectorAll('[role=menuitem]')] as HTMLButtonElement[]
      expect(items.map((i) => i.textContent)).toEqual([
        'Zeile darunter einfügen',
        'Spalte rechts einfügen',
        'Zeile löschen',
        'Spalte löschen',
      ])
      expect(items.map((i) => i.disabled)).toEqual([false, false, true, false])
    })

    it('reports the chosen entry and closes', () => {
      const { el, click, onAction } = setup(inTable(true, true))
      click('fmt-table')
      const del = el.querySelector('[data-testid=fmt-table-col-delete]') as HTMLButtonElement
      del.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onAction).toHaveBeenCalledWith({ kind: 'table', op: 'col-delete' })
      expect(el.querySelector('[data-testid=fmt-table-menu]')).toBeNull()
    })

    it('arrow keys skip disabled entries, Enter activates, Esc returns focus', () => {
      const { el, click, key, onAction, editor } = setup(inTable(false, true))
      click('fmt-table')
      const menu = el.querySelector('[data-testid=fmt-table-menu]') as HTMLElement
      const id = () => (document.activeElement as HTMLElement).dataset.testid
      expect(id()).toBe('fmt-table-row-below')
      key(menu, 'ArrowDown')
      expect(id()).toBe('fmt-table-col-right')
      key(menu, 'ArrowDown')
      expect(id()).toBe('fmt-table-col-delete')
      key(menu, 'ArrowDown')
      expect(id()).toBe('fmt-table-row-below')
      key(menu, 'ArrowUp')
      expect(id()).toBe('fmt-table-col-delete')
      key(menu, 'Enter')
      expect(onAction).toHaveBeenCalledWith({ kind: 'table', op: 'col-delete' })
      click('fmt-table')
      key(el.querySelector('[data-testid=fmt-table-menu]') as HTMLElement, 'Escape')
      expect(el.querySelector('[data-testid=fmt-table-menu]')).toBeNull()
      expect(document.activeElement).toBe(editor)
    })

    it('closes an open popup when the cursor leaves the table or the bar is disabled', () => {
      const { bar, el, click } = setup(inTable(true, true))
      click('fmt-table')
      bar.render(base())
      expect(el.querySelector('[data-testid=fmt-table-menu]')).toBeNull()
      click('fmt-table')
      expect(el.querySelector('[data-testid=fmt-grid]')).not.toBeNull()
      bar.render(base({ enabled: false }))
      expect(el.querySelector('[data-testid=fmt-grid]')).toBeNull()
    })
  })

  describe('Box ▾', () => {
    it('lists the alert entries with their keyword and reports the type', () => {
      const { el, click, onAction } = setup()
      click('fmt-box')
      const menu = el.querySelector('[data-testid=fmt-box-menu]') as HTMLElement
      expect(menu.getAttribute('role')).toBe('menu')
      const items = [...menu.querySelectorAll('[role=menuitem]')] as HTMLButtonElement[]
      expect(items).toHaveLength(ALERT_ENTRIES.length)
      ALERT_ENTRIES.forEach((entry, i) => {
        expect(items[i]?.querySelector('.mdo-fmt-label')?.textContent).toBe(entry.label)
        expect(items[i]?.querySelector('.mdo-fmt-keyword')?.textContent).toBe(entry.keyword)
        expect(items[i]?.getAttribute('aria-label')).toBe(`${entry.label} (${entry.keyword})`)
      })
      items[3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onAction).toHaveBeenCalledWith({ kind: 'alert', type: 'warning' })
      expect(el.querySelector('[data-testid=fmt-box-menu]')).toBeNull()
    })

    it('Space activates the focused entry; opening Box closes the table popup', () => {
      const { el, click, key, onAction } = setup()
      click('fmt-table')
      click('fmt-box')
      expect(el.querySelector('[data-testid=fmt-grid]')).toBeNull()
      const menu = el.querySelector('[data-testid=fmt-box-menu]') as HTMLElement
      key(menu, 'ArrowDown')
      key(menu, ' ')
      expect(onAction).toHaveBeenCalledWith({ kind: 'alert', type: 'tip' })
    })
  })
})
