# hypher 0.1.5 hyphenation tries

Binary tries and licence texts from https://github.com/typst/hypher, tag `v0.1.5` (the version
Typst 0.15.0 locks). Do not replace with a later tag: 0.1.6 to 0.1.8 changed the German patterns, so
line breaks in the editor preview would no longer match the PDF.

| File | Bytes | SHA-256 |
|------|-------|---------|
| `de.bin` | 196489 | `b2aa8bb33a4e54a409fc61f47643210d03b5493e4ef1059dac946b00730ed023` |
| `en.bin` | 26947 | `be2bcb386cb777a191813f68b995d0c22fbf30783ac52a0ad2489c8ebd7fd354` |

Read by `src/core/paragraph/hyphenate.ts`, a TypeScript port of hypher's lookup.

## Licences

- hypher code and the trie format: `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`), Laurenz Mädje and contributors.
- German patterns (`de.bin`, from `hyph-de-1996.tex`, hyph-utf8): MIT. Copyright (C) 2013-2021 Stephan Hennig, Werner Lemberg, Günter Milde, Sander van Geloven, Georg Pfeiffer, Gisbert W. Selke, Tobias Wendorf, Keno Wehr (Deutschsprachige Trennmustermannschaft).
- English patterns (`en.bin`, from `hyph-en-us.tex`, version 2005-05-30, hyph-utf8): Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken; the file header states: "Copying and distribution of this file, with or without modification, are permitted in any medium without royalty provided the copyright notice and this notice are preserved." Full notices in `THIRD_PARTY_NOTICES.md` at the repository root.
