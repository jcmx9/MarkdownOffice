// Parity fixture for src/core/highlight.ts (pipeline/tests/test-marks.sh): runs markdown.typ's
// marks() over fixtures/marks.txt and exposes the result as the metadata <out>
// (`typst eval 'query(<out>).first().value'`).
#import "../lib/markdown.typ": marks

#let lines = read("fixtures/marks.txt").split("\n")
#metadata(marks(lines)) <out>
