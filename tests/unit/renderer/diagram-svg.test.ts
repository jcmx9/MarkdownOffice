// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sanitizeDiagramSvg } from '../../../src/renderer/editor/diagram-svg'

const FIXTURES = join(__dirname, '../../fixtures/mermaid')
const SVG_NS = 'http://www.w3.org/2000/svg'
const svg = (body: string, attrs = 'width="100" height="50" viewBox="0 0 100 50"') =>
  `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`
const clean = (s: string, prefix = 'd1') => sanitizeDiagramSvg(s, prefix, document)

/** Every element's tag name in document order (root included). */
const tags = (root: Element) =>
  [root, ...Array.from(root.querySelectorAll('*'))].map((e) => e.localName)

describe('sanitizeDiagramSvg', () => {
  const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.svg'))

  it('has the six reference diagrams to check against', () => {
    expect(fixtures.sort()).toEqual([
      'class.svg',
      'flowchart.svg',
      'gantt.svg',
      'pie.svg',
      'sequence.svg',
      'state.svg',
    ])
  })

  it.each(fixtures)('keeps every element of the reference %s', (file) => {
    const source = readFileSync(join(FIXTURES, file), 'utf8')
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
    const out = clean(source)
    expect(out).not.toBeNull()
    expect(out?.namespaceURI).toBe(SVG_NS)
    expect(tags(out as SVGSVGElement)).toEqual(tags(parsed))
    // Text survives as text, not markup.
    expect(out?.textContent).toBe(parsed.textContent)
    expect(out?.getAttribute('viewBox')).toBe(parsed.getAttribute('viewBox'))
  })

  it('keeps the natural size, deriving it from the viewBox when the width is relative', () => {
    const flow = clean(readFileSync(join(FIXTURES, 'flowchart.svg'), 'utf8'))
    expect(flow?.getAttribute('width')).toBe('415.36')
    expect(flow?.getAttribute('height')).toBe('439.132')
    // pie: width="100%" plus style="max-width: 462.680px" and no height.
    const pie = clean(readFileSync(join(FIXTURES, 'pie.svg'), 'utf8'))
    expect(pie?.getAttribute('width')).toBe('462.68')
    expect(pie?.getAttribute('height')).toBe('360')
    expect(pie?.hasAttribute('style')).toBe(false)
  })

  it('keeps drawing attributes as they are', () => {
    const out = clean(
      svg(
        '<path d="M 0 0 L 10 5" fill="none" stroke="#6b6b6b" stroke-width="2" stroke-dasharray="1,0" stroke-linecap="round" transform="translate(1 2)"/>',
      ),
    )
    const path = out?.querySelector('path')
    expect(path?.getAttribute('d')).toBe('M 0 0 L 10 5')
    expect(path?.getAttribute('stroke')).toBe('#6b6b6b')
    expect(path?.getAttribute('stroke-dasharray')).toBe('1,0')
    expect(path?.getAttribute('transform')).toBe('translate(1 2)')
  })

  it('drops links, scripts and event attributes', () => {
    // What mmdr emits for `click A "javascript:alert(1)" "tip"`, plus hand-made attacks.
    const out = clean(
      svg(
        '<a href="javascript:alert(1)" xlink:href="javascript:alert(1)"><title>tip</title>' +
          '<rect x="8" y="8" width="99" height="51" fill="url(#evil)" onclick="alert(1)"/>' +
          '<text x="5" y="5" font-family="SourceSans3VF">Start</text></a>' +
          '<script>alert(1)</script>' +
          '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>' +
          '<image href="https://example.com/x.png" width="5" height="5"/>' +
          '<use href="#r"/>' +
          '<style>rect { fill: url(https://example.com) }</style>' +
          '<circle cx="1" cy="1" r="1" style="fill: url(https://example.com/t)" onload="alert(1)" xlink:href="x"/>' +
          '<rect id="r" width="1" height="1" fill="url(https://example.com/#x)" stroke="url(#r)"/>',
        'width="100" height="50" viewBox="0 0 100 50" onload="alert(1)"',
      ),
    )
    expect(out).not.toBeNull()
    const root = out as SVGSVGElement
    // The link goes, its drawing stays (mmdr wraps the whole node in the <a>).
    expect(tags(root)).toEqual(['svg', 'title', 'rect', 'text', 'circle', 'rect'])
    expect(root.textContent).toBe('tipStart')
    for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name).not.toMatch(/^on|href/i)
        expect(attr.value).not.toMatch(/javascript:|url\((?!#)/i)
        // The only style is the font mapping the sanitiser writes itself.
        if (attr.name === 'style') expect(attr.value).toBe('font-family: var(--mdo-font-sans)')
      }
    }
    // References to ids this SVG does not define are dropped, own ones kept (prefixed).
    expect(root.querySelector('rect')?.hasAttribute('fill')).toBe(false)
    const last = root.querySelectorAll('rect')[1]
    expect(last?.hasAttribute('fill')).toBe(false)
    expect(last?.getAttribute('stroke')).toBe('url(#d1-r)')
  })

  it('never copies attributes in foreign namespaces', () => {
    const out = clean(svg('<rect width="1" height="1" xml:space="preserve" xlink:title="t"/>'))
    expect(out?.querySelector('rect')?.attributes).toHaveLength(2)
  })

  it('prefixes ids and their url(#…) references per diagram', () => {
    const body =
      '<defs><marker id="arrow-0" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 z"/></marker>' +
      '<linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient></defs>' +
      '<path id="edge-0" d="M 0 0 L 9 9" marker-end="url(#arrow-0)" marker-start="url( \'#arrow-0\' )"/>' +
      '<rect width="5" height="5" fill="url(#g)"/>'
    const a = clean(svg(body), 'mdo-diagram-1')
    const b = clean(svg(body), 'mdo-diagram-2')
    expect(a?.querySelector('marker')?.id).toBe('mdo-diagram-1-arrow-0')
    expect(a?.querySelector('linearGradient')?.id).toBe('mdo-diagram-1-g')
    expect(a?.querySelectorAll('stop')).toHaveLength(2)
    const path = a?.querySelector('path[d="M 0 0 L 9 9"]')
    expect(path?.id).toBe('mdo-diagram-1-edge-0')
    expect(path?.getAttribute('marker-end')).toBe('url(#mdo-diagram-1-arrow-0)')
    expect(path?.getAttribute('marker-start')).toBe('url(#mdo-diagram-1-arrow-0)')
    expect(a?.querySelector('rect')?.getAttribute('fill')).toBe('url(#mdo-diagram-1-g)')
    expect(b?.querySelector('marker')?.id).toBe('mdo-diagram-2-arrow-0')
  })

  it('prefixes the reference fixtures’ markers', () => {
    const out = clean(readFileSync(join(FIXTURES, 'class.svg'), 'utf8'), 'p')
    const ids = new Set(Array.from(out?.querySelectorAll('[id]') ?? []).map((e) => e.id))
    const refs = Array.from(out?.querySelectorAll('[marker-end], [marker-start]') ?? []).flatMap(
      (e) => [e.getAttribute('marker-end'), e.getAttribute('marker-start')].filter((v) => v),
    )
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      const id = /^url\(#(.+)\)$/.exec(ref as string)?.[1] ?? ''
      expect(id.startsWith('p-')).toBe(true)
      expect(ids.has(id)).toBe(true)
    }
  })

  it.each([
    ['empty', ''],
    ['text', 'not an svg'],
    ['broken XML', '<svg xmlns="http://www.w3.org/2000/svg"><rect'],
    ['not SVG', '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>'],
    ['SVG without namespace', '<svg><rect width="1" height="1"/></svg>'],
    ['nothing drawable', svg('<defs><marker id="m"/></defs><script>alert(1)</script>')],
    ['only removed content', svg('<foreignObject><p>x</p></foreignObject>')],
  ])('returns null for %s input', (_, input) => {
    expect(clean(input)).toBeNull()
  })

  it.each([
    ['SourceSans3VF', 'var(--mdo-font-sans)'],
    ['Source Sans 3', 'var(--mdo-font-sans)'],
    ['Source Serif 4', 'var(--mdo-font-serif)'],
    ['SourceSerif4VF', 'var(--mdo-font-serif)'],
    ['Source Code Pro', 'var(--mdo-font-code)'],
    ['Comic Sans MS, url(x)', 'var(--mdo-font-sans)'],
  ])('maps font-family %s to %s', (family, css) => {
    const out = clean(
      svg(`<text x="1" y="1" font-weight="500" font-family="${family}"><tspan>a</tspan></text>`),
    )
    const text = out?.querySelector('text') as SVGTextElement
    expect(text.hasAttribute('font-family')).toBe(false)
    expect(text.style.fontFamily).toBe(css)
    // The weight memo writes for the PDF stays, so the preview draws the same instance.
    expect(text.getAttribute('font-weight')).toBe('500')
  })
})
