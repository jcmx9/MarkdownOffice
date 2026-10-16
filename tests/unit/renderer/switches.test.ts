// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { ModeSwitches } from '../../../src/renderer/ui/switches'

const q = (el: HTMLElement, id: string) =>
  el.querySelector(`[data-testid=${id}]`) as HTMLButtonElement

describe('ModeSwitches', () => {
  it('in Present: Vorschau lifted and fixed, Code enabled to end Present', () => {
    const actions = { setMode: vi.fn(), setView: vi.fn() }
    const sw = new ModeSwitches('x', actions)
    sw.render('present', 'code', true)
    expect(q(sw.el, 'x-preview').classList.contains('active')).toBe(true)
    expect(q(sw.el, 'x-code').classList.contains('active')).toBe(false)
    expect(q(sw.el, 'x-preview').disabled).toBe(true)
    expect(q(sw.el, 'x-preview').title).toBe('Beim Präsentieren immer Vorschau')
    expect(q(sw.el, 'x-code').disabled).toBe(false)
    expect(q(sw.el, 'x-code').title).toBe('Präsentation beenden und Code zeigen')
    q(sw.el, 'x-code').click()
    expect(actions.setView).toHaveBeenCalledWith('code')
  })

  it('in Edit: both view sides enabled with their plain titles', () => {
    const sw = new ModeSwitches('x', { setMode: vi.fn(), setView: vi.fn() })
    sw.render('present', 'preview', true)
    sw.render('edit', 'preview', true)
    expect(q(sw.el, 'x-code').disabled).toBe(false)
    expect(q(sw.el, 'x-preview').disabled).toBe(false)
    expect(q(sw.el, 'x-code').title).toBe('Code-Ansicht')
    expect(q(sw.el, 'x-preview').title).toBe('Vorschau')
  })
})
