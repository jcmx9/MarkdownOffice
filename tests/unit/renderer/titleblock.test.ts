// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import type { PreviewBlock } from '../../../src/core/preview-spec'
import { noteBlocks } from '../../../src/renderer/editor/preview-source'
import { renderBlocks } from '../../../src/renderer/editor/titleblock'

const state = (s: string) => EditorState.create({ doc: s })
const head = (blocks: PreviewBlock[], empty: 'marker' | 'none' = 'marker') =>
  renderBlocks(blocks, { part: 'head', signature: null, empty })

describe('noteBlocks (built-in memo head)', () => {
  it('built-in head = old title block', () => {
    const t =
      '---\ntoptitle: "Muster GmbH"\ntitle: "Kickoff"\nsubtitle: "Protokoll"\nauthor: [Anna, Ben]\ndate: 2026-10-14\n---'
    const blocks = noteBlocks(state(t), 'head')
    expect(blocks).toEqual([
      { cls: 'toptitle', kind: 'text', text: 'Muster GmbH', label: null },
      { cls: 'title', kind: 'text', text: 'Kickoff', label: null },
      { cls: 'subtitle', kind: 'text', text: 'Protokoll', label: null },
      { cls: 'meta', kind: 'text', text: '14. Oktober 2026 · Anna, Ben', label: null },
    ])
    expect([...head(blocks).children].map((c) => c.className)).toEqual([
      'mdo-tb-toptitle',
      'mdo-tb-title',
      'mdo-tb-subtitle',
      'mdo-tb-meta',
    ])
  })
  it('omits the meta line without author (like the PDF)', () => {
    const blocks = noteBlocks(state('---\ntitle: X\ndate: 2026-10-14\n---'), 'head')
    expect(blocks.map((b) => b.cls)).toEqual(['title'])
  })
  it('is empty without any of toptitle/title/subtitle/author', () => {
    expect(noteBlocks(state('---\ndate: 2026-10-14\ntoc: false\n---'), 'head')).toEqual([])
  })
  it('is empty without a closed front matter', () => {
    expect(noteBlocks(state('---\ntitle: X'), 'head')).toEqual([])
    expect(noteBlocks(state('# X'), 'head')).toEqual([])
  })
})

describe('renderBlocks', () => {
  it('inserts text, never HTML', () => {
    const el = head([
      { cls: 'toptitle', kind: 'text', text: '<b>A</b>', label: null },
      { cls: 'title', kind: 'text', text: 'T', label: null },
    ])
    expect(el.className).toBe('mdo-titleblock')
    expect(el.querySelector('.mdo-tb-toptitle')?.textContent).toBe('<b>A</b>')
    expect(el.querySelector('b')).toBeNull()
    expect(el.querySelector('.mdo-tb-subtitle')).toBeNull()
    expect(el.querySelector('.mdo-tb-title')?.textContent).toBe('T')
  })
  it('empty head: marker outside Present, nothing in Present', () => {
    const marker = head([])
    expect(marker.classList.contains('mdo-titleblock-empty')).toBe(true)
    expect(marker.textContent).toBe('⋯ YAML-Header')
    const none = head([], 'none')
    expect(none.className).toBe('mdo-titleblock mdo-titleblock-none')
    expect(none.textContent).toBe('')
  })
  it('empty foot renders an empty footblock', () => {
    const el = renderBlocks([], { part: 'foot', signature: null, empty: 'none' })
    expect(el.className).toBe('mdo-footblock mdo-footblock-none')
  })
  it('lines and labels', () => {
    const el = renderBlocks(
      [
        { cls: 'address', kind: 'lines', lines: ['A', '<i>B</i>'], label: null },
        { cls: 'attachments', kind: 'lines', lines: ['Angebot'], label: 'Anlagen:' },
      ],
      { part: 'foot', signature: null, empty: 'none' },
    )
    expect(el.className).toBe('mdo-footblock')
    const address = el.querySelector('.mdo-tb-address')
    expect(
      [...(address?.querySelectorAll('.mdo-tb-line') ?? [])].map((l) => l.textContent),
    ).toEqual(['A', '<i>B</i>'])
    expect(el.querySelector('i')).toBeNull()
    const first = el.querySelector('.mdo-tb-attachments')?.firstElementChild
    expect(first?.className).toBe('mdo-tb-label')
    expect(first?.textContent).toBe('Anlagen:')
  })
  it('image only from a data:image/svg+xml URL, width scaled', () => {
    const block: PreviewBlock = { cls: 'signature', kind: 'image', width: '40mm' }
    const foot = (signature: string) =>
      renderBlocks([block], { part: 'foot', signature, empty: 'none' })
    expect(foot('http://x/a.svg').querySelector('img')).toBeNull()
    expect(foot('data:image/png;base64,AAAA').querySelector('img')).toBeNull()
    const url = 'data:image/svg+xml;base64,PHN2Zy8+'
    const img = foot(url).querySelector('img')
    expect(img?.className).toBe('mdo-tb-signature')
    expect(img?.getAttribute('src')).toBe(url)
    expect(img?.getAttribute('alt')).toBe('')
    expect(img?.style.width).toBe('calc(40mm * var(--mdo-scale, 1))')
    const noWidth = renderBlocks([{ ...block, width: null }], {
      part: 'foot',
      signature: url,
      empty: 'none',
    }).querySelector('img')
    expect(noWidth?.style.width).toBe('')
  })
})
