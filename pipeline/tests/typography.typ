// Parity fixture for src/core/typography.ts (pipeline/tests/test-typography.sh): runs
// markdown.typ's smart-typography over fixtures/typography.txt in German and English and
// exposes both results as the metadata <out> (`typst eval 'query(<out>).first().value'`).
#import "../lib/markdown.typ": smart-typography

#let lines = read("fixtures/typography.txt").split("\n")
#metadata((de: smart-typography(lines, "de"), en: smart-typography(lines, "en"))) <out>
