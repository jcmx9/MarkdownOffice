import { describe, expect, it } from 'vitest'
import { sanitizeSetCss, scaleLengths, scopeSetCss } from '../../../src/core/set-css'

describe('sanitizeSetCss', () => {
  it('keeps .mdo- rules and tokens, scaled', () => {
    const { rules } = sanitizeSetCss(
      '.mdo-preview { --mdo-body-size: 11pt; --mdo-line-height: 1.5 }',
    )
    expect(rules).toEqual([
      {
        selectors: ['.mdo-preview'],
        declarations: [
          ['--mdo-body-size', 'calc(11pt * var(--mdo-scale, 1))'],
          ['--mdo-line-height', '1.5'],
        ],
      },
    ])
  })
  it.each([
    ['@import url(http://x/a.css); .mdo-a{color:red}', 1],
    ['@media print { .mdo-a{color:red} } .mdo-b{color:red}', 1],
    ['@font-face { src: url(x) } .mdo-a{color:red}', 1],
    ['body { color: red } .mdo-a, html { color: red } .mdo-b{color:red}', 1],
  ])('drops at-rules and foreign selectors: %s', (css, n) =>
    expect(sanitizeSetCss(css).rules).toHaveLength(n),
  )
  it.each([
    'background: url(http://x)',
    'background: URL( x )',
    'background: u\\72l(x)',
    'background-image: image-set("a.png" 1x)',
    '--mdo-scale: 1',
    'position: fixed',
    'position: sticky',
    'z-index: 9',
    'position: fixed !important',
    'position: -webkit-sticky',
    'position: var(--mdo-p)',
    'content: "}"',
  ])('drops the declaration %s', (decl) =>
    expect(sanitizeSetCss(`.mdo-a { ${decl}; color: red }`).rules[0]?.declarations).toEqual([
      ['color', 'red'],
    ]),
  )
  it('strips !important', () =>
    expect(sanitizeSetCss('.mdo-tb-a{max-width: 90ch !important}').rules[0]?.declarations).toEqual([
      ['max-width', '90ch'],
    ]))
  it('drops nested rules', () =>
    expect(sanitizeSetCss('.mdo-a { & body { color: red } }').rules).toEqual([]))

  it('reports what it dropped', () =>
    expect(
      sanitizeSetCss('@import "a.css"; body{color:red} .mdo-a{background: url(x); color: red}')
        .dropped,
    ).toEqual(['@import', 'selector body', 'background: url(…)']))
  it('strips comments but not comment-like text in strings', () =>
    expect(
      sanitizeSetCss('/* body{} */ .mdo-tb-a { /* x */ content: "/* ▪" }').rules[0]?.declarations,
    ).toEqual([['content', '"/* ▪"']]))
  it('keeps braces in strings out of the structure and drops the value', () =>
    expect(sanitizeSetCss('.mdo-a { content: "} body { color: red"; color: red }').rules).toEqual([
      { selectors: ['.mdo-a'], declarations: [['color', 'red']] },
    ]))
  it('drops a selector with a brace, so nothing targets body', () => {
    const { rules } = sanitizeSetCss('.mdo-a } body { color: red }')
    expect(rules).toEqual([])
    expect(scopeSetCss(rules, '#e')).not.toMatch(/body/)
  })
  it('keeps position: relative', () =>
    expect(sanitizeSetCss('.mdo-tb-a { position: relative }').rules[0]?.declarations).toEqual([
      ['position', 'relative'],
    ]))
  it('splits selectors outside parens and brackets', () =>
    expect(sanitizeSetCss('.mdo-a:is(.x, .y), .mdo-b[t="a,b"] { color: red }').rules[0]).toEqual({
      selectors: ['.mdo-a:is(.x, .y)', '.mdo-b[t="a,b"]'],
      declarations: [['color', 'red']],
    }))
  it.each(['.mdo-a { content: "abc }', '.mdo-a { width: calc(1px }', '.mdo-a { color: red'])(
    'drops unterminated input %s',
    (css) => expect(sanitizeSetCss(css).rules).toEqual([]),
  )
  it('keeps position values other than fixed and sticky, lowercases properties', () =>
    expect(sanitizeSetCss('.mdo-tb-a { Position: relative; 1x: y; --Mdo-X: 1 }').rules[0]).toEqual({
      selectors: ['.mdo-tb-a'],
      declarations: [
        ['position', 'relative'],
        ['--mdo-x', '1'],
      ],
    }))
  it('drops a rule left without declarations and stray text', () =>
    expect(sanitizeSetCss('garbage; .mdo-a { z-index: 2 } .mdo-b { color: red }').rules).toEqual([
      { selectors: ['.mdo-b'], declarations: [['color', 'red']] },
    ]))
  it.each([
    ['.mdo-tb-line::before', true],
    ['.mdo-footblock img.mdo-tb-signature', true],
    ['.mdo-preview .mdo-footblock', true],
    ['.mdo-preview > .mdo-titleblock', true],
    ['.mdo-preview .cm-line', false],
    ['.mdo-a', false],
    ['.mdo-preview *:not(.mdo-tb-a)', false],
    ['.mdo-preview:has(.mdo-titleblock) .cm-line', false],
    ['.mdo-titleblock ~ .cm-line', false],
    ['.mdo-tb-a + .mdo-tb-b', false],
  ])('treats %s as a preview block (free) = %s', (sel, free) =>
    expect(sanitizeSetCss(`${sel} { position: relative }`).rules.length).toBe(free ? 1 : 0),
  )
  it.each(['content: "Gefälscht"', 'content: "1"', 'content: attr(title)', 'content: counter(x)'])(
    'drops text-producing content %s',
    (decl) =>
      expect(
        sanitizeSetCss(`.mdo-tb-a::before { ${decl}; color: red }`).rules[0]?.declarations,
      ).toEqual([['color', 'red']]),
  )
  it.each(['"▪ "', '"– "', 'none', 'normal', '""'])('keeps decorative content %s', (v) =>
    expect(sanitizeSetCss(`.mdo-tb-a::before { content: ${v} }`).rules[0]?.declarations).toEqual([
      ['content', v],
    ]),
  )
  it.each([
    'display: none',
    'visibility: hidden',
    'opacity: 0',
    'content: "▪"',
    'position: relative',
    'transform: scale(0)',
    'height: 0',
    'overflow: hidden',
    'clip-path: inset(50%)',
    'color: transparent',
    'color: #0000',
    'color: #ffffff00',
    'color: rgba(0, 0, 0, 0)',
    'color: rgb(0 0 0 / 0)',
    'color: hsla(0, 0%, 0%, 0)',
    'color: color-mix(in srgb, red 0%, transparent)',
    'font-size: 0',
    'font-size: 0.0pt',
    'font: 0 serif',
    '--mdo-h1-color: transparent',
    '--mdo-body-size: 0px',
  ])('keeps the editor text visible: drops %s on a text rule', (decl) =>
    expect(
      sanitizeSetCss(`.mdo-preview .cm-line { ${decl}; color: red }`).rules[0]?.declarations,
    ).toEqual([['color', 'red']]),
  )
  it('keeps typography on text rules', () => {
    const decls = [
      'font-family: var(--mdo-font-serif)',
      'font-weight: 600',
      'font-style: italic',
      'line-height: 1.17',
      'letter-spacing: 0.01em',
      'text-decoration: underline',
      'text-align: right',
      'padding-top: 0',
      'margin-left: 2em',
      'border: 0.5pt solid var(--mdo-hairline)',
      'background: var(--mdo-code-bg)',
      'color: #333',
      '--mdo-body-size: 11pt',
      '--mdo-align: justify',
    ]
    expect(
      sanitizeSetCss(`.mdo-preview .cm-line { ${decls.join('; ')} }`).rules[0]?.declarations,
    ).toHaveLength(decls.length)
  })
  it.each(['url(x)', 'image(x)', 'element(#a)', 'expression(alert(1))', 'src(x)', 'u r l(x)'])(
    'drops loading function %s',
    (v) => expect(sanitizeSetCss(`.mdo-a { background: ${v} }`).rules).toEqual([]),
  )
})

describe('scaleLengths', () => {
  it.each([
    ['11pt', 'calc(11pt * var(--mdo-scale, 1))'],
    ['-3mm', 'calc(-3mm * var(--mdo-scale, 1))'],
    ['1.5em', '1.5em'],
    ['1.5', '1.5'],
    ['"Font 2pt"', '"Font 2pt"'],
    ['x2pt', 'x2pt'],
    ['calc(2pt + 1em)', 'calc(calc(2pt * var(--mdo-scale, 1)) + 1em)'],
    ['.5in 2Q', 'calc(.5in * var(--mdo-scale, 1)) calc(2Q * var(--mdo-scale, 1))'],
    ['\'a\' 1cm "b"', '\'a\' calc(1cm * var(--mdo-scale, 1)) "b"'],
    ['#12px', '#12px'],
  ])('scaleLengths(%s)', (v, out) => expect(scaleLengths(v)).toBe(out))
})

describe('scopeSetCss', () => {
  it('scopes every selector', () =>
    expect(
      scopeSetCss(
        [{ selectors: ['.mdo-a', '.mdo-b .cm-line'], declarations: [['color', 'red']] }],
        '#editor[data-mdo-set="x"]',
      ),
    ).toBe(
      '#editor[data-mdo-set="x"] .mdo-a, #editor[data-mdo-set="x"] .mdo-b .cm-line { color: red; }',
    ))
  it('writes one rule per line', () =>
    expect(
      scopeSetCss(
        [
          { selectors: ['.mdo-a'], declarations: [['color', 'red']] },
          {
            selectors: ['.mdo-b'],
            declarations: [
              ['margin', '0'],
              ['--mdo-x', '1'],
            ],
          },
        ],
        '#e',
      ),
    ).toBe('#e .mdo-a { color: red; }\n#e .mdo-b { margin: 0; --mdo-x: 1; }'))
})
