import type { SyntaxNode } from '@lezer/common'
import { CORE_SCHEMA, load } from 'js-yaml'
import { markdownBodyParser, markdownParser } from './markdown-syntax'

/**
 * Which local files a note may pull into its PDF (the export's staging folder holds only these).
 * The note visibly includes its images, its header names logo and profile, and a profile names
 * its own image files; nothing else may reach Typst, because note text can run Typst code
 * (raw-typst comments, mitex passthroughs) that reads whatever the root holds.
 *
 * Why not ask Typst: the probe pass lists the image sources the set requests, but it runs
 * note-controlled code, which can forge that list. So the images are found here, by parsing the
 * Markdown with the editor's parser (core/markdown-syntax), mirroring how the PDF turns a
 * destination into the source string its `safe-image` gets (cmarker = pulldown-cmark, after the
 * pipeline's lib/markdown.typ preprocessing). The strings returned are those sources, so they
 * match the probe's spelling and the image map's keys; `~`, `$VAR` and `%XX` are expanded later,
 * like build.sh's expand_path does.
 */

/** pulldown-cmark escapes exactly the ASCII punctuation characters. */
const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'

/**
 * Named entities decoded in destinations and `src` attributes. Not HTML's full table (no
 * dependency for it): the ones that can plausibly appear in a file name. An unknown name stays
 * as written, so such an image is missing from the PDF instead of a different file being staged.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  agrave: 'à',
  ccedil: 'ç',
  ntilde: 'ñ',
  euro: '€',
  copy: '©',
  reg: '®',
  ndash: '–',
  mdash: '—',
  num: '#',
  percnt: '%',
  lpar: '(',
  rpar: ')',
  lowbar: '_',
  sol: '/',
  bsol: '\\',
}

function entity(body: string): string | null {
  if (body[0] !== '#') return ENTITIES[body] ?? null
  const hex = body[1] === 'x' || body[1] === 'X'
  const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
  // CommonMark: 0 and invalid code points become U+FFFD.
  return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
    ? '�'
    : String.fromCodePoint(code)
}

const ENTITY = '&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});'

/** A link destination as pulldown-cmark reads it: backslash escapes and entities in one pass. */
function unescapeDestination(raw: string): string {
  const s = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
  return s.replace(new RegExp(`\\\\([\\s\\S])|${ENTITY}`, 'g'), (m, esc, ent) => {
    if (esc !== undefined) return ESCAPABLE.includes(esc) ? esc : m
    return entity(ent) ?? m
  })
}

/** An HTML attribute value: entities only, backslashes stay (`a\_b` is the file `a\_b`). */
function decodeAttribute(raw: string): string {
  return raw.replace(new RegExp(ENTITY, 'g'), (m, ent) => entity(ent) ?? m)
}

/** The memo/din5008a sets' `is-remote`: such sources are skipped, never read from disk. */
function isRemote(s: string): boolean {
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('//') ||
    s.startsWith('data:')
  )
}

/** CommonMark label matching: case-insensitive, inner whitespace collapsed. */
function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

// An `<img>` tag with its attributes (quoted values may hold `>`). cmarker matches the tag name
// case-insensitively but attribute names exactly (`SRC=` is no source; it breaks the build).
const IMG_TAG_RE =
  /<img(?=[\s/>])((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/gi
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** The first `src` of each `<img>` in an HTML fragment; comments in it show nothing. */
function htmlImageSources(html: string): string[] {
  const out: string[] = []
  const text = html.replace(/<!--[\s\S]*?(-->|$)/g, '')
  for (const tag of text.matchAll(IMG_TAG_RE)) {
    for (const a of (tag[1] ?? '').matchAll(ATTR_RE)) {
      if (a[1] !== 'src') continue
      out.push(decodeAttribute(a[2] ?? a[3] ?? a[4] ?? ''))
      break
    }
  }
  return out
}

// lib/markdown.typ's image-attrs: `![alt](src){width=…}` becomes `<img src="src">` with the
// destination taken raw (no backslash unescaping, `"` as %22) before cmarker sees it, so the PDF
// asks for that spelling. Same regex, anchored where the Image node starts.
const IMAGE_ATTR_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\{([^}]*)\}/y

/**
 * A header the PDF also strips: `---` first, then a `---`/`...` line (lib/markdown.typ's
 * strip-frontmatter). The editor shows an unclosed header as one block while it is being typed;
 * the PDF renders such a note as text, so it is parsed without the front matter extension.
 */
function hasClosedFrontmatter(lines: string[]): boolean {
  if (lines[0]?.trimEnd() !== '---') return false
  return lines.slice(1).some((l) => l.trimEnd() === '---' || l.trimEnd() === '...')
}

/**
 * The local image sources a note visibly shows, in document order, deduplicated: Markdown images
 * (inline and reference-style) and `<img src>` in HTML. Nothing from code, comments, formulas or
 * the front matter, since the PDF shows none of those as images; remote sources are left out
 * like the sets leave them out.
 */
export function visibleImages(markdown: string): string[] {
  const text = markdown.replace(/\r\n?/g, '\n')
  const tree = (hasClosedFrontmatter(text.split('\n')) ? markdownParser : markdownBodyParser).parse(
    text,
  )
  const slice = (n: SyntaxNode | null) => (n ? text.slice(n.from, n.to) : '')

  // Reference definitions first: an image may use a label defined further down.
  const refs = new Map<string, string>()
  tree.iterate({
    enter: (n) => {
      if (n.name !== 'LinkReference') return
      const label = normalizeLabel(slice(n.node.getChild('LinkLabel')).slice(1, -1))
      const url = n.node.getChild('URL')
      if (url && !refs.has(label)) refs.set(label, unescapeDestination(slice(url)))
    },
  })

  const found: string[] = []
  tree.iterate({
    enter: (n) => {
      if (n.name === 'HTMLTag' || n.name === 'HTMLBlock') {
        found.push(...htmlImageSources(slice(n.node)))
        return false
      }
      if (n.name !== 'Image') return undefined
      const node = n.node
      const url = node.getChild('URL')
      if (url) {
        found.push(unescapeDestination(slice(url)))
      } else {
        // `![x][label]`, or `![label][]` / `![label]` with the image text as the label.
        const label = node.getChild('LinkLabel')
        const marks = node.getChildren('LinkMark')
        const close = marks[marks.length - 1]
        const name =
          label && label.to - label.from > 2
            ? slice(label).slice(1, -1)
            : text.slice(node.from + 2, close ? close.from : node.to)
        const dest = refs.get(normalizeLabel(name))
        if (dest !== undefined) found.push(dest)
      }
      IMAGE_ATTR_RE.lastIndex = node.from
      const attr = IMAGE_ATTR_RE.exec(text)
      if (attr?.[2]) found.push(decodeAttribute(attr[2].replace(/"/g, '%22')))
      // An image in another image's alt text is shown as text, not as an image.
      return false
    },
  })
  return [...new Set(found)].filter((s) => s !== '' && !isRemote(s))
}

export type ImageKind = 'svg' | 'png' | 'jpeg' | 'gif' | 'webp'

const EXTENSIONS: Record<string, ImageKind> = {
  svg: 'svg',
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
}

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

/**
 * An SVG document: optional BOM, XML declaration, comments and a DOCTYPE without internal subset
 * (Illustrator and Inkscape write one; an internal subset could declare entities), then `<svg`.
 */
const SVG_START_RE =
  /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE\s+svg[^[>]*>)\s*)*<svg[\s/>]/

/**
 * The image type of a file, or null: extension and content must agree, so a renamed key file
 * (`id_rsa` → `id_rsa.png`) is no image and is never staged for the PDF.
 */
export function imageKind(bytes: Uint8Array, name: string): ImageKind | null {
  const ext = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  const kind = EXTENSIONS[ext]
  if (!kind) return null
  switch (kind) {
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? kind : null
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]) ? kind : null
    case 'gif':
      return startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a')) ? kind : null
    case 'webp':
      return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8) ? kind : null
    case 'svg': {
      // The start decides; an SVG's head fits in a few KB unless its comments are huge.
      const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 65536))
      return SVG_START_RE.test(head) ? kind : null
    }
  }
}

const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi
const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi
const internal = (v: string) => {
  const s = v.trim()
  return s.startsWith('#') || /^data:/i.test(s)
}

/**
 * True if an SVG references anything outside itself: an `href`/`xlink:href` or CSS `url(…)` that
 * is neither `#…` nor `data:`, an `@import`, or an entity declaration. Typst would try to load
 * such a file from the root, so the SVG is not staged (shown as missing). Deliberately coarse:
 * any match counts, also in comments, rather than parsing XML and CSS exactly.
 */
export function svgHasExternalRefs(svg: string): boolean {
  if (/@import/i.test(svg) || /<!ENTITY/i.test(svg)) return true
  for (const re of [HREF_RE, URL_RE]) {
    for (const m of svg.matchAll(re)) {
      if (!internal(m[1] ?? m[2] ?? m[3] ?? '')) return true
    }
  }
  return false
}

const IMAGE_NAME_RE = /^[^/\\]+\.(svg|png|jpe?g|gif|webp)$/i

/**
 * The image files a profile names, by value alone (`signature: kanzlei-unterschrift.svg`): every
 * string anywhere in the YAML that is a bare file name with an image extension. No set-specific
 * keys, and no paths: only files next to the profile qualify, never the rest of its folder.
 * Read with Typst's YAML rules (core schema); invalid YAML names nothing, the set fails on it.
 */
export function profileImageNames(yamlText: string): string[] {
  let data: unknown
  try {
    data = load(yamlText, { schema: CORE_SCHEMA })
  } catch {
    return []
  }
  if (data === null || typeof data !== 'object') return []
  const out: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (IMAGE_NAME_RE.test(v)) out.push(v)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(data)
  return [...new Set(out)]
}
