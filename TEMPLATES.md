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

Keep the set in **one self-contained `.typ` file**. Only import from the pipeline (`mdo`) and the bundled store packages (`@preview/…`), see §4. On Windows a template on a different drive than the pipeline is copied alone into a staging folder, so sibling files of the `.typ` are not reachable there.

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
  --root / <all --input …> --input probe=true
# 2. real build
typst compile <set>.typ <out.pdf> --font-path <pipeline>/fonts --ignore-system-fonts \
  --package-cache-path <pipeline>/vendor/packages --package-path <pipeline>/vendor/local-packages \
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
| a name (`a-z`, `0-9`, `_`, `-`), e.g. `kanzlei` | `<name>.yaml` 1. in `profiles/` in the note's folder (or `MDO_BASE_DIR`), 2. in `<set>/profiles/` in the templates folder (`~/Documents/Markdown Office/Vorlagen/` or `MDO_TEMPLATES`; the set's profiles, also for a bundled set – only when `template:` is a set name, not a `.typ` file), 3. in `profiles/` in the templates folder (shared by all sets), 4. in `profiles/` in the folder of the resolved set (its example profiles) – the first existing file wins |
| a path ending in `.yaml`/`.yml` | relative to the note, `~`, `$VAR`, `${VAR}` and `%VAR%` expanded |

**Overriding values per note.** A set that prints profile values may let the note override single ones: `x-profile-<key>` in the front matter replaces the profile's `<key>` (for example `x-profile-phone`). The editor preview follows the same convention for `{profile.<key>}` (section 8). `signature` cannot be overridden: it names a file next to the profile.

A folder `Vorlagen/<set>/` that holds only `profiles/` (no `<set>.typ`) does not shadow the bundled set: a set is resolved by its `.typ` only.

A profile that is not found stops the export with exit code 1 and „Profil nicht gefunden: <name>“, listing the searched folders, and writes no PDF: a letter without a sender is worse than none. On Windows only the files directly in the profile's folder (no subfolders) are copied to the staging folder when it is on another drive than Typst's root, so a signature (or logo) must sit **directly next to the profile**, not in a subfolder; a profile directly in a drive root is refused there ("Profil darf nicht im Wurzelverzeichnis eines Laufwerks liegen") so no export copies a whole drive.

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
- `--mdo-scale` and `z-index` are dropped. `position` may be `static`, `relative` or `absolute`, never `fixed` or `sticky`.

**Print units and zoom.** Write sizes in print units (`11pt`, `165mm`). The sanitiser multiplies every absolute length (`px pt pc mm cm in Q`, outside strings) by the app's zoom factor `--mdo-scale`. At 100 % zoom a set's `11pt` is 11 CSS pt and `165mm` is 165 CSS mm, i.e. the paper size; the zoom and the Present factor scale all print sizes together by the same factor. Relative units (`em`, `ch`, unitless line heights) follow on their own. Present keeps its `70ch` measure.

**Tokens.** The app declares the tokens on the `.cm-editor` element, which also carries the class `.mdo-preview`. A set changes them with a rule on `.mdo-preview`:

```css
.mdo-preview {
  --mdo-body-font: var(--mdo-font-serif);
  --mdo-body-size: 11pt;
  --mdo-measure: 165mm;
}
```

Tokens that refer to other tokens (`--mdo-hN-font`, `--mdo-hN-color`, `--mdo-table-font`) are resolved on `.mdo-preview` itself, so override them there too, in the same rule; a rule on a deeper element would not reach them. The defaults are memo's values:

| Token | memo default | Meaning |
|-------|--------------|---------|
| `--mdo-body-font` | `var(--mdo-font-sans)` | body font family |
| `--mdo-body-size` | `10pt` | body size (zoomed) |
| `--mdo-body-weight` | `400` | body weight |
| `--mdo-bold-weight` | `600` | weight of `**bold**` |
| `--mdo-line-height` | `1.5` | line height |
| `--mdo-align` | `justify` | text alignment of paragraphs |
| `--mdo-par-gap` | `1.1em` | the gap a blank line makes between paragraphs |
| `--mdo-measure` | `145mm` | width of the text block |
| `--mdo-heading-font` | `var(--mdo-font-serif)` | heading font family |
| `--mdo-heading-align` | `left` | heading alignment |
| `--mdo-h1-font`, `--mdo-h2-font`, `--mdo-h3-font` | `var(--mdo-heading-font)` | font per level |
| `--mdo-h1-size`, `--mdo-h2-size`, `--mdo-h3-size` | `14pt`, `12pt`, `10pt` | size per level |
| `--mdo-h1-weight`, `--mdo-h2-weight`, `--mdo-h3-weight` | `560`, `560`, `400` | weight per level |
| `--mdo-h1-color`, `--mdo-h2-color`, `--mdo-h3-color` | `var(--mdo-heading)` | colour per level |
| `--mdo-h1-rule` | `var(--mdo-hairline)` | colour of the line under H1 |
| `--mdo-h3-decoration` | `underline` | text decoration of H3 |
| `--mdo-table-font` | `var(--mdo-body-font)` | table font family |
| `--mdo-table-size` | `9pt` | table size |
| `--mdo-table-weight` | `500` | table weight |
| `--mdo-table-tracking` | `-0.02em` | letter spacing in the rendered table |
| `--mdo-code-size` | `9pt` | size in code blocks (inline code stays `0.9em`) |
| `--mdo-titleblock-align` | `center` | alignment of the head block |

Colour tokens such as `--mdo-heading`, `--mdo-hairline` and the families `--mdo-font-sans`, `--mdo-font-serif`, `--mdo-font-code` belong to the app's theme (light and dark); use them with `var()` so the set follows the theme.

**Classes.** Besides tokens a set may style the blocks of `.preview.yaml`: `.mdo-titleblock` (the head), `.mdo-footblock` (the foot), each element as `.mdo-tb-<class>`, its label as `.mdo-tb-label`, the single lines of `lines:` as `.mdo-tb-line`. Declarations such as `margin`, `text-align`, `font-size` and `position: relative|absolute` (to let a signature overlap lines) are fine.

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

The file is a map with `preview: 1` and the lists `head` and `foot` (both optional). Any other top-level key, a missing or different `preview:` or a wrong type anywhere makes the whole file invalid. It is read as YAML 1.2 core, so `no`, `nein` and `yes` are ordinary text.

Keys of an element:

- `class:` (required, `a-z`, `0-9`, `-`): the element becomes `mdo-tb-<class>`.
- Exactly one of `text:`, `parts:`, `lines:`, `image:`.
- `text:` a string; `parts:` a list of strings joined with `sep:` (default one space, empty parts are dropped first, so no dangling separators); `lines:` is a string (a YAML list makes the file invalid): if it is exactly one placeholder whose value is a list (e.g. `"{x-to}"`), each list item becomes a line; otherwise the resolved string is split at newlines.
- `image:` only `"{profile.signature}"` (the one picture the app reads). `width:` sets its width, e.g. `"{profile.signature-width|40mm}"`; a number with `mm`, `pt`, `cm` or `in` (else no width), scaled with the zoom.
- `label:` a text shown before the content, either a string or a map by language (`de`, `en`, …): the note's `lang` without region, then `de`, then the first entry.
- `today:` `true` makes an empty or missing `{date}` today's date (as the PDF does); without it an empty date stays empty.
- `when:` one placeholder or a list; all must hold. A value holds when it is not empty and not `false`, `False` or `FALSE`. Other words (`no`, `nein`, `0`) count as present. A string with several placeholders holds only if all of them hold; a `when` without any placeholder always holds.

Placeholders: `{key}` is the note's front-matter value, `{profile.key}` a value of the profile the note names (section 2, *Profiles*); `{key|default}` uses `default` when the value is empty. An unknown key is empty. Values are source text (`zip: 01067` stays `01067`); a list is joined with `, ` inside a text.

Omission: an element with at least one placeholder whose placeholders are all empty is left out. An element made of literal text only is always shown. All text is inserted as text, never as HTML.

**Where the blocks appear.** The head replaces the front matter in the preview with the header hidden and in Present; the foot sits after the text under the same conditions. Neither appears in the code view.

### 8.3 Profile access

Only the profile keys that `.preview.yaml` names (`{profile.key}`) are read into the preview; other keys of the file never leave the app's main process. The note may override a value with `x-profile-<key>` (section 2). The signature is a bare `.svg` file name next to the profile, at most 256 KiB, not a symbolic link, not dot-prefixed (hidden), whose content starts with `<svg` or `<?xml`; otherwise there is no signature picture. `signature` cannot be overridden by the note.

### 8.4 Fallbacks

| Case | Result |
|------|--------|
| no `<name>.css` | built-in memo look |
| no `<name>.preview.yaml` | memo's title block (toptitle, title, subtitle, date and author) |
| invalid `<name>.preview.yaml` | memo's title block, and one notice per set per session |
| `template:` is a `.typ` path or an unknown set | built-in memo look and blocks |

Test a set in the editor by copying it into the templates folder and opening a note with `template: <name>`. The unit tests in `tests/unit/` and the fixture sets `tests/fixtures/sets/` show working and malicious examples. Never rely on `.css` or `.preview.yaml` for PDF output.

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
- **Read only what the pipeline hands over:** `read()` only on `sys.inputs.source` and files under `mdo`; no other paths.
- **No obfuscated content** (encoded payloads, embedded files other than the source attachment).

These checks will run automatically in the catalog's CI before a set is listed; a reviewer confirms the result.

## 13. Checklist

- [ ] Name matches `^[a-z0-9_-]+$`; files are `<name>.typ`, `<name>.header.md`, `<name>.css`, `<name>.preview.yaml`.
- [ ] `.typ` is self-contained; imports only `mdo + "/lib/…"`, `mdo + "/vendor/…"` and bundled store packages (`@preview/<name>:<version>` with the exact pinned version, section 4); no `@preview/` in comments.
- [ ] Every input is read with `sys.inputs.at(key, default: …)`; booleans compared as strings.
- [ ] Body rendered with `cmarker.render(preprocess(read(source), hard-breaks: …, lang: …), …)`, `smart-punctuation: false`, `math: mitex`.
- [ ] `html:` handles `mdo-alert`, `mdo-tasks`, `mdo-task`, `mdo-keep`.
- [ ] `scope: (image: …)` implements the probe/`images` contract; probe compiles without errors.
- [ ] `set document` has a non-empty title and a date (`datetime` or `auto`, never `none`).
- [ ] `pdf.attach` with the bare file name when `attach != ""`.
- [ ] Only bundled fonts, with the Noto fallbacks; greys via `luma()`.
- [ ] `<name>.header.md` contains `template: <name>` and every key the set honours.
- [ ] If the set has a `.css` or `.preview.yaml`: print units for sizes, no `url()` or at-rules, `.preview.yaml` starts with `preview: 1` and only uses the documented keys (section 8); a note without them still looks right (memo fallback).
- [ ] Ships `<name>.schema.yaml` for its `x-` keys (section 6, *Schema*).
- [ ] If the header has `profile: <value>`, the set ships `profiles/<value>.yaml` (an example profile plus its companion files), so a new note exports right away. Companion files are named `<value>-…` or `<value>.…` (e.g. `beispiel-unterschrift.svg`) and referenced from the YAML by that bare name: „Profil anlegen …“ copies exactly these, renamed to the new profile's name. So no second profile may start with `<value>-` or `<value>.` (e.g. `beispiel-zwei.yaml` next to `beispiel.yaml`): it would count as a companion and turn up as an extra profile in every copy.
- [ ] A test note with all elements renders with exit 0, no warnings, PDF/A-3, attachment present.
- [ ] Repo `MarkdownOffice-set-<name>`, CalVer tag `vYY.M.MICRO`; for bundling, manifest entry with the archive's SHA-256.
- [ ] For the catalog: only freely licensed fonts with licence texts; no hard-coded links; `read()` only on pipeline inputs (section 12).
