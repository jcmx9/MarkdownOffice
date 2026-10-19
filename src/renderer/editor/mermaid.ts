import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'

/** Diagram types, directions and statements; everything else is an id or text. */
const KEYWORDS = new Set([
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'gitGraph',
  'quadrantChart',
  'xychart-beta',
  'block-beta',
  'TB',
  'TD',
  'BT',
  'RL',
  'LR',
  'subgraph',
  'end',
  'direction',
  'participant',
  'actor',
  'activate',
  'deactivate',
  'loop',
  'alt',
  'else',
  'opt',
  'par',
  'and',
  'critical',
  'break',
  'rect',
  'note',
  'Note',
  'over',
  'left',
  'right',
  'of',
  'class',
  'classDef',
  'style',
  'linkStyle',
  'click',
  'title',
  'section',
  'dateFormat',
  'axisFormat',
  'excludes',
  'commit',
  'branch',
  'checkout',
  'merge',
  'state',
])

/** Links and messages: -->, ---, -.->, ==>, ->>, -x, --o, <-->, … */
const ARROW = /^(<?[-=.]{1,3}[->xo]{1,2}|<?-[-.]+|<?=[=]+)/

/** Bracketed node text: [..], (..), {..}, ((..)), [[..]], [(..)], >..] */
const SHAPE: Record<string, string> = { '[': ']', '(': ')', '{': '}', '>': ']' }

const mermaidLanguage = StreamLanguage.define<null>({
  name: 'mermaid',
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match('%%')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/^"[^"]*"?/)) return 'string'
    if (stream.match(/^\|[^|]*\|?/)) return 'string'
    if (stream.match(ARROW)) return 'operator'
    const ch = stream.peek() ?? ''
    const close = SHAPE[ch]
    if (
      close &&
      !(ch === '>' && stream.pos > 0 && /\w/.test(stream.string[stream.pos - 1] ?? ''))
    ) {
      const end = stream.string.indexOf(close, stream.pos + 1)
      // Doubled shapes ((..)), [[..]], {{..}} close with the doubled bracket.
      const doubled = stream.string[stream.pos + 1] === ch
      const stop = doubled ? stream.string.indexOf(close + close, stream.pos + 2) : end
      if (stop > stream.pos) {
        stream.pos = stop + (doubled ? 2 : 1)
        while (stream.peek() === close) stream.next()
        return 'string'
      }
    }
    if (stream.match(/^\d+(\.\d+)?\b/)) return 'number'
    if (stream.match(/^[\w-]+/)) {
      return KEYWORDS.has(stream.current()) ? 'keyword' : null
    }
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '%%' } },
})

/** Fenced ```mermaid / ```mmd blocks; Typst renders them in the PDF, the editor colours them. */
export const mermaid = LanguageDescription.of({
  name: 'mermaid',
  alias: ['mmd'],
  support: new LanguageSupport(mermaidLanguage),
})
