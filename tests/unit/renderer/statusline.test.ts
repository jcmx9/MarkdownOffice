// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusLine, saveText } from '../../../src/renderer/ui/statusline'

const actions = () => ({ noteMenu: vi.fn(), setMode: vi.fn(), setView: vi.fn() })
const q = (el: HTMLElement, id: string) =>
  el.querySelector(`[data-testid=${id}]`) as HTMLButtonElement

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('status line', () => {
  it('shows a hold with its reason, styled like a failed save', () => {
    const el = document.createElement('div')
    const status = new StatusLine(el, actions())
    status.render(
      'a.md',
      'held',
      'Datei außerhalb gelöscht – bitte im Hinweis entscheiden',
      'preview',
    )
    const state = el.querySelector('[data-testid=status-state]')
    expect(state?.textContent).toBe(
      'Nicht gespeichert: Datei außerhalb gelöscht – bitte im Hinweis entscheiden',
    )
    expect(state?.classList.contains('error')).toBe(true)
    status.render('a.md', 'saved', null, 'preview')
    expect(state?.textContent).toBe('Gespeichert')
    expect(state?.classList.contains('error')).toBe(false)
  })

  it.each([
    ['error', 'x', 'Speichern fehlgeschlagen: x'],
    ['held', 'y', 'Nicht gespeichert: y'],
    ['dirty', null, 'Ungespeichert'],
  ] as const)('saveText(%s)', (state, reason, text) => {
    expect(saveText(state, reason)).toBe(text)
  })

  it('shows the clock and the switches next to it, before the file name', () => {
    const el = document.createElement('footer')
    const status = new StatusLine(el, actions(), () => new Date(2026, 9, 16, 9, 7))
    status.render('a.md', 'saved', null, 'code')
    expect(q(el, 'status-clock').textContent).toBe('09:07')
    const order = [...el.children].map((c) => c.className)
    expect(order.slice(0, 3)).toEqual(['clock', 'mdo-switches', 'file'])
    status.stop()
  })

  it('lifts the current mode and view; a click on the other side switches', () => {
    const el = document.createElement('footer')
    const a = actions()
    const status = new StatusLine(el, a)
    status.render('a.md', 'saved', null, 'code')
    expect(q(el, 'status-edit').classList.contains('active')).toBe(true)
    expect(q(el, 'status-code').getAttribute('aria-pressed')).toBe('true')
    expect(q(el, 'status-preview').getAttribute('aria-pressed')).toBe('false')
    q(el, 'status-preview').click()
    q(el, 'status-present').click()
    expect(a.setView).toHaveBeenCalledWith('preview')
    expect(a.setMode).toHaveBeenCalledWith('present')
    status.render('a.md', 'saved', null, 'preview')
    expect(q(el, 'status-preview').classList.contains('active')).toBe(true)
    expect(q(el, 'status-code').classList.contains('active')).toBe(false)
    status.stop()
  })

  it('cannot start Present without an open note', () => {
    const el = document.createElement('footer')
    const status = new StatusLine(el, actions())
    status.render(null, 'saved', null, 'preview')
    expect(q(el, 'status-present').disabled).toBe(true)
    status.render('a.md', 'saved', null, 'preview')
    expect(q(el, 'status-present').disabled).toBe(false)
    status.stop()
  })

  it('keeps focus in the editor: switches are not focusable and cancel mousedown', () => {
    const el = document.createElement('footer')
    const status = new StatusLine(el, actions())
    status.render('a.md', 'saved', null, 'preview')
    for (const id of ['status-edit', 'status-present', 'status-code', 'status-preview']) {
      expect(q(el, id).tabIndex).toBe(-1)
      const ev = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true })
      q(el, id).dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(true)
    }
    status.stop()
  })

  it('has no export button; an export shows only a quiet progress text', () => {
    const el = document.createElement('footer')
    const status = new StatusLine(el, actions())
    status.render('a.md', 'saved', null, 'preview')
    expect(el.querySelector('button.export, [data-testid=export]')).toBeNull()
    const progress = el.querySelector('[data-testid=status-export]') as HTMLElement
    expect(progress.hidden).toBe(true)
    status.setExporting(true)
    expect(status.exporting).toBe(true)
    expect(progress.hidden).toBe(false)
    expect(progress.textContent).toBe('PDF wird erstellt …')
    status.setExporting(false)
    expect(progress.hidden).toBe(true)
    status.stop()
  })

  it('opens the note menu on a right click on the file name, not without a note', () => {
    const el = document.createElement('footer')
    const a = actions()
    const status = new StatusLine(el, a)
    const file = el.querySelector('[data-testid=status-file]') as HTMLElement
    status.render(null, 'saved', null, 'preview')
    file.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(a.noteMenu).not.toHaveBeenCalled()
    status.render('a.md', 'saved', null, 'preview')
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    file.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(a.noteMenu).toHaveBeenCalledOnce()
    status.stop()
  })
})
