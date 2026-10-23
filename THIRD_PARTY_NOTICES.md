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

Copyright Typst contributors. Licensed under the Apache License, Version 2.0,
http://www.apache.org/licenses/LICENSE-2.0. The full licence text and Typst's NOTICE ship with the
app as `pipeline/licenses/typst/LICENSE` and `pipeline/licenses/typst/NOTICE` (the same files as
`vendor/typst/LICENSE` in the source repository).

## hypher 0.1.5 - MIT OR Apache-2.0

The hyphenation lookup (`src/core/paragraph/hyphenate.ts`) is a TypeScript port of hypher
(https://github.com/typst/hypher, tag `v0.1.5`), and `vendor/hypher/de.bin` and `en.bin` are its
binary tries. Copyright Laurenz Mädje and contributors. Licensed under the MIT licence or the
Apache License 2.0, at your option; Markdown Office uses it under the MIT licence, whose full text
follows (the source repository also keeps `vendor/hypher/LICENSE-MIT` and `LICENSE-APACHE`).

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

## Bundled dependencies of linebreak - MIT

`linebreak` brings three small packages that are bundled with it; their LICENSE files do not travel
with the bundle either. Each is under the MIT licence with the permission text given above for
`linebreak` (repeated once below for completeness).

- `unicode-trie` 2.0.0 (https://github.com/devongovett/unicode-trie), reads the line break class
  table. Copyright 2018 Devon Govett.
- `tiny-inflate` 1.0.3 (https://github.com/devongovett/tiny-inflate), decompresses that table.
  Copyright (c) 2015-present Devon Govett.
- `base64-js` 0.0.8 (https://github.com/beatgammit/base64-js), decodes the embedded table.
  Copyright (c) 2014 T. Jameson Little.

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

## Unicode line break data - Unicode License

The line break class table inside `linebreak` (`classes.trie`) is generated from `LineBreak.txt` of
the Unicode Character Database (Unicode 13.0, per linebreak's readme). Unicode data files are
licensed under the Unicode Data Files and Software License that Unicode 13.0 was released under,
reproduced below (unicode.org now publishes Unicode License V3 at
https://www.unicode.org/license.txt for current data). Its copyright and permission notice:

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2020 Unicode, Inc. All rights reserved. Distributed under the Terms of Use in
https://www.unicode.org/copyright.html.

Permission is hereby granted, free of charge, to any person obtaining a copy of the Unicode data
files and any associated documentation (the "Data Files") or Unicode software and any associated
documentation (the "Software") to deal in the Data Files or Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, and/or sell copies
of the Data Files or Software, and to permit persons to whom the Data Files or Software are
furnished to do so, provided that either (a) this copyright and permission notice appear with all
copies of the Data Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT OF THIRD PARTY RIGHTS. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN
THIS NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES, OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall not be used in advertising
or otherwise to promote the sale, use or other dealings in these Data Files or Software without
prior written authorization of the copyright holder.
