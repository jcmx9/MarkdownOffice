// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusLine, saveText } from '../../../src/renderer/ui/statusline'

const actions = () => ({
  noteMenu: vi.fn(),
  setMode: vi.fn(),
  setView: vi.fn(),
  toggleOutline: vi.fn(),
  toggleFocus: vi.fn(),
  toggleYaml: vi.fn(),
  toggleToolbar: vi.fn(),
  validateYaml: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
})
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
    expect(order.slice(0, 4)).toEqual(['clock', 'mdo-switches', 'mdo-switches', 'file'])
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

  it('lifts Gliederung and YAML by state; clicks call the toggle actions', () => {
    const el = document.createElement('footer')
    const a = actions()
    const status = new StatusLine(el, a)
    status.render('a.md', 'saved', null, 'preview', {
      toolbar: true,
      outline: true,
      focus: false,
      hasHeader: true,
      yamlOn: false,
    })
    expect(q(el, 'status-outline').getAttribute('aria-pressed')).toBe('true')
    expect(q(el, 'status-yaml').getAttribute('aria-pressed')).toBe('false')
    expect(q(el, 'status-yaml').disabled).toBe(false)
    q(el, 'status-outline').click()
    q(el, 'status-yaml').click()
    expect(a.toggleOutline).toHaveBeenCalledOnce()
    expect(a.toggleYaml).toHaveBeenCalledOnce()
    status.stop()
  })

  it('„Fokus“ sits between „Gliederung“ and „YAML“, lifted by state, resting without a note', () => {
    const el = document.createElement('footer')
    const a = actions()
    const status = new StatusLine(el, a)
    const ids = [...el.querySelectorAll('[data-testid]')].map((b) => b.getAttribute('data-testid'))
    expect(ids.indexOf('status-focus')).toBe(ids.indexOf('status-outline') + 1)
    expect(ids.indexOf('status-yaml')).toBe(ids.indexOf('status-focus') + 1)
    const on = { toolbar: true, outline: false, focus: true, hasHeader: true, yamlOn: true }
    status.render('a.md', 'saved', null, 'preview', on)
    expect(q(el, 'status-focus').getAttribute('aria-pressed')).toBe('true')
    q(el, 'status-focus').click()
    expect(a.toggleFocus).toHaveBeenCalledOnce()
    status.render(null, 'saved', null, 'preview', on)
    expect(q(el, 'status-focus').disabled).toBe(true)
    expect(q(el, 'status-focus').classList.contains('active')).toBe(false)
    // Code shows the full source: focus reads off and rests there.
    status.render('a.md', 'saved', null, 'code', on)
    expect(q(el, 'status-focus').disabled).toBe(true)
    expect(q(el, 'status-focus').classList.contains('active')).toBe(false)
    expect(q(el, 'status-focus').title).toBe('Der Fokus wirkt nur in der Vorschau')
    status.stop()
  })

  it('disables YAML without front matter, in Code and without a note; Gliederung without a note', () => {
    const el = document.createElement('footer')
    const status = new StatusLine(el, actions())
    const on = { toolbar: true, outline: true, focus: false, hasHeader: true, yamlOn: true }
    status.render('a.md', 'saved', null, 'preview', { ...on, hasHeader: false })
    expect(q(el, 'status-yaml').disabled).toBe(true)
    expect(q(el, 'status-yaml').classList.contains('active')).toBe(false)
    status.render('a.md', 'saved', null, 'code', on)
    expect(q(el, 'status-yaml').disabled).toBe(true)
    expect(q(el, 'status-yaml').classList.contains('active')).toBe(true)
    // Code always shows the header, also when the Preview hides it.
    status.render('a.md', 'saved', null, 'code', { ...on, yamlOn: false })
    expect(q(el, 'status-yaml').classList.contains('active')).toBe(true)
    status.render(null, 'saved', null, 'preview', on)
    expect(q(el, 'status-yaml').disabled).toBe(true)
    expect(q(el, 'status-outline').disabled).toBe(true)
    expect(q(el, 'status-outline').classList.contains('active')).toBe(false)
    status.render('a.md', 'saved', null, 'preview', on)
    expect(q(el, 'status-yaml').disabled).toBe(false)
    expect(q(el, 'status-outline').disabled).toBe(false)
    status.stop()
  })

  it('„Leiste“ sits left of „Gliederung“, lifted by state; a click toggles the toolbar', () => {
    const el = document.createElement('footer')
    const a = actions()
    const status = new StatusLine(el, a)
    const on = { outline: false, focus: false, hasHeader: true, yamlOn: true, toolbar: true }
    status.render('a.md', 'saved', null, 'preview', on)
    const leiste = q(el, 'status-toolbar')
    expect(leiste.textContent).toBe('Leiste')
    expect(leiste.title).toBe('Formatierungsleiste ein/aus (Mod+Shift+T)')
    expect(leiste.nextElementSibling).toBe(q(el, 'status-outline'))
    expect(leiste.getAttribute('aria-pressed')).toBe('true')
    leiste.click()
    expect(a.toggleToolbar).toHaveBeenCalledOnce()
    status.render('a.md', 'saved', null, 'code', { ...on, toolbar: false })
    expect(leiste.getAttribute('aria-pressed')).toBe('false')
    expect(leiste.disabled).toBe(false)
    status.stop()
  })

  it('disables „Leiste“ without a note, like the other switches', () => {
    const el = document.createElement('footer')
    const status = new StatusLine(el, actions())
    status.render(null, 'saved', null, 'preview', {
      outline: false,
      focus: false,
      hasHeader: false,
      yamlOn: false,
      toolbar: true,
    })
    expect(q(el, 'status-toolbar').disabled).toBe(true)
    expect(q(el, 'status-toolbar').classList.contains('active')).toBe(false)
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
    for (const id of [
      'status-edit',
      'status-present',
      'status-code',
      'status-preview',
      'status-toolbar',
      'status-outline',
      'status-yaml',
    ]) {
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

describe('status line set name', () => {
  const setEl = (el: HTMLElement) => el.querySelector('[data-testid=status-set]') as HTMLElement

  it('is hidden without a set and sits right after the file name', () => {
    const el = document.createElement('footer')
    const status = new StatusLine(el, actions())
    status.render('a.md', 'saved', null, 'preview')
    expect(setEl(el).hidden).toBe(true)
    expect(setEl(el).previousElementSibling?.className).toBe('file')
    status.renderSet({ name: 'memo', errors: 0, unknown: false })
    expect(setEl(el).hidden).toBe(false)
    status.renderSet(null)
    expect(setEl(el).hidden).toBe(true)
    expect(setEl(el).textContent).toBe('')
    status.stop()
  })

  it.each([
    [0, false, 'memo', false],
    [1, false, 'memo – 1 Fehler im YAML-Kopf', true],
    [2, false, 'memo – 2 Fehler im YAML-Kopf', true],
    [1, true, 'memo – 1 Fehler im YAML-Kopf (Set nicht installiert)', true],
  ])('%i errors (unknown %s): title %s, red %s', (errors, unknown, title, red) => {
    const el = document.createElement('footer')
    const status = new StatusLine(el, actions())
    status.renderSet({ name: 'memo', errors, unknown })
    expect(setEl(el).textContent).toBe('memo')
    expect(setEl(el).title).toBe(title)
    expect(setEl(el).classList.contains('error')).toBe(red)
    status.stop()
  })

  it('opens „YAML prüfen …“ on a click', () => {
    const el = document.createElement('footer')
    const a = actions()
    const status = new StatusLine(el, a)
    status.renderSet({ name: 'memo', errors: 1, unknown: false })
    setEl(el).click()
    expect(a.validateYaml).toHaveBeenCalledOnce()
    status.stop()
  })

  it('shows the zoom on the right; − and + call the actions', () => {
    const el = document.createElement('footer')
    const a = actions()
    const status = new StatusLine(el, a)
    status.render('a.md', 'saved', null, 'preview')
    status.renderZoom(1.25)
    expect(q(el, 'status-zoom').textContent).toBe('125 %')
    expect(el.lastElementChild?.className).toBe('right')
    q(el, 'status-zoom-in').click()
    q(el, 'status-zoom-out').click()
    expect(a.zoomIn).toHaveBeenCalledTimes(1)
    expect(a.zoomOut).toHaveBeenCalledTimes(1)
  })
})
