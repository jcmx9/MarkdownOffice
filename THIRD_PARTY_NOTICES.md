# Third-party notices

Markdown Office is AGPL-3.0-or-later (see `LICENSE`). The editor preview sets paragraphs like
Typst and for that contains the following third-party code and data. Fonts, the Typst compiler and
the Typst packages that ship with the pipeline have their own licence files in
`pipeline/licenses/`.

## Typst (line breaking) - Apache-2.0

Parts of Typst 0.15.0 (https://github.com/typst/typst, tag `v0.15.0`) are ported to TypeScript,
modified: the line breaking and line layout of `crates/typst-layout/src/inline/linebreak.rs` and
`line.rs` and the link prefix rule of `crates/typst-syntax/src/lexer.rs`
(`src/core/paragraph/breaks.ts`, `src/core/paragraph/linebreak.ts`; table in `vendor/typst/README.md`).

Copyright Typst contributors. Licensed under the Apache License, Version 2.0 (`vendor/typst/LICENSE`),
http://www.apache.org/licenses/LICENSE-2.0

## hypher 0.1.5 - MIT OR Apache-2.0

The hyphenation lookup (`src/core/paragraph/hyphenate.ts`) is a TypeScript port of hypher
(https://github.com/typst/hypher, tag `v0.1.5`), and `vendor/hypher/de.bin` and `en.bin` are its
binary tries. Copyright Laurenz Mädje and contributors. Licensed under the MIT licence or the
Apache License 2.0, at your option (`vendor/hypher/LICENSE-MIT`, `vendor/hypher/LICENSE-APACHE`).

### German patterns (`de.bin`) - MIT

Hyphenation patterns for German, reformed orthography (`hyph-de-1996.tex`, version 2021-02-26,
hyph-utf8). Copyright (C) 2013-2021 Stephan Hennig, Werner Lemberg, Günter Milde, Sander van
Geloven, Georg Pfeiffer, Gisbert W. Selke, Tobias Wendorf, Keno Wehr (Deutschsprachige
Trennmustermannschaft).

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### English patterns (`en.bin`) - Kuiken notice licence

Hyphenation patterns for American English (`hyph-en-us.tex`, version 2005-05-30, hyph-utf8).
Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken. This file is part of the hyph-utf8 package, see
http://www.hyphenation.org/tex. Licence, as stated in the pattern file's header:

> Copying and distribution of this file, with or without modification, are permitted in any medium
> without royalty provided the copyright notice and this notice are preserved.

## linebreak 1.1.0 - MIT

The Unicode line break opportunities (UAX #14) come from the npm package `linebreak`
(https://github.com/foliojs/linebreak). It is bundled into the app; its LICENSE file does not travel
with the bundle, so the notice and the full MIT permission text are given here.

Copyright (c) 2014-present Devon Govett

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
