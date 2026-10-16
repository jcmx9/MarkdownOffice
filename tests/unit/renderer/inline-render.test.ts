// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderInline } from '../../../src/renderer/editor/inline-render'

function render(text: string): HTMLElement {
  const el = document.createElement('div')
  renderInline(text, el)
  return el
}

describe('renderInline', () => {
  it('turns inline Markdown into elements and drops the marks', () => {
    const el = render('**fett** und *kursiv*, `code`, ~~weg~~ [Link](https://x.de)')
    expect(el.textContent).toBe('fett und kursiv, code, weg Link')
    expect(el.querySelector('strong.mdo-strong')?.textContent).toBe('fett')
    expect(el.querySelector('em.mdo-em')?.textContent).toBe('kursiv')
    expect(el.querySelector('code.mdo-code-inline')?.textContent).toBe('code')
    expect(el.querySelector('s.mdo-strike')?.textContent).toBe('weg')
    expect(el.querySelector('span.mdo-link')?.textContent).toBe('Link')
  })
  it('keeps bare URLs and escapes as text', () => {
    const el = render('siehe https://x.de \\*kein\\*')
    expect(el.textContent).toBe('siehe https://x.de *kein*')
    expect(el.querySelector('span.mdo-link')?.textContent).toBe('https://x.de')
  })
  it('never interprets HTML', () => {
    const el = render('<img src=x onerror=alert(1)> & <b>x</b>')
    expect(el.querySelector('img, b')).toBeNull()
    expect(el.textContent).toBe('<img src=x onerror=alert(1)> & <b>x</b>')
  })
  it('renders images as their alt text, not as links', () => {
    const el = render('![alt](pic.png)')
    expect(el.textContent).toBe('alt')
    expect(el.querySelector('.mdo-link')).toBeNull()
  })
  it('nests', () => {
    expect(render('**fett *und kursiv***').querySelector('strong em')?.textContent).toBe(
      'und kursiv',
    )
  })
})
