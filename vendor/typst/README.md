# Typst 0.15.0 (ported code)

Licence text (`LICENSE`, Apache-2.0) from https://github.com/typst/typst, tag `v0.15.0`
(commit `3ae5277`). Copyright Typst contributors.

Parts of Typst's source are ported to TypeScript, modified, so the editor preview breaks lines
where the PDF does:

| Typst source (tag `v0.15.0`) | Ported to |
|------------------------------|-----------|
| `crates/typst-layout/src/inline/linebreak.rs` (`breakpoints`, `linebreak_link`, `hyphenations`) | `src/core/paragraph/breaks.ts` |
| `crates/typst-syntax/src/lexer.rs` (`link_prefix`) | `src/core/paragraph/breaks.ts` |
| `crates/typst-layout/src/inline/linebreak.rs` (`linebreak`, `linebreak_simple`, `linebreak_optimized*`, `ratio_and_cost`, `raw_ratio`, `raw_cost`, `CostMetrics`, `Estimates`) and `crates/typst-layout/src/inline/line.rs` (`line`, `commit`) | `src/core/paragraph/linebreak.ts` |
