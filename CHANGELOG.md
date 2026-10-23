# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Editor: the preview and Present follow the note's template set. `<name>.css` (next to `<name>.typ`) sets font, sizes, measure, headings and tables through documented `--mdo-*` tokens and `.mdo-*` rules; `<name>.preview.yaml` describes the blocks above (`head`, replaces the front matter) and below (`foot`) the text, filled from the front matter and the sender profile (`{key}`, `{profile.key}`, `x-profile-<key>` overrides, the profile's signature as a picture). Sets without these files, a broken `.preview.yaml` (one notice per set per session) or a `.typ` path keep memo's look. The set's CSS is sanitised and scoped to the editor: only `.mdo-*` rules, no at-rules, nothing that loads a resource, `position` limited to static, relative or absolute, no `z-index`. The contract is in TEMPLATES.md §8
- Editor: „Im Finder zeigen“ (Windows „Im Explorer zeigen“, Linux „Im Dateimanager zeigen“) in the „Datei“ menu after „Umbenennen …“ and in the note's right-click menu (tab, status-line file name) shows the active note in the system's file manager. A new note is saved first; a missing file or a path the app did not open is reported as a notice; not available while presenting
- Settings: the button „Vorlagen-Ordner öffnen“ opens the folder for your own template sets (`~/Documents/Markdown Office/Vorlagen/` or `MDO_TEMPLATES`) in the file manager and creates it when it is missing; an error shows next to the button
- Editor: the status line shows the note's set (`template:`, e.g. `memo`, `din5008a`) next to the file name; nothing without `template:`. The header is checked silently in the background (on opening a note, on switching tabs, 500 ms after typing stops; main's set and profile inputs are fetched again only when the path, `template:` or `profile:` change, or when the window regains focus). The name turns red when the check finds errors (warnings and hints do not count, like the export notice and the CLI exit code; a set that is not installed or a missing profile is an error); the tooltip reads „memo – n Fehler im YAML-Kopf“, with „(Set nicht installiert)“ for an unknown set. A click opens „YAML prüfen …“ (not while presenting)

### Changed
- Editor: the set's CSS gets the optical size of its fonts from its pt sizes (`--mdo-body-size: 11pt` also sets `--mdo-body-opsz: 11`, likewise `--mdo-h1-size` to `--mdo-h3-size`), as Typst does, and `<name>.preview.yaml` accepts `nobreak:` (`words:`, `units:`) for phrases and number-unit pairs the preview keeps on one line (TEMPLATES.md §8)
- Editor: the set's CSS can no longer hide or fake the note's text in the preview. `content` keeps only decoration without letters or digits (`"▪ "`), and rules that may reach the note's lines (anything but the head and foot blocks) keep only typography and spacing with an opaque colour and a non-zero size (TEMPLATES.md §8.1)
- Template sets: memo 26.10.6 and din5008a 26.10.3 describe their editor preview (`<name>.css`, `<name>.preview.yaml`). din5008a shows the sender line, address, date and subject above the text and closing, signature, signer and enclosures below it, in serif 11 pt at the letter's 165 mm measure; memo states its look explicitly (unchanged)
- Editor: 100 % zoom now matches the paper size, and zoom and the Present factor scale the set's print sizes (body, headings, tables, code, measure) together; memo's measure is 145 mm instead of 41.1 em (0.03 px apart at 100 %)

### Fixed
- Editor: the set's preview reads block lists whose items start in column 0 (`x-to:` followed by `- Firma`), which is valid YAML; the address block stayed empty
- TEMPLATES.md §8.1 named the code font token `--mdo-font-mono`; the theme's token is `--mdo-font-code`
- Build: `scripts/fetch-pipeline-assets.mjs` retries a download that failed with a server error (5xx), rate limiting (429) or a network error, three times with growing pauses (2 s, 5 s, 15 s); a 4xx other than 429 still fails at once. Single HTTP 503 answers from chromium.googlesource.com (dictionaries) had broken CI and release runs

## [26.10.1] - 2026-10-21

### Added
- Installer: a file-manager entry „Markdown-PDF“ turns a selected Markdown file into a PDF next to it through the `markdown-office` command, without opening the editor (real-fast-document had this; it was lost in the migration). macOS: Finder Quick Action for `.md`/`.markdown` (`~/Library/Services/Markdown-PDF.workflow`, result as a notification); Linux: „Öffnen mit → Markdown-PDF“ (`.desktop` entry for `text/markdown`) plus a Nautilus/Nemo script when those are present, result via `notify-send`; since both Linux entries claim `text/markdown`, the editor becomes the Markdown default in `~/.config/mimeapps.list` when none is chosen, so a double-click never converts; Windows: Explorer context-menu verb under `HKCU\Software\Classes\SystemFileAssociations` for `.md`/`.markdown`, started through `wscript.exe` so no console window flashes up, errors as a message box. Install and update write it, uninstall removes exactly what the install recorded in `.mdo-file-manager` next to the marker (including folders and registry keys created only for it); an entry of the same name that is not Markdown Office's is never touched. New `scripts/test-file-manager.sh` tests the generators; the bootstrap tests run each entry's command line on a note in a folder with spaces
- Editor: „Einfügen → Vorlage …“ replaces „Einfügen → YAML-Header …“ and makes a note from elsewhere a note of a template set, with the same picker as „Neu aus Vorlage …“ (set, and profile when the set's header has `profile:`). Without front matter the set's header goes on top; an existing header is merged: existing keys keep their values, the set's missing keys are appended at the bottom with default value and comment, no duplicates, comments and order untouched; `template:` (and `profile:` when one is chosen) is set in place or appended. One undo step; line endings and BOM stay as they were. The merge is a pure module (`src/core/header-merge.ts`) for a later shared core of CLI and MCP
- Editor: Bearbeiten → „YAML prüfen …“ (Mod+Shift+Y) checks the note's YAML header against the pipeline's schema (`pipeline/lib/frontmatter.schema.yaml`) and the set's own `<name>.schema.yaml` (types `text`, `bool`, `enum`, `date`, `length`, `list`, `lines`, `file`, `name`, `lang`; extra keys stay allowed). The dialog lists each finding with a suggested fix and offers the set's missing keys („Fehlende ergänzen“, off by default); „Übernehmen“ is one undo step and touches only the lines it fixes. On export and after „Vorlage …“ the header is checked silently; errors raise a notice „YAML hat n Fehler“ with „Prüfen …“ (the export runs anyway)
- CLI: `markdown-office validate <note.md> [--fix] [--add-missing] [--json]` runs the same check; exit code 0 = no errors, 1 = errors, 2 = usage or file error
- Template sets: optional `<name>.schema.yaml` next to the set's `.typ` describes its `x-` keys and restrictions (TEMPLATES.md)

### Changed
- Template sets: memo 26.10.5 and din5008a 26.10.2 ship their `<name>.schema.yaml` (din5008a checks `x-to` ≤ 6 lines, `x-sign`, `x-attachments`, `lang` de/en; memo declares no own keys)
- Editor: the notice after „Vorlage …“ about an invalid `date:` („In <today> ändern“) is replaced by the YAML check; the date error is now one finding in „YAML prüfen …“, fixed with „Übernehmen“ (undo step of its own, after the merge's)
- Internal: the `markdown-office` command is written in TypeScript and shares one core with the app (`src/core/`); behaviour unchanged
- Editor: the start screen's button „Neue Notiz“ is now „Neues Memo …“, since it starts a note with the `memo` header like Mod+N
- Editor: „Neu aus Vorlage …“ (Mod+Shift+N) lists `memo` too, first and preselected, so every set is offered in one place
- README: the front matter section explains when values need quotes (free text in quotes, fixed values without, and why)
- Licence: Markdown Office is now licensed under the GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later) instead of MIT; versions up to 26.10.0 stay MIT. Contributions come with a contributor agreement that keeps a commercial licence possible (CONTRIBUTING.md). The template sets stay MIT. The About panel shows copyright, licence and the no-warranty note; on Windows and Linux it opens from the new menu Hilfe → Über Markdown Office
- Outline: entries without sub-chapters no longer show a bullet (•); the slot stays empty, so their titles still line up with the chapters that have a fold arrow

### Removed
- Snippet `:header` (memo-specific; „Einfügen → Vorlage …“ covers every set)

### Fixed
- Template sets memo and din5008a: `lang:` with a region (`de-AT`, `de-DE`, `en-GB`) no longer stops the export with "expected two or three letter language code"; the region goes to Typst's `region:`
- TEMPLATES.md: the skeleton passed a regional `lang:` (`de-AT`) straight to `text(lang:)`, which stops the export („expected two or three letter language code“); it now splits off the region and passes it as `region:`. The sets `memo` and `din5008a` get the same fix with their next pinned release
- Editor preview and Present: table column widths follow Typst's auto columns like the memo PDF (each column as wide as its widest cell; if the table is too wide, columns that fit their fair share keep their width and only the oversized ones share the rest); the browser's own table layout squeezed short columns such as "Objekt" or "Quelle" until they wrapped. Small tables still stay as wide as their content
- Spell checking (Windows): after a language switch (the start language → the note's `lang:`, a downloaded dictionary) the shown note was checked again with the new dictionary; Chromium answered the unchanged text from its cache of the old language, so misspellings stayed unmarked or got suggestions in the wrong language (English ones in a German note) until the text was edited. The recheck now clears that cache first (Blink's per-document `spellCheckCustomDictionary`, enabled for the window) and runs once more shortly after, because the new dictionary reaches the renderer on a channel of its own
- Preview: the text breaks in the memo PDF's width (145 mm = 41.1em at 10pt); it was 37.4em, because CodeMirror's padding was taken from the measure, so lines held about 13 % fewer characters than in the PDF; tables span the same width as the text. Present stays deliberately narrower and larger than the PDF
- Editor preview, Present and table widget: a citation like `[21]` or `[1], [2]` (no link destination, no matching `[label]: …` definition) keeps its brackets as text, as in the PDF; only inline links, autolinks and references with a definition (label matched case-insensitively, whitespace collapsed) hide their brackets and get the link look
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
