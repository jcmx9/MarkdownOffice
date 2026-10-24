/**
 * The security boundary for diagram and formula SVG. mmdr draws from the note's text, and note
 * content is untrusted (a `click A "javascript:…"` line becomes an `<a href>`); Typst sets
 * formulas from the note's text the same way. So the SVG is never inserted as markup: it is
 * parsed as XML and rebuilt node by node from an allowlist derived from what the tools emit
 * (tests/fixtures/mermaid, tests/fixtures/math). Everything else is dropped: links, scripts,
 * foreignObject, images, `<style>`, `style`/`class`/`on*` attributes, any `href` except a
 * formula's `<use>` of a glyph the same formula defines, `url(…)` values other than references
 * to ids of the same drawing, and any value with a backslash (Chromium parses presentation
 * attributes as CSS, where `\75 rl(` or `u\rl(` spell `url(` past a plain-text check; neither
 * tool writes one).
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

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

/**
 * Typst draws each glyph once as a `<symbol>` (with `overflow="visible"`) and places it with
 * `<use xlink:href="#…">`; nothing else is new in its formula SVG (Typst 0.15.0 + mitex, checked
 * on fractions, matrices, cases, \text, roots, sums, integrals, accents and colours).
 */
const MATH_ELEMENTS = new Set([...ELEMENTS, 'symbol', 'use'])
const MATH_ATTRIBUTES = new Set([...ATTRIBUTES, 'overflow'])

/** A `<use>` target: an id of this drawing, nothing else (no file, URL or `data:`). */
const LOCAL_HREF = /^#([^\s'"()]+)$/

/**
 * Typst writes text and rules in the default colour as `#000000` (fill of glyph `<use>`s,
 * stroke of fraction bars and root signs); the PDF sets them in the text colour of their
 * context, so the preview draws them in `currentColor` and the set CSS decides. A colour the
 * formula picks itself (`\color{red}` → `#ff0000`, white knock-outs) and `none` stay. An
 * explicit `\color{black}` is the same `#000000` and follows the context too.
 */
const mathColor = (value: string): string =>
  value.trim().toLowerCase() === '#000000' ? 'currentColor' : value

interface Profile {
  elements: Set<string>
  attributes: Set<string>
  /** Formulas: `<use>` with a local href. Diagrams: none (mmdr writes no `<use>`). */
  localUse: boolean
  /** Rewrites `fill`/`stroke` values. */
  color?: (value: string) => string
  /** Diagrams: null when nothing drawable survives. A formula may be empty (`\quad`). */
  requireDrawable: boolean
}

const DIAGRAM: Profile = {
  elements: ELEMENTS,
  attributes: ATTRIBUTES,
  localUse: false,
  requireDrawable: true,
}
const MATH: Profile = {
  elements: MATH_ELEMENTS,
  attributes: MATH_ATTRIBUTES,
  localUse: true,
  color: mathColor,
  requireDrawable: false,
}

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
  return rebuildSvg(svg, idPrefix, doc, DIAGRAM)
}

/**
 * Rebuilds `svg` (one formula as Typst writes it) like {@link sanitizeDiagramSvg}, keeping the
 * glyph `<symbol>`s and the `<use>`s that place them (href → `#<idPrefix>-<id>`; a `<use>` of
 * anything else is dropped) and drawing default black in `currentColor`. Null when it is not
 * well-formed SVG; an empty formula stays (it has a width).
 */
export function sanitizeMathSvg(
  svg: string,
  idPrefix: string,
  doc: Document,
): SVGSVGElement | null {
  return rebuildSvg(svg, idPrefix, doc, MATH)
}

/**
 * The rebuild both sanitisers share: parse as XML, copy allowed elements and attributes into
 * `doc`, prefix ids and resolve `url(#…)` references within the drawing. The profile decides
 * the rest: which elements and attributes are allowed, whether `<use>` survives (local hrefs
 * only), how `fill`/`stroke` values are rewritten, and whether a drawing with nothing drawable
 * is rejected.
 */
function rebuildSvg(
  svg: string,
  idPrefix: string,
  doc: Document,
  profile: Profile,
): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const source = parsed.documentElement
  if (parsed.getElementsByTagName('parsererror').length > 0) return null
  if (source?.namespaceURI !== SVG_NS || source.localName !== 'svg') return null

  const ids = new Set<string>()
  // url(#…) values wait until every id is known, since a reference may precede its target.
  const refs: { el: Element; name: string; id: string }[] = []
  // Every rebuilt <use> with its local target (null: none or not local); resolved like refs.
  const uses: { el: Element; id: string | null }[] = []

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
      if (!profile.elements.has(el.localName) || el.localName === 'svg') continue
      into.appendChild(rebuild(el))
    }
  }

  function rebuild(from: Element): Element {
    const el = doc.createElementNS(SVG_NS, from.localName)
    const use =
      profile.localUse && from.localName === 'use' ? { el, id: null as string | null } : null
    if (use) uses.push(use)
    for (const attr of Array.from(from.attributes)) {
      // Typst writes the SVG 1.1 xlink:href; plain href (SVG 2) means the same.
      const href =
        attr.localName === 'href' && (attr.namespaceURI === null || attr.namespaceURI === XLINK_NS)
      if (use && href) {
        // Only a local target counts; another href on the same <use> is dropped, never kept.
        const local = LOCAL_HREF.exec(attr.value.trim())?.[1]
        if (local) use.id = local
        continue
      }
      if (attr.namespaceURI !== null) continue
      if (attr.name === 'font-family') {
        el.setAttribute('style', `font-family: ${fontVar(attr.value)}`)
        continue
      }
      if (!profile.attributes.has(attr.name)) continue
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
      const paint = attr.name === 'fill' || attr.name === 'stroke'
      el.setAttribute(attr.name, paint && profile.color ? profile.color(attr.value) : attr.value)
    }
    copy(from, el)
    return el
  }

  const root = rebuild(source) as SVGSVGElement
  for (const { el, name, id } of refs) {
    // A reference to an id this diagram does not define could reach into the app's DOM.
    if (ids.has(id)) el.setAttribute(name, `url(#${idPrefix}-${id})`)
  }
  for (const { el, id } of uses) {
    // Plain href: Chromium follows it, and reprefix() has one form to rewrite.
    if (id !== null && ids.has(id)) el.setAttribute('href', `#${idPrefix}-${id}`)
    else el.remove()
  }
  if (profile.requireDrawable && !root.querySelector(DRAWABLE)) return null

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

/**
 * Moves a clone of a sanitised drawing to a fresh id prefix (two copies of one drawing in the
 * DOM must not share ids). The clone only holds the forms the sanitiser wrote:
 * `id="<prefix>-…"`, `url(#<prefix>-…)` (fill, stroke, marker-*) and `href="#<prefix>-…"`.
 */
export function reprefix(svg: SVGSVGElement, from: string, to: string): SVGSVGElement {
  const id = `${from}-`
  const ref = `url(#${from}-`
  const href = `#${from}-`
  for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'id' && attr.value.startsWith(id)) {
        el.setAttribute('id', `${to}-${attr.value.slice(id.length)}`)
      } else if (attr.name === 'href' && attr.value.startsWith(href)) {
        el.setAttribute('href', `#${to}-${attr.value.slice(href.length)}`)
      } else if (attr.value.startsWith(ref)) {
        el.setAttribute(attr.name, `url(#${to}-${attr.value.slice(ref.length)}`)
      }
    }
  }
  return svg
}
