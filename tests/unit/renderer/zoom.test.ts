import { describe, expect, it, vi } from 'vitest'
import {
  editorSizes,
  handleZoomKey,
  ZOOM_STEPS,
  zoomIn,
  zoomKey,
  zoomLabel,
  zoomOut,
} from '../../../src/renderer/ui/zoom'

describe('zoom steps', () => {
  it('walks the fixed steps and clamps at both ends', () => {
    expect(ZOOM_STEPS[0]).toBe(0.5)
    expect(ZOOM_STEPS.at(-1)).toBe(3)
    expect(zoomIn(1)).toBe(1.1)
    expect(zoomOut(1)).toBe(0.9)
    expect(zoomIn(3)).toBe(3)
    expect(zoomOut(0.5)).toBe(0.5)
  })
  it('snaps an off-step value to the next step in the direction', () => {
    expect(zoomIn(1.05)).toBe(1.1)
    expect(zoomOut(1.05)).toBe(1)
  })
  it('labels as rounded percent', () => {
    expect(zoomLabel(0.67)).toBe('67 %')
    expect(zoomLabel(1.25)).toBe('125 %')
  })
})

describe('editorSizes', () => {
  it('Edit: body 10pt and code 9pt at 100 %', () => {
    expect(editorSizes('edit', 1, 1.6)).toEqual({ body: '10pt', code: '9pt' })
  })
  it('Present: body 10pt × factor × zoom', () => {
    expect(editorSizes('present', 1, 1.6)).toEqual({ body: '16pt', code: '14.4pt' })
    expect(editorSizes('present', 1.25, 1.6)).toEqual({ body: '20pt', code: '18pt' })
  })
  it('rounds to two decimals', () => {
    expect(editorSizes('edit', 0.67, 1.6)).toEqual({ body: '6.7pt', code: '6.03pt' })
  })
})

type Key = {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}
const ev = (k: Key) => ({
  code: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...k,
})

describe('zoomKey', () => {
  it.each([
    // US: Mod+= and Mod+Shift+= ('+'); German: Mod+'+' without Shift
    [{ key: '=', code: 'Equal', ctrlKey: true }, 'in'],
    [{ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }, 'in'],
    [{ key: '+', code: 'BracketRight', ctrlKey: true }, 'in'],
    [{ key: '+', code: 'NumpadAdd', ctrlKey: true }, 'in'],
    [{ key: '-', code: 'Minus', ctrlKey: true }, 'out'],
    [{ key: '-', code: 'Slash', ctrlKey: true }, 'out'],
    [{ key: '-', code: 'NumpadSubtract', ctrlKey: true }, 'out'],
    [{ key: '0', code: 'Digit0', ctrlKey: true }, 'reset'],
    [{ key: '0', code: 'Numpad0', ctrlKey: true }, 'reset'],
    [{ key: 'Insert', code: 'Numpad0', ctrlKey: true }, 'reset'],
  ] as const)('Ctrl %o -> %s off macOS', (k, action) => {
    expect(zoomKey(ev(k), false)).toBe(action)
  })

  it('uses Cmd on macOS and Ctrl elsewhere', () => {
    expect(zoomKey(ev({ key: '+', metaKey: true }), true)).toBe('in')
    expect(zoomKey(ev({ key: '+', ctrlKey: true }), true)).toBeNull()
    expect(zoomKey(ev({ key: '+', metaKey: true }), false)).toBeNull()
  })

  it.each([
    { key: '+' }, // no modifier
    { key: '+', ctrlKey: true, altKey: true }, // AltGr / Alt combos stay free
    { key: '=', code: 'Digit0', ctrlKey: true, shiftKey: true }, // German Ctrl+Shift+0
    { key: '0', code: 'Digit0', ctrlKey: true, shiftKey: true },
    { key: 'p', ctrlKey: true },
  ])('ignores %o', (k) => {
    expect(zoomKey(ev(k), false)).toBeNull()
  })
})

describe('handleZoomKey', () => {
  it('steps once and claims the key, so the menu accelerator does not step again', () => {
    const preventDefault = vi.fn()
    const apply = vi.fn()
    const handled = handleZoomKey(
      { ...ev({ key: '+', ctrlKey: true }), preventDefault },
      false,
      apply,
    )
    expect(handled).toBe(true)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('in')
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('leaves other keys and already handled keys alone', () => {
    const apply = vi.fn()
    const preventDefault = vi.fn()
    expect(
      handleZoomKey({ ...ev({ key: 'a', ctrlKey: true }), preventDefault }, false, apply),
    ).toBe(false)
    expect(
      handleZoomKey(
        { ...ev({ key: '+', ctrlKey: true }), defaultPrevented: true, preventDefault },
        false,
        apply,
      ),
    ).toBe(false)
    expect(apply).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
