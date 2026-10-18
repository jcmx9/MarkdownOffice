// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { OutlineEntry } from '../../../src/renderer/editor/outline'
import { Outline } from '../../../src/renderer/ui/outline'

function entry(
  level: 1 | 2,
  text: string,
  from: number,
  opts: { fold?: boolean; folded?: boolean; children?: OutlineEntry[] } = {},
): OutlineEntry {
  const fold = opts.fold === false ? null : { from: from + text.length, to: from + 50 }
  return {
    level,
    text,
    from,
    to: from + text.length,
    fold,
    folded: opts.folded ?? false,
    children: opts.children ?? [],
  }
}

const tree = (folded = false) => [
  entry(1, 'Alpha', 0, {
    folded,
    children: [entry(2, 'Beta', 20), entry(2, 'Gamma', 40, { fold: false })],
  }),
  entry(1, 'Delta', 60, { fold: false }),
]

let el: HTMLElement
let handlers: {
  jump: Mock<(e: OutlineEntry) => void>
  toggle: Mock<(e: OutlineEntry) => void>
}
let outline: Outline
beforeEach(() => {
  for (const tip of document.querySelectorAll('.mdo-ol-tip')) tip.remove()
  el = document.createElement('nav')
  handlers = {
    jump: vi.fn<(e: OutlineEntry) => void>(),
    toggle: vi.fn<(e: OutlineEntry) => void>(),
  }
  outline = new Outline(el, handlers)
})
const labels = () => [...el.querySelectorAll('.mdo-ol-label')] as HTMLElement[]
const down = (b: Element, button = 0) => {
  const ev = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true })
  b.dispatchEvent(ev)
  return ev
}

describe('Outline rendering', () => {
  it('renders one ul with H1/H2 items, chevrons and spacers', () => {
    outline.render(tree(), null)
    expect(el.querySelectorAll(':scope > ul').length).toBe(1)
    expect(labels().map((l) => l.textContent)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta'])
    expect(el.querySelectorAll('li.mdo-ol-h1').length).toBe(2)
    expect(el.querySelectorAll('li.mdo-ol-h2').length).toBe(2)
    const chev = el.querySelector('.mdo-ol-chevron') as HTMLElement
    expect(chev.getAttribute('aria-expanded')).toBe('true')
    expect(chev.getAttribute('aria-label')).toBe('Abschnitt einklappen')
    // Only Alpha has children: Beta (folds, but no children), Gamma and Delta get a spacer.
    expect(el.querySelectorAll('.mdo-ol-chevron').length).toBe(1)
    expect(el.querySelectorAll('.mdo-ol-spacer').length).toBe(3)
  })
  it('hides the children of a folded H1', () => {
    outline.render(tree(true), null)
    expect(labels().map((l) => l.textContent)).toEqual(['Alpha', 'Delta'])
    const chev = el.querySelector('.mdo-ol-chevron') as HTMLElement
    expect(chev.getAttribute('aria-expanded')).toBe('false')
    expect(chev.getAttribute('aria-label')).toBe('Abschnitt ausklappen')
    outline.render(tree(false), null)
    expect(labels().length).toBe(4)
  })
  it('calls toggle from the chevron and jump from the label', () => {
    const t = tree()
    outline.render(t, null)
    ;(el.querySelector('.mdo-ol-chevron') as HTMLElement).click()
    expect(handlers.toggle).toHaveBeenCalledWith(t[0])
    labels()[1]?.click()
    expect(handlers.jump).toHaveBeenCalledWith(t[0]?.children[0])
  })
  it('cancels mousedown on the primary button only; buttons are not tabbable', () => {
    outline.render(tree(), null)
    for (const b of el.querySelectorAll('button')) {
      expect(b.tabIndex).toBe(-1)
      expect(b.type).toBe('button')
    }
    expect(down(labels()[0] as Element).defaultPrevented).toBe(true)
    expect(down(el.querySelector('.mdo-ol-chevron') as Element).defaultPrevented).toBe(true)
    expect(down(labels()[0] as Element, 2).defaultPrevented).toBe(false)
  })
  it('does not call handlers for non-primary clicks', () => {
    outline.render(tree(), null)
    labels()[0]?.dispatchEvent(new MouseEvent('click', { button: 2, bubbles: true }))
    expect(handlers.jump).not.toHaveBeenCalled()
  })
  it('renders the text as text, never HTML, and without a native title tooltip', () => {
    outline.render([entry(1, '<b>Very long</b> heading', 0, { fold: false })], null)
    expect(labels()[0]?.textContent).toBe('<b>Very long</b> heading')
    expect(labels()[0]?.title).toBe('')
    expect(el.querySelector('b')).toBeNull()
  })
  it('hover over a cut-off label shows the full text, right-aligned to the label', () => {
    outline.render([entry(1, '<b>Lang</b> und abgeschnitten', 0, { fold: false })], null)
    const label = labels()[0] as HTMLElement
    Object.defineProperty(label, 'scrollWidth', { value: 300, configurable: true })
    Object.defineProperty(label, 'clientWidth', { value: 100 })
    label.getBoundingClientRect = () =>
      ({ top: 40, right: 500, height: 22, left: 400, bottom: 62, width: 100 }) as DOMRect
    label.dispatchEvent(new MouseEvent('mouseenter'))
    const tip = document.querySelector('.mdo-ol-tip') as HTMLElement
    expect(tip.hidden).toBe(false)
    expect(tip.textContent).toBe('<b>Lang</b> und abgeschnitten')
    expect(tip.querySelector('b')).toBeNull()
    expect(tip.classList.contains('mdo-ol-tip-h1')).toBe(true)
    expect(tip.style.top).toBe('40px')
    expect(tip.style.right).toBe(`${window.innerWidth - 500}px`)
    label.dispatchEvent(new MouseEvent('mouseleave'))
    expect(tip.hidden).toBe(true)
  })
  it('no hover tip when the label fits; a re-render hides an open tip', () => {
    outline.render([entry(2, 'Kurz', 0, { fold: false })], null)
    const label = labels()[0] as HTMLElement
    Object.defineProperty(label, 'scrollWidth', { value: 50, configurable: true })
    Object.defineProperty(label, 'clientWidth', { value: 100 })
    label.dispatchEvent(new MouseEvent('mouseenter'))
    const tip = document.querySelector('.mdo-ol-tip') as HTMLElement | null
    expect(tip === null || tip.hidden).toBe(true)
    Object.defineProperty(label, 'scrollWidth', { value: 300, configurable: true })
    label.dispatchEvent(new MouseEvent('mouseenter'))
    expect((document.querySelector('.mdo-ol-tip') as HTMLElement).hidden).toBe(false)
    outline.render([entry(2, 'Kurz', 0, { fold: false })], null)
    expect((document.querySelector('.mdo-ol-tip') as HTMLElement).hidden).toBe(true)
  })
  it('shows a muted note without headings', () => {
    outline.render([], null)
    expect(el.querySelector('.mdo-ol-empty')?.textContent).toBe('Keine Überschriften')
    expect(el.querySelector('ul')).toBeNull()
    outline.render(tree(), null)
    expect(el.querySelector('.mdo-ol-empty')).toBeNull()
  })
  it('toggles hidden with setVisible', () => {
    outline.setVisible(false)
    expect(el.hidden).toBe(true)
    outline.setVisible(true)
    expect(el.hidden).toBe(false)
  })
})

describe('Outline in-place updates', () => {
  it('reuses nodes for the same keys, so a click spanning a refresh is not lost', () => {
    outline.render(tree(), null)
    const lis = [...el.querySelectorAll('li')]
    const first = labels()[1] as HTMLElement
    down(first)
    const t2 = tree()
    outline.render(t2, t2[0]?.children[0] ?? null)
    expect([...el.querySelectorAll('li')]).toEqual(lis)
    expect(labels()[1]).toBe(first)
    first.click()
    expect(handlers.jump).toHaveBeenCalledWith(t2[0]?.children[0])
  })
  it('keeps the node while the fold state flips, and rebuilds when keys change', () => {
    outline.render(tree(), null)
    const alpha = el.querySelector('li') as HTMLElement
    outline.render(tree(true), null)
    expect(el.querySelector('li')).toBe(alpha)
    outline.render([entry(1, 'Other', 0)], null)
    expect(labels().map((l) => l.textContent)).toEqual(['Other'])
    expect(el.querySelector('li')).not.toBe(alpha)
  })
  it('keeps rows when text is inserted above (positions shift), so clicks still land', () => {
    outline.render(tree(), null)
    const lis = [...el.querySelectorAll('li')]
    const beta = labels()[1] as HTMLElement
    down(beta)
    const shifted = [
      entry(1, 'Alpha', 10, {
        children: [entry(2, 'Beta', 30), entry(2, 'Gamma', 50, { fold: false })],
      }),
      entry(1, 'Delta', 70, { fold: false }),
    ]
    outline.render(shifted, null)
    expect([...el.querySelectorAll('li')]).toEqual(lis)
    beta.click()
    expect(handlers.jump).toHaveBeenCalledWith(shifted[0]?.children[0])
  })
  it('keys duplicate headings by occurrence', () => {
    outline.render(
      [entry(1, 'Same', 0, { fold: false }), entry(1, 'Same', 10, { fold: false })],
      null,
    )
    const lis = [...el.querySelectorAll('li')]
    expect(lis).toHaveLength(2)
    outline.render(
      [entry(1, 'Same', 5, { fold: false }), entry(1, 'Same', 15, { fold: false })],
      null,
    )
    expect([...el.querySelectorAll('li')]).toEqual(lis)
  })
  it('no chevron without children, even when the section folds', () => {
    outline.render([entry(1, 'Alpha', 0), entry(2, 'Vorab', 20)], null)
    expect(el.querySelector('.mdo-ol-chevron')).toBeNull()
    expect(el.querySelectorAll('.mdo-ol-spacer').length).toBe(2)
  })
  it('swaps chevron and spacer in place when a section gains or loses its children', () => {
    outline.render([entry(1, 'Alpha', 0)], null)
    const li = el.querySelector('li') as HTMLElement
    expect(li.querySelector('.mdo-ol-chevron')).toBeNull()
    expect(li.firstElementChild?.className).toBe('mdo-ol-spacer')
    outline.render([entry(1, 'Alpha', 0, { children: [entry(2, 'Beta', 20)] })], null)
    expect(el.querySelector('li')).toBe(li)
    expect(li.querySelector(':scope > .mdo-ol-spacer')).toBeNull()
    expect(li.firstElementChild?.className).toContain('mdo-ol-chevron')
    outline.render([entry(1, 'Alpha', 0)], null)
    expect(li.querySelector('.mdo-ol-chevron')).toBeNull()
    expect(li.firstElementChild?.className).toBe('mdo-ol-spacer')
  })
  it('removes rows of deleted headings', () => {
    outline.render(tree(), null)
    outline.render(
      [
        entry(1, 'Alpha', 0, { children: [entry(2, 'Gamma', 40, { fold: false })] }),
        entry(1, 'Delta', 60, { fold: false }),
      ],
      null,
    )
    expect(labels().map((l) => l.textContent)).toEqual(['Alpha', 'Gamma', 'Delta'])
    outline.render([entry(1, 'Delta', 0, { fold: false })], null)
    expect(labels().map((l) => l.textContent)).toEqual(['Delta'])
    expect(el.querySelectorAll('li').length).toBe(1)
  })
  it('moves .active and scrolls into view only when it changed', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const t = tree()
    outline.render(t, t[0] ?? null)
    expect(labels()[0]?.classList.contains('active')).toBe(true)
    expect(scroll).toHaveBeenCalledTimes(1)
    // The label, not the H1 item with its whole child list.
    expect(scroll.mock.contexts[0]).toBe(labels()[0])
    outline.render(t, t[0] ?? null)
    expect(scroll).toHaveBeenCalledTimes(1)
    outline.render(t, t[0]?.children[0] ?? null)
    expect(labels().map((l) => l.classList.contains('active'))).toEqual([false, true, false, false])
    expect(scroll).toHaveBeenCalledTimes(2)
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
    outline.render(t, null)
    expect(el.querySelector('.active')).toBeNull()
  })
})
