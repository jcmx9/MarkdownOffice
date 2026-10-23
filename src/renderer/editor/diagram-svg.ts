/**
 * The security boundary for diagram SVG. mmdr draws from the note's text, and note content is
 * untrusted (a `click A "javascript:…"` line becomes an `<a href>`), so the SVG is never inserted
 * as markup: it is parsed as XML and rebuilt node by node from an allowlist derived from what
 * mmdr emits (tests/fixtures/mermaid). Everything else is dropped: links, scripts,
 * foreignObject, images, `<use>`, `<style>`, `style`/`class`/`on*` attributes, any `href`,
 * `url(…)` values other than references to ids of the same diagram, and any value with a
 * backslash (Chromium parses presentation attributes as CSS, where `\75 rl(` or `u\rl(` spell
 * `url(` past a plain-text check; mmdr never writes one).
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Elements that are rebuilt; anything else is dropped with its subtree (except `<a>`). */
const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
])

/** Elements whose text content is kept (as text nodes, never parsed again). */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'title'])

/** What makes a picture; an SVG without any of these is "nothing drawable". */
const DRAWABLE = 'path, rect, circle, ellipse, line, polyline, polygon, text'

/**
 * Plain (no-namespace) presentation and geometry attributes. Deliberately absent: `style`,
 * `class` and `data-*` (mmdr's own bookkeeping, which nothing styles; a note-chosen class could
 * otherwise pick up app CSS), every `href`, every `on*`.
 */
const ATTRIBUTES = new Set([
  'id',
  'x',
  'y',
  'dx',
  'dy',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'fx',
  'fy',
  'd',
  'points',
  'transform',
  'viewBox',
  'preserveAspectRatio',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'letter-spacing',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'orient',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
])

/** `url(#id)` in any quoting; the only `url(…)` form that survives. */
const LOCAL_REF = /^url\(\s*(['"]?)#([^'"()\s]+)\1\s*\)$/

/**
 * A plain size; `px` is the same user unit, so it is dropped (the widget reads the number).
 * Any other width or height (`100%`, `em`, missing) is replaced from the viewBox.
 */
const NUMBER = /^(\d*\.?\d+)(?:px)?$/

/**
 * The PDF draws the theme's font (memo: SourceSans3VF); the preview uses the same bundled
 * families through the app's font variables, which a presentation attribute cannot reference
 * (no var() there), hence a style property built only from these constants.
 */
function fontVar(family: string): string {
  const name = family.toLowerCase().replace(/[\s_-]+/g, '')
  if (name.includes('sourceserif')) return 'var(--mdo-font-serif)'
  if (name.includes('sourcecode')) return 'var(--mdo-font-code)'
  return 'var(--mdo-font-sans)'
}

/**
 * Rebuilds `svg` (mmdr output) as a detached `<svg>` element owned by `doc`, or null when it is
 * not well-formed SVG or nothing drawable survives. Ids become `<idPrefix>-<id>` and their
 * `url(#…)` references follow, so markers of two diagrams in one preview never collide.
 */
export function sanitizeDiagramSvg(
  svg: string,
  idPrefix: string,
  doc: Document,
): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const source = parsed.documentElement
  if (parsed.getElementsByTagName('parsererror').length > 0) return null
  if (source?.namespaceURI !== SVG_NS || source.localName !== 'svg') return null

  const ids = new Set<string>()
  // url(#…) values wait until every id is known, since a reference may precede its target.
  const refs: { el: Element; name: string; id: string }[] = []

  function copy(from: Element, into: Node, keepText = TEXT_ELEMENTS.has(from.localName)): void {
    for (const child of Array.from(from.childNodes)) {
      if (child.nodeType === 3 && keepText) {
        into.appendChild(doc.createTextNode(child.textContent ?? ''))
        continue
      }
      if (child.nodeType !== 1) continue
      const el = child as Element
      if (el.namespaceURI !== SVG_NS) continue
      // mmdr wraps a clickable node's whole drawing in the link: drop the link, keep the node.
      if (el.localName === 'a') {
        copy(el, into, keepText)
        continue
      }
      if (!ELEMENTS.has(el.localName) || el.localName === 'svg') continue
      into.appendChild(rebuild(el))
    }
  }

  function rebuild(from: Element): Element {
    const el = doc.createElementNS(SVG_NS, from.localName)
    for (const attr of Array.from(from.attributes)) {
      if (attr.namespaceURI !== null) continue
      if (attr.name === 'font-family') {
        el.setAttribute('style', `font-family: ${fontVar(attr.value)}`)
        continue
      }
      if (!ATTRIBUTES.has(attr.name)) continue
      // A CSS escape could spell url( unseen (see above).
      if (attr.value.includes('\\')) continue
      if (attr.name === 'id') {
        ids.add(attr.value)
        el.setAttribute('id', `${idPrefix}-${attr.value}`)
        continue
      }
      if (/url\(/i.test(attr.value)) {
        const ref = LOCAL_REF.exec(attr.value.trim())
        if (ref?.[2]) refs.push({ el, name: attr.name, id: ref[2] })
        continue
      }
      el.setAttribute(attr.name, attr.value)
    }
    copy(from, el)
    return el
  }

  const root = rebuild(source) as SVGSVGElement
  for (const { el, name, id } of refs) {
    // A reference to an id this diagram does not define could reach into the app's DOM.
    if (ids.has(id)) el.setAttribute(name, `url(#${idPrefix}-${id})`)
  }
  if (!root.querySelector(DRAWABLE)) return null

  // The natural size the widget scales from; mmdr's pie writes width="100%" plus a max-width
  // style and no height, where the viewBox carries the same numbers.
  const box = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const [, , boxW, boxH] = box
  const fromBox = box.length === 4 && box.every(Number.isFinite)
  for (const [name, fallback] of [
    ['width', boxW],
    ['height', boxH],
  ] as const) {
    const size = NUMBER.exec(root.getAttribute(name) ?? '')?.[1]
    if (size !== undefined) root.setAttribute(name, size)
    else if (fromBox) root.setAttribute(name, String(fallback))
  }
  return root
}
