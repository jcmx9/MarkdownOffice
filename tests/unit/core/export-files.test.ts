import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  imageKind,
  profileImageNames,
  svgHasExternalRefs,
  visibleImages,
} from '../../../src/core/export-files'
import { markdownParser } from '../../../src/core/markdown-syntax'

// Expected spellings were checked against the PDF side: the memo set's probe pass
// (`typst eval … query(<mdo-image>)` with probe=true) on the same notes lists these. One known
// difference: lib/markdown.typ's typography turns a title's straight quotes into German ones, so
// the PDF drops `![a](plain.png "Title")` today; listing it anyway only allows a visible link.

describe('visibleImages', () => {
  it('finds images in text, lists, tables, alerts, headings, links and HTML', () => {
    const md = [
      '# Head ![](head.png)',
      '',
      'Text ![a](plain.png "Title") and [![](badge.png)](https://example.com)',
      '',
      '- item ![](list.png)',
      '- [ ] task ![](task.png)',
      '',
      '1. ord',
      '   > nested ![](nested.png)',
      '',
      '| a | b |',
      '|---|---|',
      '| ![](cell.png) | x |',
      '',
      '> [!NOTE]',
      '> alert ![](alert.png)',
      '',
      '<img src="html1.png" alt="x"> inline <img alt=y src=\'html2.png\'/> <IMG src=html3.png>',
      '',
      '<div>',
      '<img src="block.png">',
      '</div>',
      '',
      '<pre><img src="pre.png"></pre>',
      '',
      'Term',
      ': def ![](deflist.png)',
      '',
      '~~![](strike.png)~~ *![](em.png)* <span>![](inspan.png)</span>',
    ].join('\n')
    expect(visibleImages(md)).toEqual([
      'head.png',
      'plain.png',
      'badge.png',
      'list.png',
      'task.png',
      'nested.png',
      'cell.png',
      'alert.png',
      'html1.png',
      'html2.png',
      'html3.png',
      'block.png',
      'pre.png',
      'deflist.png',
      'strike.png',
      'em.png',
      'inspan.png',
    ])
  })

  it.each([
    ['code span', '`![](x.png)`'],
    ['fenced code', '```\n![](x.png)\n<img src="x.png">\n```'],
    ['indented code', 'para\n\n    ![](x.png)'],
    ['HTML comment', '<!-- ![](x.png) <img src="x.png"> -->'],
    ['inline HTML comment', 'a <!-- ![](x.png) --> b'],
    ['comment inside an HTML block', '<div>\n<!-- <img src="x.png"> -->\n</div>'],
    ['front matter', '---\nlogo: x.png\nnote: ![](x.png)\n---\nText'],
    ['formula', '$![](x.png)$ and $$<img src="x.png">$$'],
    ['escaped image', '\\![](x.png)'],
    ['an image inside alt text (only the outer one shows)', '![o ![i](x.png)](out.png)'],
    [
      'remote sources (the sets skip them)',
      '![](http://h/x.png) ![](https://h/x.png) ![](//h/x.png) ![](data:image/png;base64,AA)',
    ],
    ['empty destinations', '![]() ![](<>) <img src="">'],
    ['attribute names are case-sensitive in cmarker', '<img SRC="x.png">'],
    ["<img> text in an inline tag's attribute", 'x <a title="<img src=\'attr.png\'>">y</a>'],
    ["<img> text in a span's attribute", 'x <span title="<img src=\'s.png\'>">z</span>'],
    [
      "<img> text in an HTML block tag's attribute",
      '<div title="<img src=\'d.png\'>">\ntext\n</div>',
    ],
    ['a tag after an inline `<!-->`', 'a <!--> <img src="cs2.png"> b'],
    [
      'a tag after an inline `<!--->`, even past a later `-->`',
      'a <!---> <img src="x.png"> b --> <img src="y.png">',
    ],
    ['a tag after `<!-->` in an HTML block', '<div>\n<!--> <img src="x.png">\n</div>'],
    ['undefined reference', '![r][nope] ![nope2]'],
  ])('ignores %s', (_label, md) => {
    expect(visibleImages(md).filter((s) => s !== 'out.png')).toEqual([])
  })

  it('resolves reference-style images, first definition wins, labels case-insensitive', () => {
    const md = [
      '![ref][r] ![R2] ![Coll][]',
      '',
      '[r]: pic.png',
      '',
      '[r2]: <ref two.png> "title"',
      '',
      '[coll]: coll.png',
      '',
      '[R]: other.png',
    ].join('\n')
    expect(visibleImages(md)).toEqual(['pic.png', 'ref two.png', 'coll.png'])
  })

  it('returns destinations as cmarker hands them to the set (unescaped, not percent-decoded)', () => {
    const md = [
      '![](<sp ace.png>) ![](ümlaut.png) ![](a\\_b.png) ![](a&amp;b.png) ![](coll&#x41;.png)',
      '![](a%20b.png) ![](a\\(p\\).png) ![](p(q).png) ![](C:\\win\\x.png) ![](~/home.png)',
      '<img src="h&amp;x&#x41;&quot;.png"> <img src="a\\_b2.png">',
    ].join('\n')
    expect(visibleImages(md)).toEqual([
      'sp ace.png',
      'ümlaut.png',
      'a_b.png',
      'a&b.png',
      'collA.png',
      'a%20b.png',
      'a(p).png',
      'p(q).png',
      'C:\\win\\x.png',
      '~/home.png',
      'h&xA".png',
      'a\\_b2.png',
    ])
  })

  it('also lists the raw spelling the pipeline uses for images with {width=…} attributes', () => {
    expect(visibleImages('![w](attr\\_x.png){width=50%} ![](plain.png){width=1cm}')).toEqual([
      'attr_x.png',
      'attr\\_x.png',
      'plain.png',
    ])
  })

  it('reads HTML tags like cmarker: `>` in quoted values, unquoted values up to space or `>`', () => {
    expect(
      visibleImages(
        '<div>\n<img src="a.png" title="x>y"> <img src=b.png/>\n</div>\n\nx <span title="<img src=\'s.png\'>">z</span> <img src="ok.png">',
      ),
    ).toEqual(['a.png', 'b.png/', 'ok.png'])
  })

  it('deduplicates in document order', () => {
    expect(visibleImages('![](b.png) ![](a.png)\n\n<img src="b.png"> ![](a.png)')).toEqual([
      'b.png',
      'a.png',
    ])
  })

  it('reads an unclosed header as text, as the PDF does', () => {
    expect(visibleImages('---\n![](x.png)')).toEqual(['x.png'])
  })

  it('treats CRLF notes like LF notes', () => {
    expect(visibleImages('---\r\nlogo: y.png\r\n---\r\n![a][r]\r\n\r\n[r]: x.png\r\n')).toEqual([
      'x.png',
    ])
  })
})

const enc = (s: string) => new TextEncoder().encode(s)
const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0])
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0)
const GIF = enc('GIF89a\x01\x00')
const WEBP = enc('RIFF\x10\x00\x00\x00WEBPVP8 ')
const SVG = enc('<svg xmlns="http://www.w3.org/2000/svg"/>')
const RSA = enc('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n')

/**
 * Asserts that `run` grows about linearly: input twice as long may take about twice as long, not
 * four times (quadratic). Relative, so a slow CI runner does not fail it; 20 ms of slack keeps
 * timer noise on tiny inputs out. One warm-up run first, so JIT compilation is not counted.
 */
function expectLinear(make: (n: number) => string, run: (input: string) => unknown, n: number) {
  run(make(Math.max(1, n >> 3)))
  const time = (input: string) => {
    const t = performance.now()
    run(input)
    return performance.now() - t
  }
  const t1 = time(make(n))
  const t2 = time(make(2 * n))
  expect(t2).toBeLessThan(3 * t1 + 20)
}

describe('visibleImages stays linear on hostile notes', () => {
  // Note text is untrusted: no input may make the scan quadratic or worse.
  it.each<[string, (n: number) => string, number]>([
    ['unclosed quotes in an HTML block', (n) => `<div>\n${'<a b="'.repeat(n)}`, 5000],
    ['many tags in one paragraph after `<!-->`', (n) => `x <!--> ${'<b>'.repeat(n)}`, 10000],
    ['many tags in one paragraph', (n) => `x ${'<b>'.repeat(n)} <img src="a.png">`, 10000],
    ['an image with many spaces', (n) => `![](a${' '.repeat(n)}){width=1}`, 20000],
    ['many images with unclosed attributes', (n) => '![a](b){'.repeat(n), 5000],
    ['many images with attributes closed at the end', (n) => `${'![a](b){'.repeat(n)}}`, 5000],
    ['many images with titles and unclosed attributes', (n) => '![a](b "c"){'.repeat(n), 5000],
  ])('%s', (_label, make, n) => {
    expectLinear(make, visibleImages, n)
  })

  it('adds little to the parse itself on many unclosed image openers', () => {
    // Lezer's own parse of this text is superlinear (the editor parses the same text); what
    // visibleImages does on top of it must stay a small share of it.
    const md = '![a]('.repeat(1000)
    markdownParser.parse(md)
    let t = performance.now()
    markdownParser.parse(md)
    const parse = performance.now() - t
    t = performance.now()
    visibleImages(md)
    expect(performance.now() - t).toBeLessThan(3 * parse + 50)
  })

  it('keeps the image after a block of tags', () => {
    expect(visibleImages(`x ${'<b>'.repeat(100)} <img src="a.png">`)).toEqual(['a.png'])
  })
})

describe('imageKind', () => {
  it.each([
    ['a.png', PNG, 'png'],
    ['A.PNG', PNG, 'png'],
    ['a.jpg', JPEG, 'jpeg'],
    ['a.jpeg', JPEG, 'jpeg'],
    ['a.gif', GIF, 'gif'],
    ['a.gif', enc('GIF87a\x01\x00'), 'gif'],
    ['a.webp', WEBP, 'webp'],
    ['a.svg', SVG, 'svg'],
    ['a.svg', enc('\uFEFF<?xml version="1.0"?>\n<!-- c -->\n<svg/>'), 'svg'],
    [
      'a.svg',
      enc(
        '<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg/>',
      ),
      'svg',
    ],
  ])('%s with matching bytes -> %s', (name, data, kind) => {
    expect(imageKind(data, name)).toBe(kind)
  })

  it.each([
    ['id_rsa renamed to .png', 'id_rsa.png', RSA],
    ['id_rsa renamed to .svg', 'id_rsa.svg', RSA],
    ['no extension', 'id_rsa', RSA],
    ['png bytes, jpg name', 'a.jpg', PNG],
    ['jpeg bytes, png name', 'a.png', JPEG],
    ['svg text, png name', 'a.png', SVG],
    ['png bytes, svg name', 'a.svg', PNG],
    ['webp name, other RIFF', 'a.webp', enc('RIFF\x10\x00\x00\x00WAVEfmt ')],
    ['text with <svg later', 'a.svg', enc('secret\n<svg/>')],
    ['html', 'a.svg', enc('<html><svg/></html>')],
    ['DOCTYPE with internal subset', 'a.svg', enc('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')],
    ['unclosed comment', 'a.svg', enc('<!-- <svg/>')],
    ['unsupported type', 'a.bmp', enc('BM\x00\x00')],
    ['empty file', 'a.png', new Uint8Array()],
    ['truncated png', 'a.png', new Uint8Array([0x89, 0x50, 0x4e])],
  ])('%s -> null', (_label, name, data) => {
    expect(imageKind(data, name)).toBeNull()
  })
})

describe('linear scans of untrusted files', () => {
  it.each<[string, (n: number) => string, number]>([
    ['many empty comments before no <svg>', (n) => `${'<!---->'.repeat(n)}x`, 20000],
    ['an unclosed XML declaration', (n) => `<?xml${' '.repeat(n)}`, 20000],
    ['many DOCTYPE openers', (n) => '<!DOCTYPE svg '.repeat(n), 5000],
  ])('imageKind: %s', (_label, make, n) => {
    expect(imageKind(enc(make(n)), 'a.svg')).toBeNull()
    expectLinear(make, (svg) => imageKind(enc(svg), 'a.svg'), n)
  })

  it.each<[string, (n: number) => string, number]>([
    ['url( and many spaces', (n) => `url(${' '.repeat(n)}`, 20000],
    ['nested url( openers', (n) => `${'url('.repeat(n)}#a)`, 5000],
    ['unclosed href quotes', (n) => 'href="'.repeat(n), 5000],
    ['unquoted href values holding further hrefs', (n) => 'href=#'.repeat(n), 20000],
    ['url(# openers sharing no )', (n) => 'url(#'.repeat(n), 100000],
    ['url(# openers sharing one far )', (n) => `${'url(#'.repeat(n)})`, 100000],
    ['href and many spaces', (n) => `href${' '.repeat(n)}`, 20000],
    ['href= and many spaces', (n) => `href=${' '.repeat(n)}`, 20000],
  ])('svgHasExternalRefs: %s', (_label, make, n) => {
    expectLinear(make, svgHasExternalRefs, n)
  })
})

describe('svgHasExternalRefs', () => {
  it.each([
    '<svg><image href="file:///etc/passwd"/></svg>',
    '<svg><image xlink:href="../x.png"/></svg>',
    '<svg><rect style="background:url(x.png)"/></svg>',
    '<svg><rect fill="url( \'other.svg#g\' )"/></svg>',
    '<svg><style>@import "x.css";</style></svg>',
    '<svg><use href = other.svg#a /></svg>',
    "<svg><image HREF='x.png'/></svg>",
    '<svg><image href="  x.png"/></svg>',
    '<!DOCTYPE svg [<!ENTITY e SYSTEM "file:///etc/passwd">]><svg>&e;</svg>',
    // A nested SVG could hide references in its base64; CSS escapes could spell anything.
    '<svg><image href="data:image/svg+xml;base64,PHN2Zz4="/></svg>',
    '<svg><image href="DATA:Image/SVG+XML,%3Csvg%3E"/></svg>',
    '<svg><rect fill="url(\\66 ile.png)"/></svg>',
    '<svg><rect fill="url(\'#a\\29 x.png\')"/></svg>',
    '<svg><rect fill="url(#a"/></svg>',
    '<svg><image href="x.png/></svg>',
    // A quoted "value" opened in a comment or text swallows markup up to a real reference.
    '<svg><!-- href="# -->\n<image href="file:///etc/passwd"/></svg>',
    "<svg><desc>href='#</desc><image href='x.png'/></svg>",
    '<svg><!-- url(#a --><image href="x.png"/>)</svg>',
  ])('true for %s', (svg) => {
    expect(svgHasExternalRefs(svg)).toBe(true)
  })

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    '<svg><use href="#g1"/><use xlink:href="#g2"/></svg>',
    '<svg><image href="data:image/png;base64,AAAA"/></svg>',
    '<svg><rect fill="url(#grad)" style="fill: url( \'#g\' )"/></svg>',
    '<svg><image href="DATA:image/png;base64,AAAA"/></svg>',
  ])('false for %s', (svg) => {
    expect(svgHasExternalRefs(svg)).toBe(false)
  })
})

describe('profileImageNames', () => {
  it('lists bare image file names among all scalar values', () => {
    const yaml = [
      'name: Dr. Anna Weber',
      'signature: kanzlei-unterschrift.svg',
      'logo: "Logo Kanzlei.PNG"',
      'path-sig: ../other/sig.svg',
      'abs: /etc/x.png',
      'win: C:\\x\\y.png',
      'doc: notes.pdf',
      'nested:',
      '  stamp: stempel.jpg',
      '  list: [a.gif, b.txt]',
      'count: 3',
      'empty:',
    ].join('\n')
    expect(profileImageNames(yaml)).toEqual([
      'kanzlei-unterschrift.svg',
      'Logo Kanzlei.PNG',
      'stempel.jpg',
      'a.gif',
    ])
  })

  it('returns nothing for invalid YAML or a non-mapping', () => {
    expect(profileImageNames('a: [unclosed')).toEqual([])
    expect(profileImageNames('just-a.png')).toEqual([])
  })

  it('reads the bundled din5008a example profile', () => {
    // Inline copy of the profile's relevant lines, so the test runs without npm run assets.
    expect(
      profileImageNames(
        'name: Dr. Anna Weber\nqr: true\nsignature: beispiel-unterschrift.svg\nsignature-width: 40mm\naccent: "#B03060"\n',
      ),
    ).toEqual(['beispiel-unterschrift.svg'])
  })

  const bundled = join(
    __dirname,
    '..',
    '..',
    '..',
    'build',
    'pipeline-assets',
    'sets',
    'din5008a',
    'profiles',
    'beispiel.yaml',
  )
  it.skipIf(!existsSync(bundled))('reads the fetched din5008a beispiel.yaml', () => {
    expect(profileImageNames(readFileSync(bundled, 'utf8'))).toEqual(['beispiel-unterschrift.svg'])
  })
})
