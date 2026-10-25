// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { TableGrid } from '../../../src/renderer/ui/table-grid'

function setup() {
  const pick = vi.fn()
  const cancel = vi.fn()
  const grid = new TableGrid(pick, cancel)
  document.body.append(grid.el)
  const cell = (c: number, r: number) =>
    grid.el.querySelector(`[data-col="${c}"][data-row="${r}"]`) as HTMLElement
  const label = () => grid.el.querySelector('[data-testid=fmt-grid-label]')?.textContent
  const key = (k: string) =>
    grid.el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  return { grid, pick, cancel, cell, label, key }
}

describe('table grid', () => {
  it('has 8 columns × 10 rows of cells and starts at 1 × 1', () => {
    const { grid, label } = setup()
    expect(grid.el.querySelectorAll('[data-col]')).toHaveLength(80)
    expect(grid.el.getAttribute('role')).toBe('grid')
    expect(label()).toBe('1 × 1')
  })

  it('hover shows the size and highlights the covered cells; a click reports it', () => {
    const { cell, label, pick } = setup()
    cell(3, 4).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(label()).toBe('3 × 4')
    expect(cell(3, 4).classList.contains('on')).toBe(true)
    expect(cell(1, 1).classList.contains('on')).toBe(true)
    expect(cell(4, 4).classList.contains('on')).toBe(false)
    expect(cell(3, 5).classList.contains('on')).toBe(false)
    cell(3, 4).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(pick).toHaveBeenCalledWith({ cols: 3, rows: 4 })
  })

  it('cancels mousedown so focus stays in the grid', () => {
    const { cell } = setup()
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    cell(2, 2).dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('arrow keys move within 8 × 10, Enter reports the size', () => {
    const { key, label, pick } = setup()
    key('ArrowRight')
    key('ArrowRight')
    key('ArrowDown')
    expect(label()).toBe('3 × 2')
    key('ArrowLeft')
    key('ArrowUp')
    key('ArrowUp')
    expect(label()).toBe('2 × 1')
    for (let i = 0; i < 12; i++) key('ArrowRight')
    for (let i = 0; i < 12; i++) key('ArrowDown')
    expect(label()).toBe('8 × 10')
    key('Enter')
    expect(pick).toHaveBeenCalledWith({ cols: 8, rows: 10 })
  })

  it('Esc cancels', () => {
    const { key, cancel, pick } = setup()
    key('Escape')
    expect(cancel).toHaveBeenCalledOnce()
    expect(pick).not.toHaveBeenCalled()
  })

  it('reset() goes back to 1 × 1', () => {
    const { grid, key, label } = setup()
    key('ArrowRight')
    grid.reset()
    expect(label()).toBe('1 × 1')
  })
})
