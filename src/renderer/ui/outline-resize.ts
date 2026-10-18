/**
 * Width of the outline, set by dragging the grip on its left edge (Edit mode only; Present
 * always uses the default width). Widths are in em of the outline's own font size, so a
 * chosen width keeps its proportion when the zoom changes.
 */
export const OUTLINE_MIN_EM = 10
export const OUTLINE_MAX_EM = 40

export interface OutlineResizeHandlers {
  /** A new width in em, or null for the default width; called once per drag, key or reset. */
  commit(em: number | null): void
}

const clampEm = (em: number): number =>
  Math.round(Math.min(OUTLINE_MAX_EM, Math.max(OUTLINE_MIN_EM, em)) * 10) / 10

/** null = the CSS default width (18em, at most 33vw); a number = that width (at most 50vw). */
export function applyOutlineWidth(outline: HTMLElement, em: number | null): void {
  outline.style.width = em === null ? '' : `${em}em`
  outline.classList.toggle('mdo-ol-custom', em !== null)
}

export function attachOutlineResize(
  grip: HTMLElement,
  outline: HTMLElement,
  handlers: OutlineResizeHandlers,
): void {
  const emPx = () => Number.parseFloat(getComputedStyle(outline).fontSize) || 15
  const currentEm = () => outline.getBoundingClientRect().width / emPx()

  grip.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return
    down.preventDefault()
    grip.setPointerCapture(down.pointerId)
    const startX = down.clientX
    const startPx = outline.getBoundingClientRect().width
    const em = emPx()
    let last: number | null = null
    // The grip sits on the outline's left edge: moving left makes the outline wider.
    const move = (ev: PointerEvent) => {
      last = clampEm((startPx + startX - ev.clientX) / em)
      applyOutlineWidth(outline, last)
    }
    const end = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', end)
      grip.removeEventListener('pointercancel', end)
      grip.releasePointerCapture(down.pointerId)
      document.body.classList.remove('mdo-ol-resizing')
      if (last !== null) handlers.commit(last)
    }
    document.body.classList.add('mdo-ol-resizing')
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', end)
    grip.addEventListener('pointercancel', end)
  })

  grip.addEventListener('dblclick', () => {
    applyOutlineWidth(outline, null)
    handlers.commit(null)
  })

  // Keyboard access for the separator: ← wider, → narrower, by 1em.
  grip.addEventListener('keydown', (ev) => {
    const step = ev.key === 'ArrowLeft' ? 1 : ev.key === 'ArrowRight' ? -1 : 0
    if (!step) return
    ev.preventDefault()
    const em = clampEm(Math.round(currentEm()) + step)
    applyOutlineWidth(outline, em)
    handlers.commit(em)
  })
}
