import type { SyntaxNode, Tree } from '@lezer/common'
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

interface Tag {
  name: string
  attrs: [string, string][]
  end: number
}

const isSpace = (c: string | undefined) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'

/**
 * The start tag at `i` (`<name attr="v" …>`), or null if none starts there or the text ends
 * inside it. Read like HTML's tokenizer reads it, in one forward pass: quoted values are skipped
 * as a whole (`<img` inside another tag's `title="…"` is part of that value, as in cmarker), and
 * stray characters are taken as attribute-name characters instead of ending the tag, so no start
 * position is ever scanned twice. Note text is untrusted, hence no backtracking regex.
 */
function readTag(s: string, i: number): Tag | null {
  if (s[i] !== '<' || !/[A-Za-z]/.test(s[i + 1] ?? '')) return null
  let j = i + 1
  while (j < s.length && !isSpace(s[j]) && s[j] !== '/' && s[j] !== '>') j++
  const name = s.slice(i + 1, j).toLowerCase()
  const attrs: [string, string][] = []
  for (;;) {
    while (isSpace(s[j]) || s[j] === '/') j++
    if (j >= s.length) return null
    if (s[j] === '>') return { name, attrs, end: j + 1 }
    const from = j++
    while (j < s.length && !isSpace(s[j]) && !'/>='.includes(s[j] as string)) j++
    const attr = s.slice(from, j)
    let k = j
    while (isSpace(s[k])) k++
    if (s[k] !== '=') {
      attrs.push([attr, ''])
      continue
    }
    k++
    while (isSpace(s[k])) k++
    const q = s[k]
    if (q === '"' || q === "'") {
      const close = s.indexOf(q, k + 1)
      if (close < 0) return null
      attrs.push([attr, s.slice(k + 1, close)])
      j = close + 1
    } else {
      const vFrom = k
      while (k < s.length && !isSpace(s[k]) && s[k] !== '>') k++
      attrs.push([attr, s.slice(vFrom, k)])
      j = k
    }
  }
}

/**
 * The source of an `<img>` tag: its first `src` (cmarker matches the tag name case-insensitively
 * but attribute names exactly; `SRC=` is no source and breaks the build), or null.
 */
function imgSource(tag: Tag | null): string | null {
  if (tag?.name !== 'img') return null
  const src = tag.attrs.find(([a]) => a === 'src')
  return src ? decodeAttribute(src[1]) : null
}

/**
 * The `<img>` sources of an HTML block, read tag by tag. A comment runs from `<!--` to the next
 * `-->` after it (`<!-->` does not close itself in cmarker) and shows nothing.
 */
function htmlBlockImageSources(html: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4)
      if (close < 0) break
      i = close + 3
      continue
    }
    if (html[i] !== '<') {
      i++
      continue
    }
    const tag = readTag(html, i)
    if (!tag) {
      // The text ends inside this tag (HTML drops it), or `<` starts no tag.
      if (/[A-Za-z]/.test(html[i + 1] ?? '')) break
      i++
      continue
    }
    const src = imgSource(tag)
    if (src !== null) out.push(src)
    i = tag.end
  }
  return out
}

/** Blocks whose inline content cmarker hands to its HTML parser as one stream. */
const INLINE_BLOCKS = /^(Paragraph|TableCell|ATXHeading\d|SetextHeading\d)$/

/**
 * Where an inline comment opens in `block` that never closes for cmarker, or Infinity:
 * `<!-->` / `<!--->` (text for lezer) open a comment there that swallows every later tag of the
 * paragraph, whatever follows (checked against the PDF). Code spans and real comments don't count.
 */
function swallowFrom(tree: Tree, text: string, block: SyntaxNode): number {
  const body = text.slice(block.from, block.to)
  for (let i = body.indexOf('<!--'); i >= 0; i = body.indexOf('<!--', i + 1)) {
    if (!/^<!---?>/.test(body.slice(i, i + 6))) continue
    const at = tree.resolveInner(block.from + i, 1)
    // Lezer may read `<!---> … -->` as one comment; cmarker's still never closes.
    const inComment = at.name === 'Comment' && at.from !== block.from + i
    if (at.name !== 'InlineCode' && at.name !== 'CodeText' && !inComment) {
      return block.from + i
    }
  }
  return Number.POSITIVE_INFINITY
}

// lib/markdown.typ's image-attrs: `![alt](src){width=…}` becomes `<img src="src">` with the
// destination taken raw (no backslash unescaping, `"` as %22) before cmarker sees it, so the PDF
// asks for that spelling. Its regex is split to stay linear on any note: the part up to `)` is
// matched against the Image node alone (Image nodes don't overlap), the `{…}` part by finding the
// next `}` on the line with forward-only pointers.
const IMAGE_ATTR_HEAD_RE = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)$/

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

  // image-attrs, like Typst's per-line replace: matches never overlap, so an image inside an
  // earlier match's `{…}` is attribute text. `brace`/`newline` only move forward.
  let consumed = -1
  let brace = -1
  let newline = -1
  const next = (ch: string, pos: number, cur: number): number => {
    if (cur >= pos) return cur
    const at = text.indexOf(ch, pos)
    return at < 0 ? Number.POSITIVE_INFINITY : at
  }
  const imageAttrSource = (node: SyntaxNode): string | null => {
    if (node.from < consumed || text[node.to] !== '{') return null
    const head = IMAGE_ATTR_HEAD_RE.exec(slice(node))
    if (!head) return null
    brace = next('}', node.to, brace)
    newline = next('\n', node.to, newline)
    if (brace === Number.POSITIVE_INFINITY || newline < brace) return null
    consumed = brace + 1
    return head[2] ?? null
  }

  // Once per paragraph (or cell, heading), so a paragraph full of tags stays linear.
  const swallowCache = new Map<number, number>()
  const swallowed = (node: SyntaxNode): number => {
    let block: SyntaxNode | null = node.parent
    while (block && !INLINE_BLOCKS.test(block.name)) block = block.parent
    if (!block) return Number.POSITIVE_INFINITY
    let at = swallowCache.get(block.from)
    if (at === undefined) {
      at = swallowFrom(tree, text, block)
      swallowCache.set(block.from, at)
    }
    return at
  }

  const found: string[] = []
  tree.iterate({
    enter: (n) => {
      if (n.name === 'HTMLBlock') {
        found.push(...htmlBlockImageSources(slice(n.node)))
        return false
      }
      if (n.name === 'HTMLTag') {
        // Lezer already split the inline HTML into tags; only the tag itself counts.
        const src = imgSource(readTag(slice(n.node), 0))
        if (src !== null && n.from < swallowed(n.node)) found.push(src)
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
      const raw = imageAttrSource(node)
      if (raw !== null) found.push(decodeAttribute(raw.replace(/"/g, '%22')))
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
 * True if `head` is the start of an SVG document: optional BOM, XML declaration, comments and a
 * DOCTYPE without internal subset (Illustrator and Inkscape write one; an internal subset could
 * declare entities), then `<svg`. A hand loop, linear in the input (file content is untrusted).
 */
function isSvgStart(head: string): boolean {
  let i = head.charCodeAt(0) === 0xfeff ? 1 : 0
  const skipSpace = () => {
    while (isSpace(head[i])) i++
  }
  skipSpace()
  if (head.startsWith('<?xml', i)) {
    const close = head.indexOf('?>', i)
    if (close < 0 || head.slice(i, close).includes('>')) return false
    i = close + 2
  }
  for (;;) {
    skipSpace()
    if (head.startsWith('<!--', i)) {
      const close = head.indexOf('-->', i + 4)
      if (close < 0) return false
      i = close + 3
    } else if (/^<!DOCTYPE\s+svg/i.test(head.slice(i, i + 14))) {
      const close = head.indexOf('>', i)
      if (close < 0 || head.slice(i, close).includes('[')) return false
      i = close + 1
    } else {
      return head.startsWith('<svg', i) && /[\s/>]/.test(head[i + 4] ?? '')
    }
  }
}

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
      return isSvgStart(head) ? kind : null
    }
  }
}

/** `#…` or a `data:` URI that is not itself an SVG (a nested SVG could hide references). */
const internal = (v: string) => {
  const s = v.trim()
  return s.startsWith('#') || (/^data:/i.test(s) && !/^data:\s*image\/svg\+xml/i.test(s))
}

/** Each `href=` value; `null` for one whose quote never closes (counted as external). */
function* hrefValues(svg: string): Generator<string | null> {
  // `\s*=\s*` cannot overlap, so this regex stays linear; the values are read by hand.
  for (const m of svg.matchAll(/\bhref\s*=\s*/gi)) {
    const at = (m.index ?? 0) + m[0].length
    const q = svg[at]
    if (q === '"' || q === "'") {
      const close = svg.indexOf(q, at + 1)
      yield close < 0 ? null : svg.slice(at + 1, close)
    } else {
      let end = at
      while (end < svg.length && !' \t\n\r\f"\'>'.includes(svg[end] as string)) end++
      yield svg.slice(at, end)
    }
  }
}

/** Each CSS `url(…)` value without quotes; `null` for one that never closes. */
function* urlValues(svg: string): Generator<string | null> {
  const lower = svg.toLowerCase()
  let close = -1
  for (let i = lower.indexOf('url('); i >= 0; i = lower.indexOf('url(', i + 4)) {
    // `url(url(url(…)` shares one `)`: search again only past the last one found.
    if (close < i + 4) close = svg.indexOf(')', i + 4)
    if (close < 0) {
      yield null
      return
    }
    const v = svg.slice(i + 4, close).trim()
    const q = v[0]
    yield (q === '"' || q === "'") && v.endsWith(q) && v.length > 1 ? v.slice(1, -1) : v
  }
}

/**
 * True if an SVG may reference anything outside itself: an `href`/`xlink:href` or CSS `url(…)`
 * that is neither `#…` nor a non-SVG `data:` URI, a CSS escape inside `url(…)`, any `@import`,
 * or an entity declaration. Typst would try to load such a file from the root, so the SVG is not
 * staged (shown as missing). Defence in depth, deliberately coarse (matches in comments count
 * too): the boundary itself is the staging root, which holds nothing the note does not name.
 * Hand-read values, linear in the input (file content is untrusted).
 */
export function svgHasExternalRefs(svg: string): boolean {
  if (/@import/i.test(svg) || /<!ENTITY/i.test(svg)) return true
  for (const v of hrefValues(svg)) if (v === null || !internal(v)) return true
  for (const v of urlValues(svg)) {
    if (v === null || v.includes('\\') || !internal(v)) return true
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
