import type { EditorView } from '@codemirror/view'
import { linkAt, OPENABLE } from '../editor/link-at'

/** Set on the editor host while Cmd/Ctrl is held over a link: the pointer becomes a hand. */
export const LINK_READY_CLASS = 'mdo-link-ready'

/** The system's "open link" modifier: Cmd on macOS, Ctrl elsewhere (as in browsers and IDEs). */
export function linkModifier(e: MouseEvent | KeyboardEvent, mac: boolean): boolean {
  return mac ? e.metaKey : e.ctrlKey
}

/**
 * The link under a pointer event: a rendered table cell carries its target as `data-mdo-href`
 * (inline-render.ts; the table widget hides its events from the editor), everything else is
 * looked up in the syntax tree at the pointer.
 */
export function linkUnder(view: EditorView, e: MouseEvent): string | null {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-mdo-href]') : null
  if (el) {
    const href = el.dataset.mdoHref ?? ''
    return OPENABLE.test(href) ? href : null
  }
  if (!(e.target instanceof Node) || !view.contentDOM.contains(e.target)) return null
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false)
  return linkAt(view.state, pos)
}

/**
 * Cmd/Ctrl + click opens the link under the pointer in the system's browser or mail program
 * (owner, 2026-10-26); a plain click still only places the cursor, so links stay editable. The
 * pointer turns into a hand while the modifier is held over a link. Listens on the editor's
 * host in the capture phase, so table widgets (which ignore editor events) are covered too.
 */
export function attachLinkOpen(
  host: HTMLElement,
  view: () => EditorView,
  open: (url: string) => void,
  mac: boolean,
): void {
  let last: MouseEvent | null = null
  const update = (mod: boolean) => {
    const ready = mod && last !== null && linkUnder(view(), last) !== null
    host.classList.toggle(LINK_READY_CLASS, ready)
  }
  host.addEventListener('mousemove', (e) => {
    last = e
    update(linkModifier(e, mac))
  })
  host.addEventListener('mouseleave', () => {
    last = null
    update(false)
  })
  const onKey = (e: KeyboardEvent) => update(linkModifier(e, mac))
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  window.addEventListener('blur', () => update(false))
  host.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0 || !linkModifier(e, mac)) return
      const url = linkUnder(view(), e)
      if (!url) return
      // Neither a cursor move nor a multi-cursor (Cmd/Ctrl+click adds one in CodeMirror).
      e.preventDefault()
      e.stopPropagation()
      open(url)
    },
    true,
  )
}
