# Writing template sets

This guide is the complete contract between the Markdown Office pipeline and a template set. It is written so that a person or an AI can build a new set from scratch with no other context. Every statement is backed by `pipeline/build.sh` (macOS, Linux), `pipeline/convert.ps1` (Windows) and `pipeline/lib/markdown.typ`.

**Reference implementation:** the set `memo` ([jcmx9/MarkdownOffice-set-memo](https://github.com/jcmx9/MarkdownOffice-set-memo), file `memo.typ`). Copy from it when in doubt; it handles every input and every element described here.

## 1. What a set is

A set is a Typst template plus optional companion files, all sharing one name:

| File | Required | Read by | Purpose |
|------|----------|---------|---------|
| `<name>.typ` | yes | pipeline (Typst) | Builds the whole PDF: page layout, metadata, and the body via cmarker |
| `<name>.header.md` | no | editor (only `memo.header.md` today) | Front-matter template with every key the set understands |
| `<name>.css` | no | nobody yet (reserved) | Editor preview overrides |

**Name rule:** `^[a-z0-9_-]+$` (lowercase letters, digits, `_`, `-`). Anything else is not treated as a set name. A value ending in `.typ` (case-insensitive) is a single template file instead.

**Layouts on disk:**

| Where | Layout | Notes |
|-------|--------|-------|
| User folder | `<MDO_TEMPLATES>/<name>.typ` | flat file, no sub-folder; default `~/Documents/Markdown Office/Vorlagen/` (Windows: the *Documents* folder + `\Markdown Office\Vorlagen`) |
| Bundled sets | `<MDO_SETS_DIR>/<name>/<name>.typ` | default `<pipeline>/../sets`; the app ships `<resources>/sets/memo/` |
| Set repository | `<name>.typ`, `<name>.css`, `<name>.header.md` at the repo root | extracted as-is into `sets/<name>/` |

Keep the set in **one self-contained `.typ` file**. Only import from the pipeline (`mdo`, see §4). On Windows a template on a different drive than the pipeline is copied alone into a staging folder, so sibling files of the `.typ` are not reachable there.

## 2. How the pipeline finds and runs a set

### Resolution

1. Value: `--template VALUE` on the command line wins; otherwise the front-matter key `template:`; otherwise `memo`.
2. A **name** is looked up in this order, first hit wins:
   1. `${MDO_TEMPLATES:-~/Documents/Markdown Office/Vorlagen}/<name>.typ`
   2. `${MDO_TEMPLATES:-~/Documents/Markdown Office/Vorlagen}/<name>/<name>.typ` (a set folder, so that a cloned or catalog-installed set repo works as is)
   3. `${MDO_SETS_DIR:-<pipeline>/../sets}/<name>/<name>.typ`
3. A **`.typ` value**: `~`, `$VAR`, `${VAR}`, `%VAR%` and `%XX` are expanded; a relative path counts from the caller's working directory (`--template`) or from the note's folder / `MDO_BASE_DIR` (`template:`).
4. Not found or invalid: message on stderr, exit 1. No fallback to `memo`.

### Invocation

Both scripts run Typst ≥ 0.15 twice on the resolved `.typ`:

```bash
# 1. probe: collect image sources (see §5.1); errors are ignored
typst eval --in <set>.typ '<query expression>' --font-path <pipeline>/fonts --ignore-system-fonts \
  --root / <all --input …> --input probe=true
# 2. real build
typst compile <set>.typ <out.pdf> --font-path <pipeline>/fonts --ignore-system-fonts \
  --root / --pdf-standard a-3b <all --input …> --input images=<map.json>
```

- `--root /` (Windows: the drive root of the pipeline folder): every input path is absolute and readable with `read()`, `image()`, `json()`.
- On Windows path inputs are **drive-less, forward-slash** paths (`C:\Users\a\n.md` → `/Users/a/n.md`). Files on another drive are copied to a staging folder first. Treat paths as opaque strings and only split on `/`.
- `SOURCE_DATE_EPOCH` is set to the source's modification time unless the caller set it, so `date: auto` in `set document` is reproducible.
- The **front matter is parsed by the scripts**, not by the template. Only the keys listed in §3 reach the template; unknown front-matter keys are not passed. A set that needs its own keys must parse `read(sys.inputs.source)` itself.

### Output name (decided by the script, not the template)

- Second positional argument → written exactly there (relative to the caller's working directory).
- Otherwise next to the source as `<base>.pdf`; with a recognised `date:` (`YYYY-MM-DD` or `D.M.YYYY`) as `<YYYY-MM-DD>_<base>.pdf`, unless `isodate_praefix: false`.

### Logo lookup (decided by the script)

Only when `logo:` is set and ends in `.svg`, `.png`, `.jpg` or `.jpeg`; remote values (`http(s)://`, `//`, `data:`) are refused. Absolute (after `~`/variable expansion) → exactly that file. Relative → first existing of `<note folder or MDO_BASE_DIR>/`, `~/` (Windows `%USERPROFILE%`), the templates folder (`MDO_TEMPLATES`, default `~/Documents/Markdown Office/Vorlagen/`), `<pipeline>/`. Nothing found → `logo` input is empty, with a notice. The template never searches.

### Profiles (decided by the script)

A set that needs a sender (a letter) reads a profile: a YAML file plus the files next to it (signature, logo). The note names it with `profile:`; the script finds it and passes the absolute path as input `profile` (`""` without `profile:`). A set reads it with `yaml(sys.inputs.profile)` and further files relative to the profile's folder, e.g. `read(dir + "/" + data.signature)` with `dir` = the path up to the last `/`.

| Value of `profile:` | Looked up |
|---|---|
| a name (`a-z`, `0-9`, `_`, `-`), e.g. `roland` | `profiles/<name>.yaml` 1. in the note's folder (or `MDO_BASE_DIR`), 2. in the templates folder (`~/Documents/Markdown Office/Vorlagen/` or `MDO_TEMPLATES`), 3. in the folder of the resolved set (its example profiles) – the first existing file wins |
| a path ending in `.yaml`/`.yml` | relative to the note, `~`, `$VAR`, `${VAR}` and `%VAR%` expanded |

A profile that is not found stops the export with exit code 1 and „Profil nicht gefunden: <name>“, listing the searched folders, and writes no PDF: a letter without a sender is worse than none. On Windows the profile's folder is copied as a whole to the staging folder when it is on another drive than Typst's root, so the signature stays readable.

## 3. Inputs (`sys.inputs`)

All values are **strings**. Booleans are `"true"`/`"false"`. Empty front-matter values arrive as `""`. Always read with `sys.inputs.at(key, default: …)`.

| Key | Meaning | Format | Value when unset |
|-----|---------|--------|------------------|
| `filename` | File name of the output PDF | e.g. `2026-10-18_note.pdf` | always set |
| `title` | Fallback metadata title: source base name without extension | text | always set |
| `doctitle` | Front matter `title:` | text | `""` |
| `subtitle` | Front matter `subtitle:` | text | `""` |
| `client` | Front matter `client:` | text | `""` |
| `author` | Front matter `author:`; an inline list `[A, B]` becomes `A, B` | comma-separated text | `""` |
| `date` | Front matter `date:`, **raw** (not normalised) | `2026-10-13`, `13.10.2026` or free text | `""` |
| `lang` | Front matter `lang:` | `de`, `en`, … | `de` |
| `toc` | Front matter `toc:` | `auto` / `true` / `false` | `auto` |
| `h1_break` | Front matter `h1_break:` | `auto` / `true` / `false` | `auto` |
| `showname` | Front matter `print_filename:` | `true` / `false` | `true` |
| `header` | Front matter `header:` (fixed header text) | text | `""` |
| `watermark` | Front matter `watermark:` | text | `""` |
| `hard_breaks` | Front matter `hard_breaks:`; `--hard-breaks` / `--soft-breaks` win | `true` / `false` | `true` |
| `logo` | Resolved logo file (see §2) | absolute path | `""` = no logo |
| `logo_height` | Front matter `logo-height:`, **raw**; the template validates it | e.g. `13mm`, `1.5cm`, `40pt` | `""` |
| `profile` | Resolved sender profile (front matter `profile:`, see "Profiles" in §2); files next to it (signature, logo) are readable; on Windows forward slashes | absolute path | `""` = no `profile:` |
| `source` | The Markdown source to render | absolute path | always set |
| `attach` | File to embed as PDF attachment; `embed_source: false` or `--no-source` empties it | absolute path (= `source`) | `""` = do not embed |
| `docdir` | Base folder for relative image paths: `MDO_BASE_DIR` or the source's folder | absolute path | always set |
| `mdo` | Pipeline folder containing `lib/` and `vendor/` | absolute path | always set |
| `version` | Markdown Office version (`MDO_VERSION`) | e.g. `26.10.0` | `dev` |
| `probe` | Set only in the probe run (§5.1) | `true` | absent |
| `images` | Set only in the real build: JSON file mapping each raw image source to a resolved absolute path, `""` when the file is missing | path to a JSON object | absent |

`template`, `isodate_praefix` and `embed_source` are consumed by the scripts and are not inputs (`embed_source` shows up as an empty `attach`).

## 4. Fonts and packages

The pipeline passes `--font-path <pipeline>/fonts --ignore-system-fonts`: **system fonts are never available**. Families (as Typst names them):

| Family | Files | Use in memo |
|--------|-------|-------------|
| `SourceSans3VF` | Source Sans 3 variable, upright + italic | body |
| `Source Serif 4` | Source Serif 4 variable, roman + italic | headings |
| `SourceCodeVF` | Source Code Pro variable, upright + italic | code |
| `Noto Emoji` | monochrome, variable | fallback for emoji |
| `Noto Sans Symbols 2` | regular | fallback for symbols |
| `Libertinus Serif`, `New Computer Modern`, `New Computer Modern Math`, `DejaVu Sans Mono` | embedded in Typst | Typst defaults |

Use a font list with the Noto fallbacks, e.g. `("SourceSans3VF", "Noto Emoji", "Noto Sans Symbols 2")`. Variable weights work with numeric `weight:` values.

Bundled Typst packages live in `<mdo>/vendor/` (versions pinned in `scripts/pipeline-assets.json`):

| Package | Version | Import | Purpose |
|---------|---------|--------|---------|
| cmarker | 0.1.10 | `#import mdo + "/vendor/cmarker/lib.typ" as cmarker` | Markdown → Typst |
| mitex | 0.2.7 | `#import mdo + "/vendor/mitex/lib.typ": mitex` | LaTeX math for `$…$`, `$$…$$` (pass as `math: mitex`) |
| mmdr | 0.2.2 | `#import mdo + "/vendor/mmdr/lib.typ": mermaid-svg` | Mermaid → SVG, offline (memo: `show raw.where(lang: "mermaid", block: true)`) |

Pipeline library: `#import mdo + "/lib/markdown.typ": preprocess`. Use `#let mdo = sys.inputs.at("mdo", default: ".")` and import by path; `@preview/…` imports do not work offline.

## 5. Preprocessing contract

The template must render the body as:

```typst
#cmarker.render(preprocess(read(source), hard-breaks: …, lang: …), html: (…), scope: (…), …)
```

`preprocess(src, hard-breaks: false, lang: "de")` (pass `hard-breaks: sys.inputs.hard_breaks != "false"`, `lang: sys.inputs.lang`) strips the front matter, normalises line endings and rewrites Markdown extensions. Fenced code blocks are never touched; `$$` blocks and inline code are skipped where noted. Steps, in order:

| Markdown | Becomes | The set must |
|----------|---------|--------------|
| `<!-- pagebreak -->`, `\newpage`, `\pagebreak`, `\clearpage` alone on a line | `<!--raw-typst #pagebreak(weak: true) -->` | nothing (cmarker runs it; keep `raw-typst` enabled, the default) |
| `"…"`, `'…'`, `geht's`, `--`, `---`, `...` | `„…“`/`‚…‘` (lang `de*`) or `“…”`/`‘…’`, `’`, `–`, `—`, `…` | pass `smart-punctuation: false` (otherwise cmarker re-quotes) |
| `> [!NOTE]` … (also `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`, German `INFO`, `TIPP`, `WICHTIG`, `HINWEIS`, `ACHTUNG`) | `<mdo-alert kind="note\|tip\|important\|warning\|caution">` + Markdown body + `</mdo-alert>` | handle `mdo-alert` |
| A list made **only** of tasks `- [ ] Task – Owner, bis Date` | `<mdo-tasks>` with one `<mdo-task done="true\|false" owner="…" due="…">` + Markdown body per item | handle `mdo-tasks` and `mdo-task` |
| Lines starting with a date like `18. Oktober 2026` | the dot escaped (`18\.`), each line kept | nothing |
| A paragraph of ≤ 4 lines directly before a table | wrapped in `<mdo-keep after="par\|block">` … `</mdo-keep>` | handle `mdo-keep` (memo: `block(sticky: true)`) |
| `Term` + next line `: Definition` | `<dl><dt>Term</dt><dd>` + Markdown + `</dd></dl>` | optionally override `terms` in `scope` (cmarker calls it with `(term, description)` arrays) |
| Single line breaks inside a paragraph (only with `hard-breaks: true`) | `\` at line end | nothing |
| `==text==` | `<mark>text</mark>` | nothing (cmarker → `highlight`; style with `set highlight`) |
| `![Alt](path){width=50% height=8cm}` | `<img src="path" alt="Alt" width="50%" height="227">` (absolute units → integer pt, `px` × 0.75) | nothing beyond the `image` override |

Mixed task lists (tasks and plain items) stay lists; cmarker draws the checkbox via `task-list-marker: (checked) => …` (optional).

**Unhandled tags are dropped silently:** without a handler in `html:`, the tag disappears and only its body text remains (a task table becomes loose lines, owner and due are lost). Handlers have the signature `(attrs, body) => content`, `attrs` is a dictionary of strings.

Minimal handlers:

```typst
#let mdo-alert(attrs, body) = block(inset: 8pt, stroke: (left: 2pt + gray),
  [*#upper(attrs.at("kind", default: "note"))* \ #body])
// Each task yields metadata; the table collects it.
#let mdo-task(attrs, body) = metadata((done: attrs.at("done", default: "false") == "true",
  owner: attrs.at("owner", default: ""), due: attrs.at("due", default: ""), body: body))
#let mdo-tasks(attrs, body) = {
  let kids = if body.func() == metadata { (body,) } else if body.has("children") { body.children } else { () }
  let tasks = kids.filter(c => c.func() == metadata).map(c => c.value)
  table(columns: 4, [*Task*], [*Owner*], [*Due*], [*Done*],
    ..tasks.map(t => (t.body, t.owner, t.due, if t.done [✓] else [–])).flatten())
}
#let mdo-keep(attrs, body) = block(sticky: true, body)
```

### 5.1 Images and the probe run

Typst can neither read environment variables nor test whether a file exists, and a missing image aborts a build. The scripts therefore ask the template for its image sources first:

1. **Probe** (`probe=true`, no `images` input): the scripts evaluate
   `query(<mdo-remote-skip>).len()` and `query(<mdo-image>).map(m => m.value).dedup()`.
   In this run the template must **not load images**; it emits `[#metadata(src)<mdo-image>]` for each local source and `[#metadata(src)<mdo-remote-skip>]` for each remote one (`http://`, `https://`, `//`, `data:`).
2. The scripts expand `~`/variables, resolve relative sources against `docdir`, check existence and write the JSON map.
3. **Build** (`images=<map.json>`): look up the raw source in the map; `""` means missing → render a placeholder, never call `image()`.

Hook it in via `scope: (image: safe-image)` in `cmarker.render`. The probe must compile without errors: if it fails, the map is empty and every image is reported missing. A template that skips this mechanism aborts at the first missing image. Remote images are counted and reported by the script (`Hinweis: N Remote-Bild(er) übersprungen …`).

## 6. Front matter and the header template

The scripts read a leading `---` … `---` (or `...`) block line by line as `key: value`. Values: surrounding quotes removed, `# comment` after a value removed, inline list `[A, "B"]` → `A, B`; booleans accept `true/false/yes/no/on/off/y/n` in any case (invalid → warning, default kept); empty values are ignored. The full key list with defaults is in the README section *Front matter*.

Sets get the whole block as Typst data, with real YAML (lists, maps, typed values):

```typst
#import sys.inputs.mdo + "/lib/markdown.typ": frontmatter
#let fm = frontmatter(read(sys.inputs.source))
#fm.at("x-to", default: ())   // e.g. an address list
```

`frontmatter(src: str) -> dictionary` returns `(:)` without front matter or with an empty or unclosed block. Convention: pipeline keys have no prefix, keys that only a set reads start with `x-`. The shell parsers only read keys at column 0 and ignore indented lines (nested values) and unknown keys such as `x-…`, so a nested `title:` or `date:` never changes the pipeline's values.

`<name>.header.md` is the set's front-matter template, inserted at the top of a note. Rules:

- It is a complete front-matter block (`---` … `---`), UTF-8 without BOM, below 64 KiB.
- It **must contain the line `template: <name>`**, so a note created from it selects the set.
- Comments are allowed, on their own lines and after values (`toc: auto   # auto, true, false`).
- List every key the set honours, with its default. Keys the set ignores should be left out.

Reference (`memo.header.md`, abridged):

```yaml
---
template: memo          # Vorlagen-Set oder .typ-Datei
title: ""               # Titelblock, Kopfzeile, PDF-Titel
date: ""                # 2026-10-13 oder 13.10.2026; leer: kein Datum
lang: de                # de oder en
toc: auto               # Inhaltsverzeichnis: auto, true, false
embed_source: true      # Markdown-Quelle ins PDF einbetten
hard_breaks: true       # jede Zeile bleibt eine Zeile
---
```

Today the editor only reads `<sets>/memo/memo.header.md` (menu *Einfügen → YAML-Header (memo)*).

## 7. PDF requirements

Every set must produce a valid **PDF/A-3b** with the source attached, like `memo`:

| Requirement | Done by the pipeline | Done by the template |
|-------------|----------------------|----------------------|
| PDF/A-3b | `--pdf-standard a-3b`; Typst embeds all fonts and refuses non-conforming output | Set a non-empty `title` in `set document` (PDF/A requires it). Never set `date: none` (PDF/A requires a date): use a parsed `date` or `auto` |
| Reproducible date | `SOURCE_DATE_EPOCH` = source mtime | Parse `date` (ISO or `D.M.YYYY`, validate month/day) into `datetime`, else `auto` |
| Embedded source | Passes `attach` (empty with `--no-source` / `embed_source: false`) | If `attach != ""`: `pdf.attach("/" + attach.split("/").last(), read(attach, encoding: none), relationship: "source", mime-type: "text/markdown")`. Use only the file name as attachment name, never the full path (it would leak the local user name) |
| Metadata | — | memo: `title` = `doctitle` or `title`; `author` = `author` split at `,`; `description` = `doctitle`; `keywords` = `client` + `"Markdown Office " + version` |
| Colours | — | Use `luma()` for greys (stored as single-channel grey); Typst 0.15 cannot embed CMYK in PDF/A |

## 8. Editor preview CSS

`<name>.css` is reserved for editor overrides: the editor brings its own preview look (derived from `memo.typ`) and a set may later override it only via the CSS variables `--mdo-*` and the classes `.mdo-*`. The editor does not load set CSS yet; `memo.css` contains no rules. Ship an empty or minimal file with a comment; never rely on it for PDF output.

## 9. Minimal working skeleton

Verified with Typst 0.15.0 and the pipeline: renders headings, callouts, task tables, table intros, definition lists, formulas, page breaks, missing and remote images, and produces PDF/A-3b with the source attached. Save as `skel.typ`.

```typst
// skel – minimal Markdown Office template set.
#let mdo = sys.inputs.at("mdo", default: ".")
#import mdo + "/vendor/cmarker/lib.typ" as cmarker
#import mdo + "/vendor/mitex/lib.typ": mitex
#import mdo + "/lib/markdown.typ": preprocess

#let inp(key, default: "") = sys.inputs.at(key, default: default)
#let lang = inp("lang", default: "de")
#let doctitle = inp("doctitle")
#let source = inp("source", default: none)
#let attach = inp("attach")
#let docdir = inp("docdir")
#let probe = inp("probe", default: "false") == "true"
#let image-map = if inp("images") == "" { none } else { json(inp("images")) }

// PDF/A-3b needs a title and a date; the pipeline sets SOURCE_DATE_EPOCH for `auto`.
#let parse-date(s) = {
  let s = s.trim()
  let p = if s.match(regex("^\d{4}-\d{1,2}-\d{1,2}$")) != none { s.split("-").map(int) }
    else if s.match(regex("^\d{1,2}\.\d{1,2}\.\d{4}$")) != none { s.split(".").map(int).rev() }
    else { return auto }
  if p.at(1) < 1 or p.at(1) > 12 or p.at(2) < 1 or p.at(2) > 31 { return auto }
  datetime(year: p.at(0), month: p.at(1), day: p.at(2))
}
#set document(
  title: if doctitle != "" { doctitle } else { inp("title", default: "Document") },
  author: inp("author").split(",").map(a => a.trim()).filter(a => a != ""),
  date: parse-date(inp("date")),
  keywords: ("Markdown Office " + inp("version"),),
)
#if attach != "" {
  pdf.attach("/" + attach.split("/").last(), read(attach, encoding: none),
    relationship: "source", mime-type: "text/markdown", description: "Markdown source")
}

#set page(paper: "a4", margin: 25mm,
  footer: context align(center, text(9pt, counter(page).display("1 / 1", both: true))))
#set text(font: ("SourceSans3VF", "Noto Emoji", "Noto Sans Symbols 2"), size: 10.5pt, lang: lang)
#set par(justify: true)
#show heading: set text(font: "Source Serif 4")
#show raw: set text(font: "SourceCodeVF")

// Images: probe mode reports sources, the real run reads the resolved map.
#let safe-image(src, alt: none, ..args) = {
  if type(src) != str { return image(src, alt: alt, ..args) }
  if src.starts-with("http://") or src.starts-with("https://") or src.starts-with("//") or src.starts-with("data:") {
    return [#metadata(src)<mdo-remote-skip>]
  }
  if probe { return [#metadata(src)<mdo-image>] }
  let path = if image-map != none { image-map.at(src, default: "") }
    else if src.starts-with("/") or docdir == "" { src } else { docdir + "/" + src }
  if path == "" { emph[\[missing image: #src\]] } else { image(path, alt: alt, ..args) }
}

// Elements produced by lib/markdown.typ's preprocess.
#let mdo-alert(attrs, body) = block(width: 100%, inset: 8pt, stroke: (left: 2pt + gray),
  [*#upper(attrs.at("kind", default: "note"))* \ #body])
#let mdo-task(attrs, body) = metadata((done: attrs.at("done", default: "false") == "true",
  owner: attrs.at("owner", default: ""), due: attrs.at("due", default: ""), body: body))
#let mdo-tasks(attrs, body) = {
  let kids = if body.func() == metadata { (body,) } else if body.has("children") { body.children } else { () }
  let tasks = kids.filter(c => c.func() == metadata).map(c => c.value)
  table(columns: 4, [*Task*], [*Owner*], [*Due*], [*Done*],
    ..tasks.map(t => (t.body, t.owner, t.due, if t.done [✓] else [–])).flatten())
}
#let mdo-keep(attrs, body) = block(sticky: true, body)

#if doctitle != "" { align(center, text(16pt, font: "Source Serif 4", doctitle)) }

#cmarker.render(
  if source == none { "" } else {
    preprocess(read(source), hard-breaks: inp("hard_breaks", default: "true") != "false", lang: lang)
  },
  h1-level: 1,
  set-document-title: false,
  smart-punctuation: false,
  math: mitex,
  html: (mdo-alert: mdo-alert, mdo-tasks: mdo-tasks, mdo-task: mdo-task, mdo-keep: mdo-keep),
  // terms: cmarker passes (term, description) pairs for <dl>.
  scope: (image: safe-image, terms: (..pairs) => terms(..pairs.pos().map(p => terms.item(..p)))),
)
```

Not covered by the skeleton, see `memo.typ`: `toc`, `h1_break`, `showname`, `header`, `watermark`, `logo`/`logo_height`, `client`/`subtitle`, localised labels per `lang`, Mermaid, table styling, footnotes.

## 10. Testing locally

With an installed app:

```bash
MDO_NO_OPEN=1 MDO_TEMPLATES=/path/to/dir markdown-office --template <name> note.md out.pdf
```

`/path/to/dir` contains `<name>.typ` directly. In this repository (after `npm ci && npm run assets`), the development layout `build/pipeline-dev/` matches the packaged app:

```bash
MDO_NO_OPEN=1 MDO_TEMPLATES=/path/to/dir bash build/pipeline-dev/pipeline/build.sh --template <name> note.md out.pdf
# or from pipeline/ with the layout given explicitly (as pipeline/tests/test-pdf.sh does):
MDO_PIPELINE_ROOT=build/pipeline-dev/pipeline MDO_SETS_DIR=build/pipeline-dev/sets \
  MDO_NO_OPEN=1 MDO_TEMPLATES=/path/to/dir bash pipeline/build.sh --template <name> note.md out.pdf
```

Check the result:

- exit code 0, `✓ … erzeugt (PDF/A-3b)` on stdout, no Typst warnings on stderr;
- `strings out.pdf | grep 'part>3</pdfaid:part'` (PDF/A-3);
- `mutool show out.pdf trailer/Root/Names/EmbeddedFiles` lists the note's file name; nothing with `--no-source`;
- `pdftotext -layout out.pdf -` shows the text of a note that uses every element from §5 (callout, task list with owner and due, table with intro, definition list, `==mark==`, page break, formula, a missing and a remote image).

Repository tests: `bash pipeline/tests/test-pdf.sh` (PDFs of `pipeline/tests/fixtures/`, including a user set from `fixtures/templates/`), `bash pipeline/tests/test-equivalence.sh` (memo against reference PDFs), `pipeline/tests/test-windows.ps1` (Windows), `npm test` (unit tests, including `tests/unit/templates-doc.test.ts`, which keeps §3 in sync with both scripts). To try an unpublished bundled set: `MDO_SET_<NAME>_DIR=<checkout> npm run assets` (archives the manifest's tag from the checkout).

## 11. Publishing a set

- One repository per set: `MarkdownOffice-set-<name>` (e.g. `jcmx9/MarkdownOffice-set-memo`), with `<name>.typ`, `<name>.css`, `<name>.header.md`, `LICENSE`, `README.md`, `README.en.md` (content-identical), `CHANGELOG.md` at the root.
- Versions are CalVer `YY.M.MICRO`; tags are `vYY.M.MICRO` (e.g. `v26.10.0`).
- Users install a set by copying `<name>.typ` into their templates folder.
- To bundle a set with the app, add it to `sets` in `scripts/pipeline-assets.json`:

  ```json
  { "name": "<name>", "repo": "<owner>/MarkdownOffice-set-<name>", "tag": "vYY.M.MICRO", "sha256": "<hash>" }
  ```

  `sha256` is the hash of GitHub's tag archive `https://github.com/<repo>/archive/refs/tags/<tag>.tar.gz` (`curl -sL <url> | shasum -a 256`). `npm run assets` downloads it, verifies the hash and extracts the archive's top-level folder into `sets/<name>/`. A tag must never be moved once pinned.

## 12. Requirements for the official catalog

The app will offer sets for one-click installation from a catalog. A set is listed as *official* or *reviewed* only if it meets the rules below; anything else can still be installed, but is shown as *not reviewed*. Why: catalog sets are installed with one click and their PDFs go to clients, so users must be able to trust them without reading the code.

**Fonts: licences clear and use free.** Every font a set uses must be under a free licence that allows use, embedding in PDFs and redistribution (e.g. SIL OFL 1.1, Apache 2.0), and the licence text must be shipped. Today a set can only use the bundled fonts (section 4), whose licences ship in `<pipeline>/licenses/`; a set that later brings its own fonts must add their licence files to its repo.

**Security review.** A set must not put users at risk. In particular:

- **No hard-coded links.** No fixed URLs in the `.typ`, `.css` or `.header.md` (no `link("https://…")`, no URLs in text): a link in a client PDF can lead to a dangerous site, and a reader cannot tell. Links come only from the user's own note.
- **Read only what the pipeline hands over:** `read()` only on `sys.inputs.source` and files under `mdo`; no other paths.
- **No obfuscated content** (encoded payloads, embedded files other than the source attachment).

These checks will run automatically in the catalog's CI before a set is listed; a reviewer confirms the result.

## 13. Checklist

- [ ] Name matches `^[a-z0-9_-]+$`; files are `<name>.typ`, `<name>.header.md`, `<name>.css`.
- [ ] `.typ` is self-contained; imports only `mdo + "/lib/…"` and `mdo + "/vendor/…"`.
- [ ] Every input is read with `sys.inputs.at(key, default: …)`; booleans compared as strings.
- [ ] Body rendered with `cmarker.render(preprocess(read(source), hard-breaks: …, lang: …), …)`, `smart-punctuation: false`, `math: mitex`.
- [ ] `html:` handles `mdo-alert`, `mdo-tasks`, `mdo-task`, `mdo-keep`.
- [ ] `scope: (image: …)` implements the probe/`images` contract; probe compiles without errors.
- [ ] `set document` has a non-empty title and a date (`datetime` or `auto`, never `none`).
- [ ] `pdf.attach` with the bare file name when `attach != ""`.
- [ ] Only bundled fonts, with the Noto fallbacks; greys via `luma()`.
- [ ] `<name>.header.md` contains `template: <name>` and every key the set honours.
- [ ] A test note with all elements renders with exit 0, no warnings, PDF/A-3, attachment present.
- [ ] Repo `MarkdownOffice-set-<name>`, CalVer tag `vYY.M.MICRO`; for bundling, manifest entry with the archive's SHA-256.
- [ ] For the catalog: only freely licensed fonts with licence texts; no hard-coded links; `read()` only on pipeline inputs (section 12).
