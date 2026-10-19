// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyOutlineWidth, attachOutlineResize } from '../../../src/renderer/ui/outline-resize'

let grip: HTMLElement
let outline: HTMLElement
let commit: ReturnType<typeof vi.fn<(em: number | null) => void>>

beforeEach(() => {
  grip = document.createElement('div')
  outline = document.createElement('nav')
  outline.style.fontSize = '15px'
  outline.getBoundingClientRect = () => ({ width: 270 }) as DOMRect
  grip.setPointerCapture = () => {}
  grip.releasePointerCapture = () => {}
  commit = vi.fn<(em: number | null) => void>()
  attachOutlineResize(grip, outline, { commit })
})

const pointer = (type: string, clientX: number) =>
  grip.dispatchEvent(new PointerEvent(type, { clientX, button: 0, pointerId: 1, bubbles: true }))

describe('attachOutlineResize', () => {
  it('dragging left widens the outline; the width is committed in em on release', () => {
    pointer('pointerdown', 500)
    pointer('pointermove', 470) // 30px to the left: 270 + 30 = 300px = 20em at 15px
    expect(outline.style.width).toBe('20em')
    expect(commit).not.toHaveBeenCalled()
    pointer('pointerup', 470)
    expect(commit).toHaveBeenCalledWith(20)
  })
  it('clamps to 10–40em', () => {
    pointer('pointerdown', 500)
    pointer('pointermove', 900)
    expect(outline.style.width).toBe('10em')
    pointer('pointermove', -900)
    expect(outline.style.width).toBe('40em')
    pointer('pointerup', -900)
    expect(commit).toHaveBeenLastCalledWith(40)
  })
  it('a click without moving commits nothing', () => {
    pointer('pointerdown', 500)
    pointer('pointerup', 500)
    expect(commit).not.toHaveBeenCalled()
  })
  it('double-click resets to the default width', () => {
    applyOutlineWidth(outline, 25)
    grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(outline.style.width).toBe('')
    expect(commit).toHaveBeenCalledWith(null)
  })
  it('arrow keys change the width by 1em', () => {
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(commit).toHaveBeenLastCalledWith(19)
    expect(outline.style.width).toBe('19em')
  })
})

describe('applyOutlineWidth', () => {
  it('sets the width in em and marks a custom width; null restores the default', () => {
    applyOutlineWidth(outline, 22)
    expect(outline.style.width).toBe('22em')
    expect(outline.classList.contains('mdo-ol-custom')).toBe(true)
    applyOutlineWidth(outline, null)
    expect(outline.style.width).toBe('')
    expect(outline.classList.contains('mdo-ol-custom')).toBe(false)
  })
})
