// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatClock, InfoLine } from '../../../src/renderer/ui/infoline'

const actions = () => ({
  selectTab: vi.fn(),
  exitPresent: vi.fn(),
  showCode: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  toggleOutline: vi.fn(),
  toggleFocus: vi.fn(),
})
const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid=${id}]`) as HTMLElement

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('formatClock', () => {
  it('pads hours and minutes', () => {
    expect(formatClock(new Date(2026, 9, 15, 9, 5))).toBe('09:05')
    expect(formatClock(new Date(2026, 9, 15, 23, 59))).toBe('23:59')
  })
})

describe('InfoLine', () => {
  it('renders tabs, state and zoom, and calls the actions', () => {
    const el = document.createElement('footer')
    const a = actions()
    const line = new InfoLine(el, a, () => new Date(2026, 9, 15, 14, 30))
    line.render(
      [
        { name: 'A.md', dirty: false },
        { name: 'B.md', dirty: true },
      ],
      1,
      'Gespeichert',
      1.25,
      false,
    )
    const tabs = el.querySelectorAll('[data-testid=il-tab]')
    expect([...tabs].map((t) => t.textContent)).toEqual(['A.md', 'B.md'])
    expect(tabs[1]?.classList.contains('active')).toBe(true)
    expect(tabs[1]?.classList.contains('dirty')).toBe(true)
    expect(q(el, 'il-state').textContent).toBe('Gespeichert')
    expect(q(el, 'il-zoom').textContent).toBe('125 %')
    ;(tabs[0] as HTMLElement).click()
    q(el, 'il-edit').click()
    q(el, 'il-zoom-in').click()
    q(el, 'il-zoom-out').click()
    expect(a.selectTab).toHaveBeenCalledWith(0)
    expect(a.exitPresent).toHaveBeenCalledOnce()
    expect(a.zoomIn).toHaveBeenCalledOnce()
    expect(a.zoomOut).toHaveBeenCalledOnce()
  })
  it('shows the outline toggle lifted when the outline is on and calls the action', () => {
    const el = document.createElement('footer')
    const a = actions()
    const line = new InfoLine(el, a)
    line.render([{ name: 'A.md', dirty: false }], 0, 'Gespeichert', 1, false)
    const b = q(el, 'il-outline')
    expect(b.textContent).toBe('Gliederung')
    expect(b.getAttribute('aria-pressed')).toBe('false')
    line.render([{ name: 'A.md', dirty: false }], 0, 'Gespeichert', 1, true)
    expect(b.classList.contains('active')).toBe(true)
    expect(b.getAttribute('aria-pressed')).toBe('true')
    b.click()
    expect(a.toggleOutline).toHaveBeenCalledOnce()
    // No YAML toggle: Present refuses the header toggle.
    expect(q(el, 'il-yaml')).toBeNull()
  })
  it('shows the focus toggle lifted when focus is on and calls the action', () => {
    const el = document.createElement('footer')
    const a = actions()
    const line = new InfoLine(el, a)
    line.render([{ name: 'A.md', dirty: false }], 0, 'Gespeichert', 1, false, true)
    const b = q(el, 'il-focus')
    expect(b.textContent).toBe('Fokus')
    expect(b.getAttribute('aria-pressed')).toBe('true')
    b.click()
    expect(a.toggleFocus).toHaveBeenCalledOnce()
  })
  it('updates the clock while started and stops cleanly', () => {
    let now = new Date(2026, 9, 15, 14, 30)
    const el = document.createElement('footer')
    const line = new InfoLine(el, actions(), () => now)
    line.start()
    expect(q(el, 'il-clock').textContent).toBe('14:30')
    now = new Date(2026, 9, 15, 14, 31)
    vi.advanceTimersByTime(60_000)
    expect(q(el, 'il-clock').textContent).toBe('14:31')
    line.stop()
    now = new Date(2026, 9, 15, 15, 0)
    vi.advanceTimersByTime(60_000)
    expect(q(el, 'il-clock').textContent).toBe('14:31')
  })
  it('ticks right at the minute boundary, not up to 15 s late', () => {
    vi.setSystemTime(new Date(2026, 9, 15, 14, 30, 45, 500))
    const el = document.createElement('footer')
    const line = new InfoLine(el, actions())
    line.start()
    expect(q(el, 'il-clock').textContent).toBe('14:30')
    vi.advanceTimersByTime(14_499)
    expect(q(el, 'il-clock').textContent).toBe('14:30')
    vi.advanceTimersByTime(1)
    expect(q(el, 'il-clock').textContent).toBe('14:31')
    vi.advanceTimersByTime(59_999)
    expect(q(el, 'il-clock').textContent).toBe('14:31')
    vi.advanceTimersByTime(1)
    expect(q(el, 'il-clock').textContent).toBe('14:32')
    line.stop()
  })
  it('shows Präsentation lifted and Vorschau fixed; Editor leaves Present', () => {
    const el = document.createElement('footer')
    const a = actions()
    new InfoLine(el, a)
    const children = [...el.children].map((c) => c.className)
    expect(children.slice(0, 2)).toEqual(['mdo-il-clock', 'mdo-switches'])
    expect(q(el, 'il-present').classList.contains('active')).toBe(true)
    expect(q(el, 'il-preview').classList.contains('active')).toBe(true)
    expect(q(el, 'il-code').classList.contains('active')).toBe(false)
    expect((q(el, 'il-preview') as HTMLButtonElement).disabled).toBe(true)
    q(el, 'il-present').click()
    q(el, 'il-preview').click()
    expect(a.exitPresent).not.toHaveBeenCalled()
    expect(a.showCode).not.toHaveBeenCalled()
    q(el, 'il-edit').click()
    expect(a.exitPresent).toHaveBeenCalledOnce()
  })
  it('Code is enabled in Present and ends it to show the Code view', () => {
    const el = document.createElement('footer')
    const a = actions()
    new InfoLine(el, a)
    const code = q(el, 'il-code') as HTMLButtonElement
    expect(code.disabled).toBe(false)
    expect(code.title).toBe('Präsentation beenden und Code zeigen')
    expect(q(el, 'il-preview').title).toBe('Beim Präsentieren immer Vorschau')
    code.click()
    expect(a.showCode).toHaveBeenCalledOnce()
    expect(a.exitPresent).not.toHaveBeenCalled()
  })
  it('renders names as text, never HTML', () => {
    const el = document.createElement('footer')
    new InfoLine(el, actions()).render([{ name: '<b>x</b>.md', dirty: false }], 0, '', 1)
    expect(el.querySelector('b')).toBeNull()
  })
})

describe('InfoLine focus and lifecycle', () => {
  it('gives every button type=button and tabIndex -1', () => {
    const el = document.createElement('footer')
    const line = new InfoLine(el, actions())
    line.render([{ name: 'A.md', dirty: false }], 0, '', 1)
    const buttons = el.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const b of buttons) {
      expect(b.type).toBe('button')
      expect(b.tabIndex).toBe(-1)
    }
  })
  it('cancels mousedown on the primary button so the editor keeps focus', () => {
    const el = document.createElement('footer')
    new InfoLine(el, actions()).render([{ name: 'A.md', dirty: false }], 0, '', 1)
    const ev = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true })
    q(el, 'il-edit').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })
  it('does not cancel mousedown on non-primary buttons', () => {
    const el = document.createElement('footer')
    new InfoLine(el, actions()).render([{ name: 'A.md', dirty: false }], 0, '', 1)
    const ev = new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true })
    q(el, 'il-zoom-in').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })
  it('ticks once per minute even when start() is called twice', () => {
    vi.setSystemTime(new Date(2026, 9, 15, 14, 30))
    const now = vi.fn(() => new Date())
    const el = document.createElement('footer')
    const line = new InfoLine(el, actions(), now)
    line.start()
    line.start()
    const afterStart = now.mock.calls.length
    vi.advanceTimersByTime(60_000)
    expect(now.mock.calls.length - afterStart).toBe(1)
    line.stop()
  })
  it('stop() before start() and a double stop() do not throw', () => {
    const line = new InfoLine(document.createElement('footer'), actions())
    expect(() => line.stop()).not.toThrow()
    line.start()
    line.stop()
    expect(() => line.stop()).not.toThrow()
  })
})

describe('InfoLine refresh keeps the tab buttons', () => {
  const tabs = (dirty: boolean) => [
    { name: 'A.md', dirty },
    { name: 'B.md', dirty: false },
  ]
  it('updates tab buttons in place, so a click spanning a refresh is not lost', () => {
    const el = document.createElement('footer')
    const a = actions()
    const line = new InfoLine(el, a)
    line.render(tabs(false), 1, 'Gespeichert', 1)
    const first = el.querySelectorAll('[data-testid=il-tab]')[0] as HTMLElement
    first.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    // An autosave state change refreshes the line between mousedown and mouseup.
    line.render(tabs(true), 1, 'Speichert …', 1)
    expect(el.querySelectorAll('[data-testid=il-tab]')[0]).toBe(first)
    expect(el.contains(first)).toBe(true)
    expect(first.classList.contains('dirty')).toBe(true)
    first.click()
    expect(a.selectTab).toHaveBeenCalledWith(0)
  })
  it('follows renames, the active tab and a changed tab count', () => {
    const el = document.createElement('footer')
    const a = actions()
    const line = new InfoLine(el, a)
    line.render(tabs(false), 0, '', 1)
    line.render([{ name: 'C.md', dirty: false }, ...tabs(false)], 2, '', 1)
    let buttons = [...el.querySelectorAll('[data-testid=il-tab]')] as HTMLElement[]
    expect(buttons.map((b) => b.textContent)).toEqual(['C.md', 'A.md', 'B.md'])
    expect(buttons.map((b) => b.title)).toEqual(['C.md', 'A.md', 'B.md'])
    expect(buttons.map((b) => b.classList.contains('active'))).toEqual([false, false, true])
    buttons[2]?.click()
    expect(a.selectTab).toHaveBeenLastCalledWith(2)
    line.render([{ name: 'B.md', dirty: false }], 0, '', 1)
    buttons = [...el.querySelectorAll('[data-testid=il-tab]')] as HTMLElement[]
    expect(buttons.map((b) => b.textContent)).toEqual(['B.md'])
    expect(buttons[0]?.classList.contains('active')).toBe(true)
  })
})
