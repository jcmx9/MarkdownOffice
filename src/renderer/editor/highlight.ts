import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** Token classes; colours live in theme.css (Typst's default syntax colours). */
export const mdoHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading, class: 'mdo-tok-heading' },
    { tag: t.strong, class: 'mdo-tok-strong' },
    { tag: t.emphasis, class: 'mdo-tok-em' },
    { tag: [t.link, t.url], class: 'mdo-tok-link' },
    { tag: t.processingInstruction, class: 'mdo-tok-mark' },
    { tag: t.meta, class: 'mdo-tok-meta' },
    { tag: [t.keyword, t.bool, t.null], class: 'mdo-tok-keyword' },
    { tag: [t.string, t.regexp], class: 'mdo-tok-string' },
    { tag: [t.number, t.atom], class: 'mdo-tok-number' },
    { tag: t.comment, class: 'mdo-tok-comment' },
    {
      tag: [
        t.function(t.variableName),
        t.function(t.propertyName),
        t.typeName,
        t.className,
        t.macroName,
      ],
      class: 'mdo-tok-function',
    },
  ]),
)
