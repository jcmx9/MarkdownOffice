# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- Outline: entries without sub-chapters no longer show a bullet (•); the slot stays empty, so their titles still line up with the chapters that have a fold arrow

### Fixed
- Editor: closing the window or quitting during Present (or while its fullscreen still animates) leaves fullscreen first and only then closes; on macOS a window closed in fullscreen could leave a black fullscreen Space in front of everything after the app was gone
- e2e tests: every app a test started is closed afterwards, also after a failed assertion, and killed when the close hangs; local runs (outside CI) only simulate the fullscreen (`MDO_E2E_FAKE_FULLSCREEN=1`), CI tests the real one

## [26.10.0] - 2026-10-19

### Added
- Editor: „Datei → Profil anlegen …“ copies the shown note's set example profile (with its companion files, renamed, and the YAML's references to them updated) to `Vorlagen/<set>/profiles/<name>.yaml`, sets `profile: <name>` in the note (one undo step) and opens the YAML as a tab; nothing is ever overwritten
- Editor: YAML files (`.yaml`/`.yml`) open as tabs (also via „Öffnen …“): always the Code view with YAML highlighting, no spell checking; export, header insert/toggle and page breaks are refused there, and renaming keeps the YAML extension
- Editor: Datei → Zuletzt geöffnet shows the file name; the full path is the hover text (macOS), and equal names get their folder appended
- Editor: Mod+N / „Neu“ starts the note with the `memo` set's YAML header (no file is written until you type)
- Editor: „Neu aus Vorlage …“ (Mod+Shift+N) picks any other template set (bundled or own, with a hint from its header file) and, when its header has `profile:`, a sender profile; the new note starts with that header
- Editor: „Einfügen → YAML-Header …“ inserts the header of a set chosen in the same picker (memo preselected); every set's `<name>.header.md` is read, next to its `.typ`, with a `template: <name>` fallback
- Set `memo` 26.10.3: table rows slightly tighter (cell inset 5 pt vertically instead of 7 pt); the editor preview's tables use the same inset
- Set `memo` 26.10.2: external links are marked in the PDF with a fine underline and a small ↗ (text colour)
- Set din5008a: DIN 5008 Form A letters with sender profiles, vCard QR and signature
- Offline Typst package store (vendor/packages, cades 0.3.1 + jogs 0.2.4 for QR codes, with their licence and third-party notice texts); a template or set-folder file importing an unbundled @preview package is refused instead of downloading it, and Typst runs behind an unreachable proxy so no download can happen
- Front matter profile: (sender profile file) for sets such as din5008a; looked up next to the note, in the templates folder and in the set folder
- Profiles per set: `Vorlagen/<set>/profiles/<name>.yaml` (also for bundled sets; such a folder without `<set>.typ` does not shadow the set) is searched after the note's folder and before the shared `Vorlagen/profiles/`, by the export and the picker alike; the not-found message lists every searched folder
- lib/markdown.typ: frontmatter(src) gives template sets the whole YAML front matter (lists, maps, x- keys)
- Templates folder: a set may also be a folder <name>/<name>.typ (e.g. a cloned set repo)
- Outline: entries read as a list; a chapter with sub-chapters keeps the fold arrow, an entry without sub-chapters shows a bullet (•) in the same slot; levels are relative, so a note with only `##` headings shows them in the top-level look
- Outline: the width can be dragged in Present too; each Present starts at the default width and a dragged width is not persisted
- Editor: status line toggles „Gliederung“ and „YAML“ right of `Code | Vorschau` (same behaviour as Mod+Shift+O / Mod+Shift+H; YAML disabled without a header and in Code)
- Spell checking in the editor (switchable; never in Present, code blocks or the front matter); suggestions in the context menu; Windows/Linux: bundled de-DE/en-US dictionaries, verified updates and further languages from MarkdownOffice-dictionaries
- First release of Markdown Office: the rf-write editor and the real-fast-document pipeline in one app; `markdown-office` CLI; set `memo`
- Editor: tabs, autosave with atomic, byte-exact writes (BOM, CRLF and mixed line endings kept), session restore, single instance, detection of external changes with a per-note conflict banner
- Editor: Preview in the PDF look with the bundled fonts, Code/Preview switch, YAML header that collapses into the title block, section folding, outline sidebar (H1/H2)
- Editor: Present mode (fullscreen, larger text, info line with clock, tabs and zoom); Code in Present ends Present and shows the Code view
- Set `memo` 26.10.1: the front-matter template inserted by „Einfügen → YAML-Header (memo)“ is compact, one line per key with a short comment
- Editor: syntax highlighting for the YAML header, fenced code blocks (more token kinds in Typst's colours) and Mermaid diagrams (`mermaid`, `mmd`), in every view
- Editor: snippets `:meeting`, `:telefonnotiz`, `:aufgabe`, `:header`, `:newpage` and own `*.tpl.md` snippets (default folder `~/Documents/Markdown Office/Snippets/`)
- Editor: PDF export through the bundled pipeline (Mod+E); menu „Einfügen“ inserts the `memo` set's front-matter template and page breaks
- Pipeline: Markdown → PDF/A-3b with Typst, offline, with the Markdown source embedded; options `--no-source`, `--hard-breaks`, `--soft-breaks`, `--template`, `--version`, `--help`; environment `MDO_NO_OPEN`, `MDO_BASE_DIR`, `MDO_TEMPLATES`
- Template sets: the bundled set `memo` (default for `template:`), own sets in `~/Documents/Markdown Office/Vorlagen/`
- Logo lookup for a relative `logo:`: the note's folder, the home folder, the templates folder (`MDO_TEMPLATES`, default `~/Documents/Markdown Office/Vorlagen/`), then the app's pipeline folder
- Typst, fonts and Typst packages ship with the app, pinned with SHA-256 checksums (`scripts/pipeline-assets.json`, `npm run assets`)
- Licence texts of the bundled Typst (LICENSE, NOTICE), fonts and Typst packages ship in `<resources>/pipeline/licenses/`
- `markdown-office --app [note.md …]` opens the editor; on Windows the command is `markdown-office.cmd` on the PATH
- One-line install, update and uninstall for macOS, Linux and Windows (`scripts/bootstrap.sh`, `scripts/bootstrap.ps1`), also for pre-releases (`--pre` / `-Pre`); macOS builds are ad-hoc signed, including the bundled Typst
- Release script `scripts/release.sh dev|prod`, release workflow with `SHA256SUMS`, CI on macOS, Linux and Windows
- `TEMPLATES.md`: guide for writing template sets (inputs, preprocessing contract, PDF/A requirements, skeleton, publishing)
- Editor: external links (`http://`, `https://`, `mailto:`, also `<https://…>`) look like in the PDF of set `memo` 26.10.2: in the text colour, with a fine underline and a small ↗ after the link, in the Preview, Present and the table widget; the arrow is not part of the document. Internal links and the Code view are unchanged

### Changed
- **Breaking:** the front-matter key `client:` is renamed to `toptitle:` (pipeline, Windows pipeline, editor title block, snippets `:header`, `:meeting`, `:telefonnotiz`, docs); `client:` is no longer read, so rename it in existing notes. The Typst input `client` is now `toptitle`; own template sets must read `sys.inputs.toptitle`
- Set `memo` 26.10.4: reads `toptitle` instead of `client` (small line above the title, footer, PDF keywords); its header file has `toptitle:`
- Set `din5008a` 26.10.1: sender profiles get separate `zip` and optional `country` (default Germany) next to `city`, so the vCard QR code carries postal code, city and country in their own address fields (`ADR:;;<street>;<city>;;<zip>;<country>`, special characters escaped); the printed sender line stays `<zip> <city>`, and old profiles with `city: 33609 Bielefeld` print the same text (the QR splits off the leading postal code); an unquoted German `zip` read as a number is padded back to five digits; the example profile `beispiel` uses `zip` + `city`

### Fixed
- Preview: heading spacing and the H1 hairline follow the `memo` PDF (baseline distances within 1pt) and no longer depend on blank lines in the source; blank lines next to a heading collapse until the cursor is on them
- Spell checking (Windows/Linux): an opened note is checked again once its dictionary has loaded; before, a `lang: de` note opened on an English system kept English suggestions or no marks until edited
- Spell checking: the „Wörterbuch fehlt – laden?“ notice comes back after leaving Present or switching spell checking on again (it stayed suppressed until restart); „Nicht mehr fragen“ still wins
- Windows install/update: moving the freshly extracted app into place now retries for up to ~13 s (Defender may still scan the new files); the first move, which detects a running app, stays quick
- Start screen without an open note: no redundant „Keine Notiz geöffnet.“ line; „Neue Notiz“ and „Öffnen …“ are two equal buttons
- Pipeline: a multi-line HTML comment (`<!--` … `-->` across lines) no longer swallows all text after it; typography and hard line breaks now leave such comments untouched
- Outline: slightly larger than the note text and one fixed width (18em, grows with the zoom); long headings end in „…“ and show in full on hover (only when cut off), right-aligned to the row
- Outline: the width can be dragged at its left edge in the editor (double-click or keyboard ←/→ on the grip; remembered in the session); Present always uses the default width
- Outline: only chapters with sub-chapters get a fold arrow (▸ from the bundled Source Sans 3, the same on every OS); a page break, HTML comment or link definition at the end of a section belongs to the next heading, so it neither makes a section foldable nor gets folded away with it
