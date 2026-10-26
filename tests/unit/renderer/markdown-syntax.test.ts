// @vitest-environment happy-dom
import { IterMode, type Tree } from '@lezer/common'
import { describe, expect, it } from 'vitest'
import { markdownParser } from '../../../src/core/markdown-syntax'
import { mdoMarkdown } from '../../../src/renderer/editor/markdown'

// The export decides which images a note shows with core's parser (core/export-files.ts); it must
// read every note exactly as the editor does. The editor mounts YAML inside the front matter for
// highlighting, which the core parser leaves out, so mounted trees are not compared.
function nodes(tree: Tree): string[] {
  const out: string[] = []
  const cursor = tree.cursor(IterMode.IgnoreMounts)
  do out.push(`${cursor.name} ${cursor.from}-${cursor.to}`)
  while (cursor.next())
  return out
}

const DOC = [
  '---',
  'title: T',
  'logo: x.png',
  '---',
  '# Head ![](h.png)',
  '',
  'Text ![a](p.png "t") [![](b.png)](https://e.com) $![](m.png)$ H~2~O x^2^ :smile:',
  '',
  '- [ ] task ![](t.png) ==mark **in** it== `==no==` $a == b == c$',
  '',
  '| a | b |',
  '|---|---|',
  '| ![](c.png) | $x\\|y$ ==hl== |',
  '',
  '> [!NOTE]',
  '> ![r][ref] ~~gone~~ <img src="i.png">',
  '',
  '$$',
  'x',
  '$$',
  '',
  '<!-- ![](hidden.png) -->',
  '',
  '```js',
  '![](code.png)',
  '```',
  '',
  '[ref]: <r e f.png>',
].join('\n')

describe('core markdownParser', () => {
  it('builds the same tree as the editor', () => {
    expect(nodes(markdownParser.parse(DOC))).toEqual(
      nodes(mdoMarkdown().language.parser.parse(DOC)),
    )
  })
})
