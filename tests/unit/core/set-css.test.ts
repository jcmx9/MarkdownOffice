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
  ])('drops the declaration %s', (decl) =>
    expect(sanitizeSetCss(`.mdo-a { ${decl}; color: red }`).rules[0]?.declarations).toEqual([
      ['color', 'red'],
    ]),
  )
  it('strips !important', () =>
    expect(sanitizeSetCss('.mdo-a{max-width: 90ch !important}').rules[0]?.declarations).toEqual([
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
      sanitizeSetCss('/* body{} */ .mdo-a { /* x */ content: "/* }" }').rules[0]?.declarations,
    ).toEqual([['content', '"/* }"']]))
  it('keeps braces in strings out of the structure', () =>
    expect(sanitizeSetCss('.mdo-a { content: "} body { color: red" }').rules).toEqual([
      { selectors: ['.mdo-a'], declarations: [['content', '"} body { color: red"']] },
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
    expect(sanitizeSetCss('.mdo-a { Position: relative; 1x: y; --Mdo-X: 1 }').rules[0]).toEqual({
      selectors: ['.mdo-a'],
      declarations: [
        ['position', 'relative'],
        ['--mdo-x', '1'],
      ],
    }))
  it('drops a rule left without declarations and stray text', () =>
    expect(sanitizeSetCss('garbage; .mdo-a { z-index: 2 } .mdo-b { color: red }').rules).toEqual([
      { selectors: ['.mdo-b'], declarations: [['color', 'red']] },
    ]))
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
