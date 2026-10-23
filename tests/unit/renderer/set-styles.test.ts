// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SetCssRule } from '../../../src/core/set-css'
import {
  SET_ATTR,
  SetStyles,
  setCssGeneration,
  setScope,
} from '../../../src/renderer/ui/set-styles'

const rule = (value: string): SetCssRule => ({
  selectors: ['.mdo-preview'],
  declarations: [['--mdo-body-size', value]],
})

describe('SetStyles', () => {
  let host: HTMLElement
  let styles: SetStyles
  beforeEach(() => {
    document.head.innerHTML = ''
    host = document.createElement('div')
    styles = new SetStyles(document, host)
  })
  const all = () => document.head.querySelectorAll('style[data-mdo-set-css="fx-brief"]')

  it('load writes scoped rules once per set and replaces them on reload', () => {
    styles.load('fx-brief', [rule('11pt')])
    styles.load('fx-brief', [rule('12pt')])
    expect(all()).toHaveLength(1)
    expect(all()[0]?.textContent).toMatch(/^#editor\[data-mdo-set="fx-brief"\] \.mdo-preview/)
    expect(all()[0]?.textContent).toContain('12pt')
    expect(all()[0]?.textContent).not.toContain('11pt')
  })

  it('load with no rules removes the style', () => {
    styles.load('fx-brief', [rule('11pt')])
    styles.load('fx-brief', [])
    expect(all()).toHaveLength(0)
  })

  it('show sets and removes the host attribute', () => {
    styles.show('fx-brief')
    expect(host.getAttribute(SET_ATTR)).toBe('fx-brief')
    styles.show(null)
    expect(host.hasAttribute(SET_ATTR)).toBe(false)
  })

  it('the generation changes with changed rules only', () => {
    expect(setCssGeneration(document, 'fx-brief')).toBe('')
    styles.load('fx-brief', [rule('11pt')])
    const first = setCssGeneration(document, 'fx-brief')
    expect(first).not.toBe('')
    // A tab switch reloads the same rules: the preview keeps its set lines.
    styles.load('fx-brief', [rule('11pt')])
    expect(setCssGeneration(document, 'fx-brief')).toBe(first)
    styles.load('fx-brief', [rule('12pt')])
    expect(setCssGeneration(document, 'fx-brief')).not.toBe(first)
    styles.load('fx-brief', [])
    expect(setCssGeneration(document, 'fx-brief')).toBe('')
  })

  it('setScope refuses names outside SET_NAME_RE', () => {
    expect(() => setScope('a"]')).toThrow()
    expect(() => styles.load('A b', [rule('1pt')])).toThrow()
    expect(() => styles.show('a"]')).toThrow()
  })
})
