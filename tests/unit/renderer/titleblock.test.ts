// @vitest-environment happy-dom
import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { renderTitleBlock, titleBlockData } from '../../../src/renderer/editor/titleblock'

const doc = (s: string) => Text.of(s.split('\n'))

describe('titleBlockData', () => {
  it('builds the PDF title block parts', () => {
    const t =
      '---\ntoptitle: "Muster GmbH"\ntitle: "Kickoff"\nsubtitle: "Protokoll"\nauthor: [Anna, Ben]\ndate: 2026-10-14\n---'
    expect(titleBlockData(doc(t))).toEqual({
      toptitle: 'Muster GmbH',
      title: 'Kickoff',
      subtitle: 'Protokoll',
      meta: '14. Oktober 2026 · Anna, Ben',
    })
  })
  it('omits the meta line without author (like the PDF)', () => {
    expect(titleBlockData(doc('---\ntitle: X\ndate: 2026-10-14\n---'))?.meta).toBe('')
  })
  it('is null without any of toptitle/title/subtitle/author', () => {
    expect(titleBlockData(doc('---\ndate: 2026-10-14\ntoc: false\n---'))).toBeNull()
  })
})

describe('renderTitleBlock', () => {
  it('renders only the parts that are set, as text', () => {
    const el = renderTitleBlock({ toptitle: '<b>A</b>', title: 'T', subtitle: '', meta: '' })
    expect(el.className).toBe('mdo-titleblock')
    expect(el.querySelector('.mdo-tb-toptitle')?.textContent).toBe('<b>A</b>')
    expect(el.querySelector('b')).toBeNull()
    expect(el.querySelector('.mdo-tb-subtitle')).toBeNull()
    expect(el.querySelector('.mdo-tb-title')?.textContent).toBe('T')
  })
  it('falls back to a faint marker line', () => {
    const el = renderTitleBlock(null)
    expect(el.classList.contains('mdo-titleblock-empty')).toBe(true)
    expect(el.textContent).toBe('⋯ YAML-Header')
  })
  it("renders nothing with empty style 'none'", () => {
    const el = renderTitleBlock(null, document, 'none')
    expect(el.className).toBe('mdo-titleblock mdo-titleblock-none')
    expect(el.textContent).toBe('')
  })
})
