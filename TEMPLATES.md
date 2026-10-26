# Writing template sets

This guide is the complete contract between the Markdown Office pipeline and a template set. It is written so that a person or an AI can build a new set from scratch with no other context. Every statement is backed by `pipeline/build.sh` (macOS, Linux), `pipeline/convert.ps1` (Windows) and `pipeline/lib/markdown.typ`.

**Reference implementation:** the set `memo` ([jcmx9/MarkdownOffice-set-memo](https://github.com/jcmx9/MarkdownOffice-set-memo), file `memo.typ`). Copy from it when in doubt; it handles every input and every element described here.

## 1. What a set is

A set is a Typst template plus optional companion files, all sharing one name:

| File | Required | Read by | Purpose |
|------|----------|---------|---------|
| `<name>.typ` | yes | pipeline (Typst) | Builds the whole PDF: page layout, metadata, and the body via cmarker |
| `<name>.header.md` | no | editor (new notes, *Einfügen → Vorlage …*) | Front-matter template with every key the set understands |
| `<name>.css` | no | editor preview | Look of the preview and Present: tokens and `.mdo-*` rules (§8) |
| `<name>.preview.yaml` | no | editor preview | Head and foot blocks of the preview, filled from front matter and profile (§8) |

**Name rule:** `^[a-z0-9_-]+$` (lowercase letters, digits, `_`, `-`). Anything else is not treated as a set name. A value ending in `.typ` (case-insensitive) is a single template file instead.

**Layouts on disk:**

| Where | Layout | Notes |
|-------|--------|-------|
| User folder | `<MDO_TEMPLATES>/<name>.typ` | flat file, no sub-folder; default `~/Documents/Markdown Office/Vorlagen/` (Windows: the *Documents* folder + `\Markdown Office\Vorlagen`) |
| Bundled sets | `<MDO_SETS_DIR>/<name>/<name>.typ` | default `<pipeline>/../sets`; the app ships `<resources>/sets/memo/` |
| Set repository | `<name>.typ`, `<name>.css`, `<name>.preview.yaml`, `<name>.header.md` at the repo root | extracted as-is into `sets/<name>/` |

Keep the set in **one self-contained `.typ` file**. Only import from the pipeline (`mdo`) and the bundled store packages (`@preview/…`), see §4. Which sibling files are reachable depends on how the set was found (see the staging folder in §2): a set folder `<name>/<name>.typ` is staged whole, a single `.typ` found by name brings its folder (without `profiles` folders, hidden entries and links leading out), a `.typ` named as a path in the note is staged alone. Multi-file sets should therefore be folders `<name>/<name>.typ`. Set `raw-typst: false` in `cmarker.render` and map the page break with `html: (mdo-pagebreak: (attrs, body) => pagebreak(weak: true))` (§5): a note must not be able to run Typst code.

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
  --package-cache-path <pipeline>/vendor/packages --package-path <pipeline>/vendor/local-packages \
  --root <staging folder> <all --input …> --input probe=true
# 2. real build
typst compile <set>.typ <out.pdf> --font-path <pipeline>/fonts --ignore-system-fonts \
  --package-cache-path <pipeline>/vendor/packages --package-path <pipeline>/vendor/local-packages \
  --root <staging folder> --pdf-standard a-3b <all --input …> --input images=<map.json>
```

- `--root <staging folder>`: Typst reads only a fresh, private folder per export (removed afterwards) that holds exactly the files below. Every input path is an absolute path **inside that root** (`/note/…`, `/img/…`), readable with `read()`, `image()`, `json()`; anything else on the disk is unreachable. Treat paths as opaque strings and only split on `/`.
- Layout, as build.sh stages it (convert.ps1 the same):

| Staged path | Content |
|---|---|
| `/note/<name>.md` | the note (`source`, and the attachment) |
| `/img/<n><ext>` | the images the note visibly includes from its own folder or a subfolder (links resolved, no hidden folders), numbered from 1 with the source's extension (`/img/1.png`; the original name is not kept); SVG, PNG, JPEG, GIF, WebP by content; SVGs without external references |
| `/logo/<name>` | the logo |
| `/profile/<name>` | the profile YAML and the files next to it that the profile names as values |
| `/set/…` | a set folder without top-level `profiles` and `.git` (any letter case); for a single `.typ` found by name its folder, filtered (no `profiles` at any depth or letter case, no hidden entries, no links leading out); for a `.typ` named in the note only that file |
| `/mdo/lib`, `/mdo/vendor/…` | pipeline parts (`mdo`) |
| `/images.json` | the `images` map |

- **A set must not read files the note does not name.** Only the staged files above exist for it; do not build paths to anything else (a sibling of the note, a file in the home folder), they are not there.
- `SOURCE_DATE_EPOCH` is set to the source's modification time unless the caller set it, so `date: auto` in `set document` is reproducible.
- The **front matter is parsed by the scripts**, not by the template. Only the keys listed in §3 reach the template; unknown front-matter keys are not passed. A set that needs its own keys must parse `read(sys.inputs.source)` itself.

### Output name (decided by the script, not the template)

- Second positional argument → written exactly there (relative to the caller's working directory).
- Otherwise next to the source as `<base>.pdf`; with a recognised `date:` (`YYYY-MM-DD` or `D.M.YYYY`) as `<YYYY-MM-DD>_<base>.pdf`, unless `isodate_praefix: false`.

### Logo lookup (decided by the script)

Only when `logo:` is set and ends in `.svg`, `.png`, `.jpg` or `.jpeg`; remote values (`http(s)://`, `//`, `data:`) are refused. Relative paths only: `~`, `$VAR`, `%VAR%`, absolute paths and `..` out are refused with a notice. Looked up as the first existing of `<note folder or MDO_BASE_DIR>/`, the profile's folder, the template's folder (the set folder or the `.typ` file's folder); the hit must stay, links resolved, inside the folder it was found in (no hidden folders in the note's). Nothing found → `logo` input is empty, with a notice. The template never searches.

### Profiles (decided by the script)

A set that needs a sender (a letter) reads a profile: a YAML file plus the files next to it (signature, logo). The note names it with `profile:`; the wrapper finds it and the script stages it; the staging-root path (`/profile/<name>.yaml`) is the input `profile` (`""` without `profile:`). A set reads it with `yaml(sys.inputs.profile)` and further files relative to the profile's folder, e.g. `read(dir + "/" + data.signature)` with `dir` = the path up to the last `/`.

| Value of `profile:` | Looked up |
|---|---|
| a name (`a-z`, `0-9`, `_`, `-`), e.g. `kanzlei` | `<name>.yaml` 1. in `profiles/` in the note's folder (or `MDO_BASE_DIR`), 2. in `<set>/profiles/` in the templates folder (`~/Documents/Markdown Office/Vorlagen/` or `MDO_TEMPLATES`; the set's profiles, also for a bundled set – only when `template:` is a set name, not a `.typ` file), 3. in `profiles/` in the templates folder (shared by all sets), 4. in `profiles/` in the folder of the resolved set (its example profiles) – the first existing file wins |
| a path ending in `.yaml`/`.yml` | relative to the note, `~`, `$VAR`, `${VAR}` and `%VAR%` expanded; the file must lie in the note's folder (or `MDO_BASE_DIR`) or the templates folder, with no hidden folder (name starting with `.`) on the way; anything else is refused |

**Overriding values per note.** A set that prints profile values may let the note override single ones: `x-profile-<key>` in the front matter replaces the profile's `<key>` (for example `x-profile-phone`). The editor preview follows the same convention for `{profile.<key>}` (section 8). `signature` cannot be overridden: it names a file next to the profile.

A folder `Vorlagen/<set>/` that holds only `profiles/` (no `<set>.typ`) does not shadow the bundled set: a set is resolved by its `.typ` only.

A profile that is not found stops the export with exit code 1 and „Profil nicht gefunden: <name>“, listing the searched folders, and writes no PDF: a letter without a sender is worse than none. Only the profile and the files next to it (directly in the profile's folder, no subfolders) whose names the YAML holds as values are staged, so a signature (or logo) must sit **directly next to the profile**, not in a subfolder, and be named in the YAML. On Windows, network (UNC) and device paths are refused.

## 3. Inputs (`sys.inputs`)

All values are **strings**. Booleans are `"true"`/`"false"`. Empty front-matter values arrive as `""`. Always read with `sys.inputs.at(key, default: …)`.

| Key | Meaning | Format | Value when unset |
|-----|---------|--------|------------------|
| `filename` | File name of the output PDF | e.g. `2026-10-18_note.pdf` | always set |
| `title` | Fallback metadata title: source base name without extension | text | always set |
| `doctitle` | Front matter `title:` | text | `""` |
| `subtitle` | Front matter `subtitle:` | text | `""` |
| `toptitle` | Front matter `toptitle:` | text | `""` |
| `author` | Front matter `author:`; an inline list `[A, B]` becomes `A, B` | comma-separated text | `""` |
| `date` | Front matter `date:`, **raw** (not normalised) | `2026-10-13`, `13.10.2026` or free text | `""` |
| `lang` | Front matter `lang:` | `de`, `en`, `de-AT`, … (may carry a region: split it off before `text(lang:)`, see §9) | `de` |
| `toc` | Front matter `toc:` | `auto` / `true` / `false` | `auto` |
| `h1_break` | Front matter `h1_break:` | `auto` / `true` / `false` | `auto` |
| `showname` | Front matter `print_filename:` | `true` / `false` | `true` |
| `header` | Front matter `header:` (fixed header text) | text | `""` |
| `watermark` | Front matter `watermark:` | text | `""` |
| `hard_breaks` | Front matter `hard_breaks:`; `--hard-breaks` / `--soft-breaks` win | `true` / `false` | `true` |
| `logo` | Staged logo file (see §2) | staging-root path | `""` = no logo |
| `logo_height` | Front matter `logo-height:`, **raw**; the template validates it | e.g. `13mm`, `1.5cm`, `40pt` | `""` |
| `profile` | Staged sender profile (front matter `profile:`, see "Profiles" in §2); the files it names next to it (signature, logo) are readable | staging-root path, `/profile/<name>` | `""` = no `profile:` |
| `source` | The Markdown source to render | staging-root path, `/note/<name>.md` | always set |
| `attach` | File to embed as PDF attachment; `embed_source: false` or `--no-source` empties it | staging-root path (= `source`) | `""` = do not embed |
| `docdir` | Folder of the source (`/note`) in the staging root; the note's own folder is not reachable, relative images come through `images` | staging-root path | always set |
| `mdo` | Staged pipeline parts containing `lib/` and `vendor/` | staging-root path, `/mdo` | always set |
| `version` | Markdown Office version (`MDO_VERSION`) | e.g. `26.10.0` | `dev` |
| `pagebreak` | Form of the page break `preprocess` emits: `html` only for a set whose `.typ` mentions `mdo-pagebreak` (see §5) | `html` | absent (= raw-typst form) |
| `probe` | Set only in the probe run (§5.1) | `true` | absent |
| `images` | Set only in the real build: JSON file mapping each raw image source to its staged path (`/img/…`), `""` when the file is missing | path to a JSON object | absent |

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

Bundled Typst packages live in `<mdo>/vendor/` (versions pinned in `scripts/pipeline-assets.json`; licence texts, including bundled third-party notices such as cades' `NOTICE` and jogs' `license.html`, in `<pipeline>/licenses/packages/<name>/`):

| Package | Version | Import | Purpose |
|---------|---------|--------|---------|
| cmarker | 0.1.10 | `#import mdo + "/vendor/cmarker/lib.typ" as cmarker` | Markdown → Typst |
| mitex | 0.2.7 | `#import mdo + "/vendor/mitex/lib.typ": mitex` | LaTeX math for `$…$`, `$$…$$` (pass as `math: mitex`) |
| mmdr | 0.2.2 | `#import mdo + "/vendor/mmdr/lib.typ": mermaid-svg` | Mermaid → SVG, offline (memo: `show raw.where(lang: "mermaid", block: true)`) |
| cades | 0.3.1 | `#import "@preview/cades:0.3.1": qr-code` | QR codes (e.g. a vCard); store package |
| jogs | 0.2.4 | (imported by cades) | QuickJS runtime that cades runs on; store package |

Pipeline library: `#import mdo + "/lib/markdown.typ": preprocess`. Use `#let mdo = sys.inputs.at("mdo", default: ".")` and import cmarker, mitex and mmdr by path.

**Offline package store.** Packages marked "store package" are unpacked in Typst's package-cache layout, `<pipeline>/vendor/packages/preview/<name>/<version>/`, and both scripts pass `--package-cache-path <pipeline>/vendor/packages` (and `--package-path` to a folder that does not exist, so no `@local` packages of the machine leak in). That is how `#import "@preview/<name>:<version>"` resolves without network, including imports between packages (cades imports `@preview/jogs`). Your user package cache is never consulted.

**Only bundled packages.** The pipeline never downloads anything. Before Typst runs, the scripts scan for every `@preview/` occurrence (up to the next quote or whitespace): in the set's `.typ`, and for a set folder `<name>/<name>.typ` in every `.typ` of that folder and its subfolders (helper files count). Anything that is not an existing store folder `<name>/<version>`, including malformed specs (uppercase, `_`) and imports in **comments** (the scan does not parse Typst, so it errs on the safe side), stops the build with `Paket nicht mitgeliefert: @preview/<spec>` (exit 1). Do not write `@preview/` in comments except for real imports. The exact pinned version is required. A package your set needs must be added to the store (manifest entry with `"store": true`, SHA-256 and every licence file) first. As a second line of defence, both Typst calls run behind an unreachable proxy (`HTTPS_PROXY`/`HTTP_PROXY` = `http://127.0.0.1:9`, `NO_PROXY` empty), so a spec the scan cannot see (e.g. built by string concatenation) fails with a download error instead of reaching the network.

## 5. Preprocessing contract

The template must render the body as:

```typst
#cmarker.render(preprocess(read(source), hard-breaks: …, lang: …), html: (…), scope: (…), …)
```

`preprocess(src, hard-breaks: false, lang: "de")` (pass `hard-breaks: sys.inputs.hard_breaks != "false"`, `lang: sys.inputs.lang`) strips the front matter, normalises line endings and rewrites Markdown extensions. Fenced code blocks are never touched; `$$` blocks and inline code are skipped where noted. Steps, in order:

| Markdown | Becomes | The set must |
|----------|---------|--------------|
| `<!-- pagebreak -->`, `\newpage`, `\pagebreak`, `\clearpage` alone on a line | with input `pagebreak=html`: `<mdo-pagebreak></mdo-pagebreak>`; otherwise `<!--raw-typst #pagebreak(weak: true) -->` | `html: (mdo-pagebreak: (attrs, body) => pagebreak(weak: true))` with `raw-typst: false`; a set that never names `mdo-pagebreak` gets the raw-typst form (cmarker runs it while `raw-typst` is enabled, the default; a note's own `<!--raw-typst …-->` runs then too, so a set should switch it off). The closed form `<mdo-pagebreak></mdo-pagebreak>` is deliberate: cmarker reads an element not declared void like HTML, so `<mdo-pagebreak/>` would only open it and swallow the text after it |
| `"…"`, `'…'`, `geht's`, `--`, `---`, `...` | `„…“`/`‚…‘` (lang `de*`) or `“…”`/`‘…’`, `’`, `–`, `—`, `…` | pass `smart-punctuation: false` (otherwise cmarker re-quotes) |
| `> [!NOTE]` … (also `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`, German `INFO`, `TIPP`, `WICHTIG`, `HINWEIS`, `ACHTUNG`) | `<mdo-alert kind="note\|tip\|important\|warning\|caution">` + Markdown body + `</mdo-alert>` | handle `mdo-alert` |
| A list made **only** of tasks `- [ ] Task – Owner, bis Date` | `<mdo-tasks>` with one `<mdo-task done="true\|false" owner="…" due="…">` + Markdown body per item | handle `mdo-tasks` and `mdo-task` |
| Lines starting with a date like `18. Oktober 2026` | the dot escaped (`18\.`), each line kept | nothing |
| A paragraph of ≤ 4 lines directly before a table | wrapped in `<mdo-keep after="par\|block">` … `</mdo-keep>` | handle `mdo-keep` (memo: `block(sticky: true)`) |
| `Term` + next line `: Definition` | `<dl><dt>Term</dt><dd>` + Markdown + `</dd></dl>` | optionally override `terms` in `scope` (cmarker calls it with `(term, description)` arrays) |
| Single line breaks inside a paragraph (only with `hard-breaks: true`) | `\` at line end | nothing |
| `==text==` (not applied in inline code or `$…$` formulas) | `<mark>text</mark>` | nothing (cmarker → `highlight`; style with `set highlight`) |
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

The editor reads the header file of every set: Mod+N starts a note with `memo.header.md`, *Datei → Neu aus Vorlage …* with the header of the set picked in a dialog, and *Einfügen → Vorlage …* merges that header into an existing note (missing keys are appended with their default value and comment, existing keys keep their values, `template:`/`profile:` are set). Where it looks:

- The set is resolved like the pipeline does (§2): `<MDO_TEMPLATES>/<name>.typ`, `<MDO_TEMPLATES>/<name>/<name>.typ`, `<sets>/<name>/<name>.typ`; the first hit wins, so a user set shadows a bundled one.
- The header file is `<name>.header.md` in the folder of the winning `.typ`; for a flat user set that is `<MDO_TEMPLATES>/<name>.header.md`.
- Without a header file (or one that is not a regular file, not valid UTF-8 or larger than 64 KiB) the note starts with `---`, `template: <name>`, `---`.
- The first `# …` comment line of the header file, trimmed to 80 characters, is the set's hint in the picker; choose it so a user can tell the sets apart.
- A column-0 `profile:` key enables the profile choice: the picker lists the `*.yaml` names (matching the name rule) from `<MDO_TEMPLATES>/<name>/profiles/`, `<MDO_TEMPLATES>/profiles/` and `<set folder>/profiles/`, deduplicated and sorted (the same folders the pipeline searches, minus the note's own), and writes the chosen name into that line, keeping its alignment and comment.
- For the merge, every column-0 `key:` line is one key; the indented lines (or column-0 `- ` items) below it belong to it and are copied with it, so a list default such as `x-to:` arrives complete. Comment lines between the keys are not copied, so put each key's explanation as a trailing `# …` comment on its own line.

### Schema (`<name>.schema.yaml`)

The editor's *Bearbeiten → YAML prüfen …* and `markdown-office validate` check a note's front matter against two layers of rules:

1. `pipeline/lib/frontmatter.schema.yaml` ships with the app and describes the keys the pipeline reads itself (`title`, `date`, `toc`, `logo-height`, …).
2. An optional `<name>.schema.yaml` next to `<name>.typ` (same folder as `<name>.header.md`) describes the keys only the set reads (`x-…`) and may restrict a pipeline key. A rule of the set **replaces** the pipeline's rule of the same key.

Keys that no schema lists are always allowed, so a note may carry extra keys. Only column-0 keys are checked, like the scripts do; a nested value is only checked for its top-level shape. A set without a schema file is checked against the pipeline layer only; missing keys are still offered from `<name>.header.md`.

```yaml
# example.schema.yaml
schema: 1
keys:
  lang:          { type: enum, values: [de, en] }   # restricts the pipeline's `lang`
  logo-height:   { type: length, max: 25mm }
  x-to:          { type: lines, max: 6 }
  x-sign:        { type: bool }
  x-attachments: { type: list }
```

`schema: 1` and `keys:` are required; a key name matches `^[A-Za-z0-9_-]+$`. The types:

| Type | Accepts | Options |
|---|---|---|
| `text` | any text; a scalar or an inline list of scalars (joined, as `author`). A plain value that YAML 1.2 reads as another type (`true`, `~`, `01067`) needs quotes: an error for a set's key (Typst's `yaml()` would see a bool, nothing or a number), a warning for a pipeline key (the pipeline passes it on as text) | |
| `bool` | `true` or `false`. `yes/no/on/off/y/n` (any case) work for the pipeline's keys and are a warning, fixable; for a set's own key `y`/`n` are an error (Typst's `yaml()` reads them as text). `ja/nein/1/0` are errors, fixable | |
| `enum` | exactly one of the listed values; a case slip is an error, fixable to the listed spelling (only `Auto` for `toc`/`h1_break` is a warning: the pipeline lower-cases those two) | `values` (required) |
| `date` | `2026-10-20`, `20.10.2026` and similar | `empty: today` or `none`: what an empty value means for the set (documentation; an empty value is never a finding) |
| `length` | a number with unit `mm`, `cm`, `pt`, `in`, like `15mm`; `15 mm` is a warning, a missing or upper-case unit or a decimal comma an error (each fixable) | `min`, `max`, each with a unit; a value outside is a warning, fixable to the bound |
| `list` | inline `[A, B]` or a block list | |
| `lines` | a block list of text lines | `max`: number of lines |
| `file` | a file name | `ext`: allowed extensions, with the dot |
| `name` | `^[a-z0-9_-]+$` | |
| `lang` | a BCP-47 language code such as `de`, `en`, `pt-BR`. Typst's `text(lang:)` takes only the language: a set must split off the region (`de-AT` → `lang: "de"`, `region: "AT"`) or the export fails (§9) | |

A broken schema (unknown type, not YAML, larger than 64 KiB) never stops the editor: users get a neutral notice and validation falls back to the pipeline layer. Test your schema with `markdown-office validate` on a note made from your header.

## 7. PDF requirements

Every set must produce a valid **PDF/A-3b** with the source attached, like `memo`:

| Requirement | Done by the pipeline | Done by the template |
|-------------|----------------------|----------------------|
| PDF/A-3b | `--pdf-standard a-3b`; Typst embeds all fonts and refuses non-conforming output | Set a non-empty `title` in `set document` (PDF/A requires it). Never set `date: none` (PDF/A requires a date): use a parsed `date` or `auto` |
| Reproducible date | `SOURCE_DATE_EPOCH` = source mtime | Parse `date` (ISO or `D.M.YYYY`, validate month/day) into `datetime`, else `auto` |
| Embedded source | Passes `attach` (empty with `--no-source` / `embed_source: false`) | If `attach != ""`: `pdf.attach("/" + attach.split("/").last(), read(attach, encoding: none), relationship: "source", mime-type: "text/markdown")`. Use only the file name as attachment name, never the full path (it would leak the local user name) |
| Metadata | — | memo: `title` = `doctitle` or `title`; `author` = `author` split at `,`; `description` = `doctitle`; `keywords` = `toptitle` + `"Markdown Office " + version` |
| Colours | — | Use `luma()` for greys (stored as single-channel grey); Typst 0.15 cannot embed CMYK in PDF/A |

## 8. Editor preview: `<name>.css` and `<name>.preview.yaml`

The editor preview and Present mode take their look from the note's set. Two optional files next to `<name>.typ` describe it; neither has any influence on the PDF.

| File | Describes |
|------|-----------|
| `<name>.css` | font, sizes, measure, colours and the look of the blocks (print units) |
| `<name>.preview.yaml` | the blocks above (`head`) and below (`foot`) the text, filled from the front matter and the profile |

Both are UTF-8 and at most 64 KiB. A file that is missing, too large or broken never stops the editor; the fallbacks are listed at the end of this section. Which set a note uses follows `template:` (no key: `memo`); a `.typ` path or a set that is not installed gets the built-in memo look.

### 8.1 `<name>.css`

**Scope.** The app puts every rule under `#editor[data-mdo-set="<name>"]`, so two tabs with different sets never mix and a set cannot style anything outside the editor (the editor also clips with `contain: paint`). Write plain rules; do not write the scope yourself.

**What survives the sanitiser.** The file is rebuilt from the rules that pass; everything else is dropped and logged:

- Only rules whose every selector starts with `.mdo-` followed by at least one of `a-z`, `0-9`, `-` stay. One foreign selector in a list drops the whole rule.
- All at-rules are dropped (`@import`, `@font-face`, `@media`, `@supports`, …). Nested rules are dropped.
- `{`, `}`, `\` or `<` in a selector or value drop the rule or the declaration (CSS escapes could spell `url(`).
- A declaration containing `url(`, `image(`, `image-set(`, `element(`, `expression(` or `src(` (case-insensitive, whitespace ignored) is dropped, so a set can load nothing. Fonts and pictures come from the app, not from CSS.
- `!important` is stripped (the app's own `!important`, e.g. Present's `max-width: 70ch`, always wins).
- A declaration with an unbalanced string or bracket, an invalid property name or an empty value is dropped.
- `--mdo-scale`, `--mdo-space-advance`, `--mdo-list-lead`, `--mdo-list-extra`, `--mdo-list-hang` (values the app writes itself) and `z-index` are dropped. An `--mdo-*-opsz` with a unit (`11pt`) is dropped too: the axis takes a plain number. `position` may be `static`, `relative` or `absolute`, never `fixed` or `sticky`.
- `content` may only decorate: `none`, `normal` or one string without letters or digits (`"▪ "`, `"– "`). A set cannot write text into the preview that is not in the note or the profile; `attr()`, `counter()` and words are dropped.
- **The note's text stays visible.** A rule counts as a block rule when every selector's last part (outside parentheses) names a head or foot block class (`.mdo-titleblock`, `.mdo-footblock`, `.mdo-tb-*`) and no `~` or `+` leads there; block rules may use every property above. All other rules may reach the note's own lines and keep only typography and spacing: `font` and `font-*`, `line-height`, `letter-spacing`, `word-spacing`, `text-align`, `text-indent`, `text-transform`, `text-decoration*`, `text-underline-offset`, `hyphens`, `tab-size`, `color`, `background`, `background-color`, `margin*`, `padding*`, `border*`, `min-height` and the `--mdo-*` tokens. On them `color` and the `--mdo-*-color` tokens must be opaque (no `transparent`, no alpha, no `color-mix()`), and `font-size`, the `font` size and the `--mdo-*-size` tokens must not be zero. A colour equal to the background or a tiny size still hides text; these limits remove the direct levers, not every possibility.

**Print units and zoom.** Write sizes in print units (`11pt`, `165mm`). The sanitiser multiplies every absolute length (`px pt pc mm cm in Q`, outside strings) by the app's zoom factor `--mdo-scale`. At 100 % zoom a set's `11pt` is 11 CSS pt and `165mm` is 165 CSS mm, i.e. the paper size; the zoom and the Present factor scale all print sizes together by the same factor. Relative units (`em`, `ch`, unitless line heights) follow on their own. Present keeps its `70ch` measure.

**Tokens.** The app declares the tokens on the `.cm-editor` element, which also carries the class `.mdo-preview`. A set changes them with a rule on `.mdo-preview`:

```css
.mdo-preview {
  --mdo-body-font: var(--mdo-font-serif);
  --mdo-body-size: 11pt;
  --mdo-measure: 165mm;
}
```

Tokens that refer to other tokens (`--mdo-hN-font`, `--mdo-hN-color`, `--mdo-table-font`) are resolved on `.mdo-preview` itself, so override them there too, in the same rule; a rule on a deeper element would not reach them. The defaults are memo's values, except for four tokens that memo declares itself in memo.css: `--mdo-word-spacing` (default `0`, memo `-0.045em`), `--mdo-numeric` and `--mdo-table-numeric` (default `normal`, memo `oldstyle-nums` / `lining-nums tabular-nums`) and `--mdo-runt-cost` (default `100%`, Typst's own, memo `200%`):

| Token | Default | Meaning |
|-------|---------|---------|
| `--mdo-body-font` | `var(--mdo-font-sans)` | body font family |
| `--mdo-body-size` | `10pt` | body size (zoomed) |
| `--mdo-body-weight` | `380` | body weight |
| `--mdo-bold-weight` | `560` | weight of `**bold**` |
| `--mdo-line-height` | `1.5` | line height |
| `--mdo-align` | `justify` | text alignment of paragraphs |
| `--mdo-hyphenate` | `auto` | hyphenation: `auto` follows `--mdo-align` like Typst's `text.hyphenate: auto` (justified hyphenates), `true` / `false` force it |
| `--mdo-hyphenation-cost` | `100%` | Typst's `par.costs` hyphenation in percent; used only for justified paragraphs |
| `--mdo-runt-cost` | `100%` | Typst's `par.costs` runt (short last line) in percent; used only for justified paragraphs. The theme's default is `100%` (Typst's); memo.typ uses `200%` and declares it in memo.css |
| `--mdo-par-gap` | `1.1em` | the gap a blank line makes between paragraphs |
| `--mdo-measure` | `145mm` | width of the text block |
| `--mdo-heading-font` | `var(--mdo-font-serif)` | heading font family |
| `--mdo-heading-align` | `left` | heading alignment |
| `--mdo-h1-font`, `--mdo-h2-font`, `--mdo-h3-font` | `var(--mdo-heading-font)` | font per level |
| `--mdo-h1-size`, `--mdo-h2-size`, `--mdo-h3-size` | `14pt`, `12pt`, `10pt` | size per level |
| `--mdo-h1-weight`, `--mdo-h2-weight`, `--mdo-h3-weight` | `470`, `470`, `380` | weight per level |
| `--mdo-h1-color`, `--mdo-h2-color`, `--mdo-h3-color` | `var(--mdo-heading)` | colour per level |
| `--mdo-h1-rule` | `var(--mdo-hairline)` | colour of the line under H1 |
| `--mdo-h3-decoration` | `underline` | text decoration of H3 |
| `--mdo-body-opsz`, `--mdo-h1-opsz`, `--mdo-h2-opsz`, `--mdo-h3-opsz` | `10`, `14`, `12`, `10` | optical size (`opsz` axis) of the serif variable fonts; unitless, in pt; derived, see below |
| `--mdo-table-font` | `var(--mdo-body-font)` | table font family |
| `--mdo-table-size` | `9pt` | table size |
| `--mdo-table-weight` | `500` | table weight |
| `--mdo-table-head-weight` | `680` | weight of the table head row |
| `--mdo-word-spacing` | `0` | extra word spacing, now only for the paragraph with the cursor and for the fallback (paragraphs the app does not set itself); see below |
| `--mdo-numeric` | `normal` | figure style of body text, lists, quotes and headings: a CSS `font-variant-numeric` value (`oldstyle-nums`, `lining-nums`, `tabular-nums`, `proportional-nums`, combinable). Code stays `normal`. Not memo's value (`oldstyle-nums`), see below |
| `--mdo-table-numeric` | `normal` | the same for rendered tables (memo: `lining-nums tabular-nums`) |
| `--mdo-list-indent` | `1.12em` | hanging indent of list items: the bullet or task box and the space after it fill it, continuation lines start at it; see *Lists* below |
| `--mdo-table-tracking` | `-0.02em` | letter spacing in the rendered table |
| `--mdo-code-size` | `9pt` | size in code blocks (inline code stays `0.9em`) |
| `--mdo-mark-bg` | `#fbeab0` | background of `==highlight==` (`.mdo-hl`); the default (memo's). A set that changes Typst's `highlight` fill should change this too. Only the background, the text keeps its colour |
| `--mdo-titleblock-align` | `center` | alignment of the head block |

**Optical size.** Typst sets a variable font's `opsz` axis to the font size in pt, which changes glyph widths and so the line breaks. The preview must do the same, independent of the zoom. You normally write nothing: when a rule sets `--mdo-body-size`, `--mdo-h1-size`, `--mdo-h2-size` or `--mdo-h3-size` to a plain pt length (`11pt`, `10.5pt`), the app adds the matching `--mdo-<role>-opsz` with that number (`11`, `10.5`; not zoomed). Write the opsz token yourself in the same rule to override it (unitless: `--mdo-body-opsz: 11`). If a rule sets a size twice, the last kept declaration counts, as in the browser. Sizes in other units (`em`, `px`, `mm`, `var()`, `calc()`) or no size token derive nothing, and that role keeps the default above.

**Weights.** The defaults are the weights Typst prints for memo (`memo.typ`: text 380, bold 380 + 180, headings 470, table head 500 + 180), not the nominal 400/600. The advances of a variable font change with its weight, so only the real weights break lines like the PDF. Set the weights your `.typ` uses.

**Space advance.** The preview wraps with the space before a break counted, so the text block is one space wider than `--mdo-measure`, and a list marker plus its space fill `--mdo-list-indent`. The app measures that space in your body font (with `--mdo-word-spacing`) when the set is shown and its fonts have loaded, and sets `--mdo-space-advance` on the editor; you write nothing (a set's own value is dropped). Set the body font and word spacing through the tokens; rules on `.cm-content` or `.cm-line` are measured too.

**Lists.** Bullets and task boxes sit in a 0.72em slot; slot plus space fill `--mdo-list-indent`, and the wrapped lines of the item start at the same place, inside quotes and alerts too. Ordered numbers sit in a right-aligned slot of the same width that grows by `1ch` for every digit beyond one of the list's widest number, so the items of one list share one text start (Typst's enum puts the text after the widest number plus its own `body-indent`, so ordered lists can start a little differently from the PDF). Nested items keep their source indent on the first line, and their wrapped lines hang under their own text (the source indent counts in space advances; an indent with tabs hangs at the indent only). On a justified line the space after the marker stretches with the others, so the first line's text can start slightly right of the indent; the breaks are not affected.

**Paragraphs.** The app sets rendered paragraphs the way Typst 0.15.0 does, so the preview breaks lines where the PDF does: hyphenation with Typst's German and English patterns (the language is the front matter's `lang:`: `de` German, `en` English, a missing `lang:` counts as `de`, other languages are not hyphenated), the best breaks for the whole paragraph in justified text (Typst's optimized line breaking with its costs), and word spaces shrunk (down to two thirds) or stretched per line so justified lines fill the measure. Hyphenated breaks show a hyphen. What is set: body paragraphs, list items, and paragraphs in quotes and alerts. What is not: headings, tables, code and other raw blocks stay as they were. Tokens: `--mdo-align` (justified paragraphs get the optimal breaks; others get the first-fit breaks of ragged text), `--mdo-hyphenate`, `--mdo-hyphenation-cost`, `--mdo-runt-cost`. Limits:

- One source line is one paragraph. A Markdown paragraph hard-wrapped over several source lines is set per line, not as a whole; write a paragraph as one line to get the PDF's breaks.
- No hanging punctuation (Typst's `overhang`): a line that ends in a comma or hyphen is not allowed to protrude.
- The paragraph with the cursor or a selection keeps the browser's wrapping until the cursor leaves it, so it may break differently while you edit it.
- Code, tables and other raw blocks are not set; while fonts are still loading, or when a paragraph cannot be measured, the browser wraps it as before.

**Figure style.** Figure styles and widths differ in advance ("1627" in Source Sans is 19.72 pt old-style at the font's default width, as the PDF prints it for memo; with `proportional-nums` added it is 18.04 pt), so the preview must match the PDF's for the same line breaks. `--mdo-numeric` and `--mdo-table-numeric` take a `font-variant-numeric` value. Typst's `number-width: auto` (its default) keeps the font's default width, so it adds no width word. `--mdo-numeric` and `--mdo-table-numeric` are two of the four tokens whose default is not memo's value (see the list above the table): they default to `normal`, so a set that does not declare them keeps the font's own figures. Declare them when the `.typ` sets a number type.

**Word spacing.** `--mdo-word-spacing` is an offset for the paragraphs the app does not set itself: the paragraph with the cursor and the fallback above. It is no longer needed for the line breaks of the other paragraphs, where the app shrinks and stretches the spaces itself. It is one of the four tokens whose default is not memo's value (see the list above the table): it is `0`, so a set that does not declare it gets no offset. Use it for justified sets only; left-aligned sets leave it at `0`.

Colour tokens such as `--mdo-heading`, `--mdo-hairline` and the families `--mdo-font-sans`, `--mdo-font-serif`, `--mdo-font-code` belong to the app's theme (light and dark); use them with `var()` so the set follows the theme.

**Classes.** Besides tokens a set may style the blocks of `.preview.yaml`: `.mdo-titleblock` (the head), `.mdo-footblock` (the foot), each element as `.mdo-tb-<class>`, its label as `.mdo-tb-label`, the single lines of `lines:` as `.mdo-tb-line`. Declarations such as `margin`, `text-align`, `font-size` and `position: relative|absolute` (to let a signature overlap lines) are fine.

A drawn Mermaid diagram (§8.2, `mermaid:`) sits in a `.mdo-diagram` block. It is not one of the head and foot blocks: a rule on `.mdo-diagram` is a rule that may reach the note's text, so it keeps only the typography and spacing properties of the list above (`margin*`, `padding*`, `background*`, `border*`, `font*`, `color`, `min-height`, …), nothing else. The app's own spacing is 1.4em above and below; the diagram is centred and scaled to the block's content box, so horizontal `padding` narrows the room it is fitted into. The SVG inside is not part of the set-CSS contract: it is drawn as the PDF draws it, and rules aimed at it are unsupported.

A display formula (a paragraph that is exactly one `$$…$$`, cursor elsewhere) sits in a `.mdo-math` block. Like `.mdo-diagram` it is not a head or foot block, so a rule on it keeps only the typography and spacing properties above; use it for spacing (`margin*`, `padding*`). Its default spacing is the line box a text line would have (half the leading above and below, following `--mdo-line-height`), and the blank lines around the `$$` block add `--mdo-par-gap`, as between two paragraphs, which is what Typst's `par.spacing` around a block equation looks like. The SVG inside is not part of the set-CSS contract.

**Formulas.** `$…$` and `$$…$$` are set by the bundled Typst with the bundled mitex, the same call your `.typ` makes when it passes `math: mitex` to cmarker, in Typst's math font New Computer Modern Math. The preview sizes a formula in `em` of the text around it (body, heading, table cell) and draws it in that text's colour. There is no key to declare: neither `<name>.css` nor `<name>.preview.yaml` describes formulas, and a set that changes the math font or colour in its `.typ` (`show math.equation: set text(…)`) is not followed by the preview. The formula with the cursor, the code view and a formula whose result is still pending show the source; a formula the PDF cannot build (an unknown LaTeX command such as `\ce`) keeps its source, underlined, with mitex's message as a tooltip. Known ways from a formula into Typst code are refused in the preview and flagged the same way: the mitex commands `\iftypst`, `\includegraphics`, `\hspace`, `\vspace` and `\raisebox`, an unescaped `#`, a `\label` whose argument is more than a plain name (mitex 0.2.7 copies it raw in text mode) and a colour model other than letters (`\color[rgb]{…}` is fine); the preview's batch program also checks mitex's output for Typst code it does not expect. The list is not exhaustive: the boundary is the sandbox (a temp dir as Typst's root with only mitex and the batch, no packages, no network, a timeout and a memory limit). Known differences from the PDF:

- An inline formula never breaks across lines in the preview; Typst may break a long one at a relation or operator.
- A `$$…$$` written inside a line of text (`text $$x$$ text`) is shown in display style within that line; Typst starts a new paragraph before and after it.
- `\color{black}` follows the text colour in the preview (the app draws black glyphs in the context colour, so formulas stay readable in the dark theme); the PDF prints black.
- Macros with parameters (`\newcommand{\f}[1]{…#1…}`, `\def\f#1{…}`) are refused in the preview (their `#1` is an unescaped `#`) and flagged; the PDF builds them. Macros without parameters render.
- A bare URL directly before a formula (`http://example.com$a$`): the editor reads the `$…$` as part of the link, the PDF as a formula. Put a space or `<…>` around the URL.

**Fonts.** Only the bundled families are available ("mdo Sans", "mdo Serif", "mdo Code", see section 4 and `src/renderer/ui/fonts.ts`); name them through the tokens or `var(--mdo-font-*)`. `@font-face` is dropped.

### 8.2 `<name>.preview.yaml`

```yaml
preview: 1
head:                       # replaces the front matter in the preview (header hidden) and in Present
  - class: sender           # rendered as .mdo-tb-sender
    parts: ["{profile.name}", "{profile.street}", "{profile.zip} {profile.city}"]
    sep: " · "
  - class: address
    lines: "{x-to}"         # a list value: one line each; a string is split at newlines
  - class: date
    text: "{date}"          # ISO or D.M.YYYY, long form by lang
    today: true             # empty: today
  - class: subject
    text: "{x-subject}"
foot:                       # after the last line of the text
  - class: closing
    text: "{x-closing}"
  - class: signature
    image: "{profile.signature}"
    width: "{profile.signature-width|40mm}"
    when: ["{x-closing}", "{x-sign}"]
  - class: attachments
    label: { de: "Anlagen:", en: "Enclosures:" }
    lines: "{x-attachments}"
    when: "{x-closing}"
```

The file is a map with `preview: 1`, the lists `head` and `foot` and the maps `nobreak` and `mermaid` (all optional, see below). Any other top-level key, a missing or different `preview:` or a wrong type anywhere makes the whole file invalid. It is read as YAML 1.2 core, so `no`, `nein` and `yes` are ordinary text.

Keys of an element:

- `class:` (required, `a-z`, `0-9`, `-`): the element becomes `mdo-tb-<class>`.
- Exactly one of `text:`, `parts:`, `lines:`, `image:`.
- `text:` a string; `parts:` a list of strings joined with `sep:` (default one space, empty parts are dropped first, so no dangling separators); `lines:` is a string (a YAML list makes the file invalid): if it is exactly one placeholder whose value is a list (e.g. `"{x-to}"`), each list item becomes a line; otherwise the resolved string is split at newlines.
- `image:` only `"{profile.signature}"` (the one picture the app reads). `width:` sets its width, e.g. `"{profile.signature-width|40mm}"`; a number with `mm`, `pt`, `cm` or `in` (else no width), scaled with the zoom.
- `label:` a text shown before the content, either a string or a map by language (`de`, `en`, …): the note's `lang` without region, then `de`, then the first entry.
- `today:` `true` makes an empty or missing `{date}` today's date (as the PDF does); without it an empty date stays empty.
- `when:` one placeholder or a list; all must hold. A value holds when it is not empty and not `false`, `False` or `FALSE`. Other words (`no`, `nein`, `0`) count as present. A string with several placeholders holds only if all of them hold; a `when` without any placeholder always holds.

**`nobreak:` (optional).** Lists the places where the PDF must not break a line (memo.typ turns the space into a no-break space), so the preview does not break there either:

```yaml
nobreak:
  words: ["z. B.", "u. a.", "i. d. R."]   # literal phrases, matched as written
  units: [mm, kg, "%", "€"]               # a digit, a space and one of these stays together
```

Both are lists of plain strings, never regular expressions. A `units` entry made of letters must end at a word boundary (`m` does not match "5 Meter"); symbols (`%`, `€`, `$`) need none. At most 200 entries per list and 40 characters per entry; more are cut, longer entries dropped. A missing key means nothing is kept together. A set without `.preview.yaml`, with a broken one, or a note whose `template:` is a `.typ` path gets memo's lists. The note's text is not changed; the preview only forbids the line break. Code (inline and blocks), tables and the front matter are left out.

**`mermaid:` (optional).** The arguments your `.typ` passes to mmdr's `mermaid-svg` (and the size rule around it), so the preview draws a diagram with the same plugin and the same values as the PDF:

```yaml
mermaid:
  base-theme: modern            # default "modern"; "default" is Mermaid's own theme
  theme: { primary_color: "#f4f2ee", font_family: SourceSans3VF }   # mmdr theme fields, strings
  layout: { node_spacing: 25, rank_spacing: 35 }                     # numbers
  max-height: 12cm              # optional: the largest height a diagram is scaled to (mm, cm, pt, in)
  font-weight: 500              # optional: written before every font-family in the SVG (1-1000)
```

Every key is optional. The preview scales a diagram by the same rule as memo.typ, `natural size × min(1, text width / natural width, max-height / natural height)`; take `max-height` from your `.typ`'s size rule (a length in `mm`, `cm`, `pt` or `in`; a relative one makes the whole file invalid). If your `.typ` caps only the width, leave `max-height` out: the preview then caps the width only, like your PDF. Without `theme`/`layout` mmdr uses its base theme alone, without `font-weight` the SVG is left as drawn. `theme` and `layout` take at most 64 entries (names `a-z`, `0-9`, `_`; theme values are strings up to 64 characters, layout values numbers), an unknown key or a wrong type makes the whole file invalid. The `font_family` of the theme is mapped to the bundled families (a name containing `SourceSerif` becomes the serif font, one containing `SourceCode` the code font, anything else the sans font), because the preview cannot load others.

Which blocks are drawn: fenced ` ```mermaid ` blocks on the top level of the note, like tables. A block inside a list or a quote stays code, as does the block that holds the cursor or a selection, every block in the code view, and a diagram that cannot be drawn (a notice under it says so). The note's text never changes. Both Preview and Present draw diagrams. A valid file without `mermaid:` means the set draws no diagrams, every block stays code; a set without `.preview.yaml`, with a broken one, or a note whose `template:` is a `.typ` path gets memo's options. The SVG is not shown as markup: the app rebuilds it from the elements mmdr emits and drops links, scripts, `foreignObject`, images, `use`, `style` elements, `href`, `on*`, `class` and `style` attributes, so a `click` line in a note never becomes a link.

Placeholders: `{key}` is the note's front-matter value, `{profile.key}` a value of the profile the note names (section 2, *Profiles*); `{key|default}` uses `default` when the value is empty. An unknown key is empty. Values are source text (`zip: 01067` stays `01067`); a list is joined with `, ` inside a text.

Omission: an element with at least one placeholder whose placeholders are all empty is left out. An element made of literal text only is always shown. All text is inserted as text, never as HTML.

**Where the blocks appear.** The head replaces the front matter in the preview with the header hidden and in Present; the foot sits after the text under the same conditions. Neither appears in the code view. The foot starts one paragraph gap (`--mdo-par-gap`, the height of a blank line) below the last line of text, as a `parbreak()` before the closing does in the PDF: the app puts that gap at the top of `.mdo-footblock` (`.mdo-footblock-gap`) and collapses blank lines at the end of the note, so the gap is the same whether the note ends with a line break or not. Measure your foot's spacing from there.

### 8.3 Profile access

Only the profile keys that `.preview.yaml` names (`{profile.key}`) are read into the preview; other keys of the file never leave the app's main process. The note may override a value with `x-profile-<key>` (section 2). The signature is a bare `.svg` file name next to the profile, at most 256 KiB, not a symbolic link, not dot-prefixed (hidden), whose content starts with `<svg` or `<?xml`; otherwise there is no signature picture. `signature` cannot be overridden by the note.

### 8.4 Fallbacks

| Case | Result |
|------|--------|
| no `<name>.css` | built-in memo look |
| no `<name>.preview.yaml` | memo's title block (toptitle, title, subtitle, date and author) and memo's Mermaid options (diagrams are drawn) |
| invalid `<name>.preview.yaml` | memo's title block, memo's `nobreak:` lists and memo's Mermaid options, and one notice per set per session |
| valid `<name>.preview.yaml` without `mermaid:` | no diagrams drawn, every Mermaid block stays code |
| `template:` is a `.typ` path or an unknown set | built-in memo look, blocks and Mermaid options |

Test a set in the editor by copying it into the templates folder and opening a note with `template: <name>`. The unit tests in `tests/unit/` and the fixture sets `tests/fixtures/sets/` show working and malicious examples. Never rely on `.css` or `.preview.yaml` for PDF output.

### 8.5 Making the preview match the PDF, step by step

The aim: the same font sizes, the same text width and, as far as the browser allows, the same line breaks as the PDF. Every value comes from your `.typ` or from a PDF it produced; nothing is guessed. Work through the list in this order (the later values depend on the earlier ones) and write a comment above each token saying where its value comes from, as `memo.css` and `din5008a.css` do.

You need: a test note that uses every element of your set (paragraphs long enough to wrap, a list with a long item, a table, headings), its PDF, and a way to read positions from the PDF. `pdftotext -bbox note.pdf out.html` (poppler) or `mutool draw -F stext note.pdf` (MuPDF) print each word with its box in pt; baselines are the boxes' bottom edges minus the descent, but differences between two lines of the same font are exact either way.

| # | Token(s) | Where the value comes from | memo | din5008a |
|---|----------|----------------------------|------|----------|
| 1 | `--mdo-measure` | paper width minus the left and right page margins of `#set page(margin: …)` | 210 − 35 − 30 = `145mm` | 210 − 25 − 20 = `165mm` |
| 2 | `--mdo-body-font`, `--mdo-body-size` | `#set text(font:, size:)`; the family as one of `var(--mdo-font-sans\|serif\|code)` (§4), the size in `pt` | sans, `10pt` | serif, `11pt` |
| 3 | `--mdo-body-weight`, `--mdo-bold-weight` | `#set text(weight:)` (Typst's default is 400); bold is that weight **plus** `strong(delta:)` (Typst's default delta is 300, so an unset delta gives 700) | 380, 380 + 180 = 560 | 400, `show strong: text(weight: 600)` = 600 |
| 4 | `--mdo-line-height` | measure the baseline-to-baseline distance of two lines of one paragraph in the PDF and divide by the body size, or write it in `pt`. Typst's `par(leading:)` is the gap between the lines (from the cap height of one to the baseline of the next, by default), not a CSS line height: pitch = leading + cap height of the font | 0.85em → 15.1pt pitch ≈ `1.5` | 5.5pt + 7.37pt = `12.87pt` |
| 5 | `--mdo-align`, `--mdo-word-spacing` | `#set par(justify: true)` → `justify`; `justify: false` → `left`. The word spacing only matters for the cursor paragraph and the fallback (see *Word spacing* in §8.1): memo keeps `-0.045em`, a left-aligned set leaves it at `0` | justify, `-0.045em` | left, — |
| 5a | `--mdo-hyphenate` | `#set text(hyphenate:)`: `auto` (Typst's default) hyphenates justified text only and is the token's default; write `true` or `false` only when the `.typ` forces it. The language comes from `lang:`, nothing to set | `auto` (memo.typ: `true`, same result as justified) | `auto` (no hyphenation) |
| 5b | `--mdo-hyphenation-cost`, `--mdo-runt-cost` | `#set par(costs: (hyphenation: …, runt: …))`, in percent; Typst's defaults are 100 % each, and the tokens' defaults are the same, so write them only where the `.typ` differs. Only justified paragraphs use them | runt `200%` (`memo.typ`: `costs: (orphan: 200%, widow: 200%, runt: 200%)`), hyphenation default | defaults |
| 5c | `--mdo-numeric`, `--mdo-table-numeric` | `#set text(number-type:, number-width:)` (and the same inside `show table: set text(…)`): `old-style` → `oldstyle-nums`, `lining` → `lining-nums`, `number-width: "tabular"` → `tabular-nums`, `"proportional"` → `proportional-nums`; `number-width: auto` (Typst's default) adds no width word, so write `proportional-nums` only when the `.typ` says "proportional" and `tabular-nums` only for "tabular"; write both words when both are set. Not set → `normal` | `oldstyle-nums`; tables `lining-nums tabular-nums` | `normal`, `normal` |
| 6 | `--mdo-par-gap` | the extra distance a paragraph break adds: (baseline distance across a paragraph break) − (line pitch from row 4), measured in the PDF | `1.1em` | 23.87 − 12.87 = `11pt` |
| 7 | `--mdo-hN-font`, `--mdo-hN-size`, `--mdo-hN-weight`, `--mdo-h1-rule`, `--mdo-h3-decoration` | your `show heading` rules per level; the weight as in row 3 (a heading inside `strong` adds the delta) | serif 14/12/10pt, 470/470/380 | serif 11pt, 600 |
| 8 | `--mdo-list-indent` | the distance from the text block's left edge to the item text, in em of the body size: measure the x of an item's first word minus the x of a paragraph's first word in the PDF, divide by the size. In the `.typ` it is `list(indent:)` + the marker's width + `list(body-indent:)` | marker 0.72em + 0.4em = `1.12em` | 8.84pt / 11pt = `0.804em` |
| 9 | `--mdo-table-font`, `--mdo-table-size`, `--mdo-table-weight`, `--mdo-table-tracking`, `--mdo-table-head-weight` | your `show table: set text(…)`; the head weight is the table weight plus the strong delta when the head cells are `strong` (memo: `show table.cell.where(y: 0): strong`) | sans 9pt, 500, `-0.02em`, 500 + 180 = 680 | code 10pt, 400, `0`, 600 |
| 10 | `--mdo-code-size` | `show raw.where(block: true): set text(size:)` | `9pt` | `10pt` |
| 11 | `nobreak:` in `<name>.preview.yaml` | the phrases and units your `.typ` joins with a no-break space (`show "z. B.": [z.~B.]`, a regex for number + unit); copy them as plain strings (§8.2). No such rules: leave the key out | 10 phrases, 19 units | — |
| 11a | `mermaid:` in `<name>.preview.yaml` | the arguments of your `.typ`'s `mermaid-svg` call and its size rule: `base-theme`, the `theme` dict (mmdr field names), the `layout` dict, the `max-height` of the `box`/`scale` (none if it caps only the width), and a `font-weight` only if the `.typ` writes one into the SVG (§8.2). No Mermaid rule: leave the key out | memo.typ's theme, layout `node_spacing: 25, rank_spacing: 35`, `12cm`, weight 500 | see the set's `din5008a.preview.yaml` |
| 12 | `head:`, `foot:` in `<name>.preview.yaml`, block classes in `<name>.css` | what the `.typ` prints from the front matter and the profile above and below the body, in the same order; distances measured in the PDF become `margin-*`/`padding-*` on the `.mdo-tb-*` classes | title block | letter head, closing, signature, enclosures |

Formulas need no row either: the preview sets them with the PDF's own Typst and mitex in New Computer Modern Math (§8.1, *Formulas*); `.mdo-math` only takes spacing.

The optical size needs no row: the app derives `--mdo-*-opsz` from the pt sizes of rows 2 and 7 (§8.1, *Optical size*). Only fonts and sizes in `pt` derive it, so write the sizes in `pt`, not `em` or `mm`.

**Checking the result.** Copy the set into the templates folder, open the test note, hide the header, set the zoom to 100 % and put the PDF next to it. At 100 % the text block has the PDF's width on screen (§8.1, *Print units and zoom*). Compare paragraph by paragraph where each line ends:

- **Every line ends one or two words early or late:** the measure (row 1), the size (row 2) or the weight (row 3) is off. The weight matters: a variable font's letters get wider with its weight.
- **Only some lines differ, all in justified paragraphs:** check the costs (row 5b) and `--mdo-hyphenate` (row 5a), and that the paragraph is one source line (a hard-wrapped paragraph is set per line, §8.1 *Paragraphs*). The paragraph with the cursor always differs while you edit it.
- **The PDF hyphenates a word and the preview does not, or the other way round:** `--mdo-hyphenate` (row 5a) or the note's `lang:` differs from the PDF's.
- **A list item's wrapped lines start left or right of the PDF's:** row 8.
- **Line spacing or the gaps between paragraphs differ, the breaks do not:** rows 4 and 6; these never change a line break.

What a set can reach: the app now hyphenates and breaks justified paragraphs like Typst, so for a set that declares rows 1 to 5b, expect nearly every line to end where the PDF's does: measured on a long memo dossier, 98 % of the lines (118 of 120) and 96 % of the paragraphs end like the PDF; din5008a (left-aligned) matches every line. Remaining differences are the limits listed under *Paragraphs* in §8.1 (hard-wrapped source lines, no hanging punctuation, the cursor paragraph, code and tables).

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
// `lang:` may carry a region (de-AT); text(lang:) refuses that, it takes the region separately.
#let lang-code = lang.split("-").first()
// The region is the two-letter part (de-AT); a script subtag such as zh-Hant is not one.
#let lang-region = lang.split("-").slice(1).find(p => p.len() == 2)
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
#set text(font: ("SourceSans3VF", "Noto Emoji", "Noto Sans Symbols 2"), size: 10.5pt,
  lang: lang-code, region: lang-region)
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

Not covered by the skeleton, see `memo.typ`: `toc`, `h1_break`, `showname`, `header`, `watermark`, `logo`/`logo_height`, `toptitle`/`subtitle`, localised labels per `lang`, Mermaid, table styling, footnotes.

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

- One repository per set: `MarkdownOffice-set-<name>` (e.g. `jcmx9/MarkdownOffice-set-memo`), with `<name>.typ`, `<name>.css`, `<name>.preview.yaml`, `<name>.header.md`, `LICENSE`, `README.md`, `README.en.md` (content-identical), `CHANGELOG.md` at the root.
- The README (both languages) has a section on the editor preview: which values the set declares and where each comes from (the table of §8.5 for your set), and what still differs from the PDF. memo and din5008a are examples.
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

- **No hard-coded links.** No fixed URLs in the `.typ`, `.css`, `.preview.yaml` or `.header.md` (no `link("https://…")`, no URLs in text, no `url()` in the CSS: the editor drops it anyway): a link in a client PDF can lead to a dangerous site, and a reader cannot tell. Links come only from the user's own note.
- **Read only what the pipeline hands over:** `read()` only on `sys.inputs.source`, the staged profile files and files under `mdo`; no other paths. `raw-typst: false`, with `<mdo-pagebreak>` mapped.
- **No obfuscated content** (encoded payloads, embedded files other than the source attachment).

These checks will run automatically in the catalog's CI before a set is listed; a reviewer confirms the result.

## 13. Checklist

- [ ] Name matches `^[a-z0-9_-]+$`; files are `<name>.typ`, `<name>.header.md`, `<name>.css`, `<name>.preview.yaml`.
- [ ] `.typ` is self-contained; imports only `mdo + "/lib/…"`, `mdo + "/vendor/…"` and bundled store packages (`@preview/<name>:<version>` with the exact pinned version, section 4); no `@preview/` in comments.
- [ ] `cmarker.render(…, raw-typst: false, html: (…, mdo-pagebreak: (attrs, body) => pagebreak(weak: true)))`; reads only staged files (§2).
- [ ] Every input is read with `sys.inputs.at(key, default: …)`; booleans compared as strings.
- [ ] Body rendered with `cmarker.render(preprocess(read(source), hard-breaks: …, lang: …), …)`, `smart-punctuation: false`, `math: mitex`.
- [ ] `html:` handles `mdo-alert`, `mdo-tasks`, `mdo-task`, `mdo-keep`.
- [ ] `scope: (image: …)` implements the probe/`images` contract; probe compiles without errors.
- [ ] `set document` has a non-empty title and a date (`datetime` or `auto`, never `none`).
- [ ] `pdf.attach` with the bare file name when `attach != ""`.
- [ ] Only bundled fonts, with the Noto fallbacks; greys via `luma()`.
- [ ] `<name>.header.md` contains `template: <name>` and every key the set honours.
- [ ] If the set has a `.css` or `.preview.yaml`: print units for sizes, no `url()` or at-rules, `.preview.yaml` starts with `preview: 1` and only uses the documented keys (section 8); a note without them still looks right (memo fallback). Each token's value is derived as in §8.5 and its source is written in a comment; the test note's lines end where the PDF's do, apart from the limits §8.5 names.
- [ ] Ships `<name>.schema.yaml` for its `x-` keys (section 6, *Schema*).
- [ ] If the header has `profile: <value>`, the set ships `profiles/<value>.yaml` (an example profile plus its companion files), so a new note exports right away. Companion files are named `<value>-…` or `<value>.…` (e.g. `beispiel-unterschrift.svg`) and referenced from the YAML by that bare name: „Profil anlegen …“ (offered for every set whose header has `profile:`) copies exactly these, renamed to the new profile's name. So no second profile may start with `<value>-` or `<value>.` (e.g. `beispiel-zwei.yaml` next to `beispiel.yaml`): it would count as a companion and turn up as an extra profile in every copy.
- [ ] A test note with all elements renders with exit 0, no warnings, PDF/A-3, attachment present.
- [ ] Repo `MarkdownOffice-set-<name>`, CalVer tag `vYY.M.MICRO`; for bundling, manifest entry with the archive's SHA-256.
- [ ] For the catalog: only freely licensed fonts with licence texts; no hard-coded links; `read()` only on pipeline inputs (section 12).
