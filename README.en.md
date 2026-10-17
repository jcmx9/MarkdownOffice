# Markdown Office

> Calm Markdown editor with a built-in PDF/A pipeline: the note already looks like the PDF while you type.

**Version:** 26.10.0-dev.1 · [Deutsch](README.md)

[![CI](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Description

Markdown Office is an editor for taking notes, for example in a client meeting while the screen is shared, and a pipeline that sets the same Markdown file as an archivable **PDF/A-3b** (Typst, offline, no Pandoc). Both live in one app: the editor exports through the bundled pipeline, and the `markdown-office` command produces PDFs in the terminal or from other programs. The Markdown file stays byte for byte as it was typed.

Markdown Office brings the rf-write editor and the real-fast-document pipeline together in one product.

- **Editor:** tabs, autosave with atomic writes, session restore, detection of external changes without silent overwrites, a preview in the look of the PDF, presentation mode, outline, snippets.
- **PDF:** fixed layout from the template set `memo` (DIN A4, title block, header and footer, table of contents, callouts, task tables, formulas, Mermaid diagrams), the Markdown source as an attachment, your own template sets.
- **Everything included:** Typst, fonts and Typst packages ship with the app; nothing else needs to be installed.

## Installation

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.ps1 | iex
```

The script downloads the matching archive of the latest stable GitHub release, verifies it against `SHA256SUMS` and installs without admin rights.

| System | Program | Command |
|--------|---------|---------|
| macOS | `~/Applications/Markdown Office.app` | `~/.local/bin/markdown-office` |
| Linux | `~/.local/share/markdown-office/app/` (extracted AppImage) and `~/.local/share/applications/markdown-office.desktop` | `~/.local/bin/markdown-office` |
| Windows | `%LOCALAPPDATA%\Markdown Office\` and a Start-menu shortcut | `%LOCALAPPDATA%\Microsoft\WindowsApps\markdown-office.cmd` (already on PATH) |

The app is unsigned. On macOS it is ad-hoc signed (the bundled Typst too) and the script removes the quarantine flag, so Gatekeeper does not block it. On Windows, SmartScreen may warn. On Linux the script extracts the AppImage once, so `libfuse2` is not needed. On Ubuntu 24.04 and newer, AppArmor blocks the unprivileged user namespaces Electron's sandbox needs; the editor then does not start (PDF generation still works). The script warns in that case and prints an AppArmor profile for Markdown Office only (creating it needs sudo). The editor's launch log is at `~/.local/share/markdown-office/launch.log`.

## Update

Run the install command again. The installed version is replaced; if the download fails, the old version stays as it is. A specific version: `... | bash -s -- --version 26.10.0`, or `-Version 26.10.0` on Windows.

## Uninstall

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.sh | bash -s -- --uninstall
```

Windows (PowerShell):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.ps1))) -Uninstall
```

Only what the installation created is removed (recognised by its install marker): app, command, Start-menu or desktop entry. Documents, your own template sets, snippets and settings are left untouched.

## Test version

Pre-releases for testing; they can be older than the latest stable version:

```bash
curl -fsSL https://raw.githubusercontent.com/jcmx9/MarkdownOffice/dev/scripts/bootstrap.sh | bash -s -- --pre
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/dev/scripts/bootstrap.ps1))) -Pre
```

## Editor

### Starting

```bash
markdown-office --app                 # last session or a new note
markdown-office --app note.md         # open a file (as a tab in a running instance)
markdown-office --app --version
markdown-office --app --help
```

The editor also starts from the Start menu (Windows), the desktop entry (Linux) or `~/Applications/Markdown Office.app` (macOS). Symbolic links to single notes open the linked file (tab name, rename and export refer to it); linked folders are not affected.

New notes go to the default folder `~/Documents/Markdown Office/` (Windows: in the "Documents" folder). Settings live in `settings.json` in the app data folder (macOS `~/Library/Application Support/Markdown Office`, Windows `%APPDATA%\Markdown Office`, Linux `~/.config/Markdown Office`).

The preview uses the PDF's bundled fonts; if a font file is missing, it falls back to system fonts. Body text is justified as in the PDF, but without hyphenation; Typst hyphenates only on export. Mod+E saves the note and exports it with the pipeline; the PDF lands next to the note (named as by the [command](#the-markdown-office-command)) and opens in the default viewer.

| Shortcut | Action |
|----------|--------|
| Mod+N | New note in the default folder (`YYYY-MM-DD_HH-mm-ss.md`) |
| Mod+O | Open |
| Mod+Shift+R | Rename |
| Mod+W | Close tab |
| Mod+E | Export PDF |
| Mod+Shift+M | Toggle code view (Preview is the default); in Present it ends Present and shows the Code view |
| Mod+Shift+H | Show/hide the YAML header in the preview (hidden, the title block appears as in the PDF) |
| Mod+Shift+O | Toggle outline (remembered per mode) |
| macOS Cmd+Alt+[ / ], otherwise Ctrl+Shift+[ / ] | Fold/unfold section |
| macOS Ctrl+Alt+[ / ], otherwise Alt+0 / Alt+Shift+0 | Fold/unfold all sections |
| Mod+Shift+P, Esc | Toggle Present (fullscreen, only text and info line, optionally with outline) |
| Mod+Enter | Insert a page break (`<!-- pagebreak -->`) |
| Mod+Plus / Mod+- / Mod+0 | Zoom in / zoom out / actual size (saved per mode) |
| Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 | Switch tabs |
| Mod+Z / Mod+Shift+Z, Mod+X/C/V, Mod+A | Undo/redo, cut/copy/paste, select all |

`Mod` = Cmd on macOS, otherwise Ctrl. Selection with Shift or Mod+Shift and the arrow keys is handled by CodeMirror.

Right-clicking a tab or the file name in the status line opens a menu with rename, export PDF and close tab. The status line shows the clock on the left and the switches `Editor | Präsentation` and `Code | Vorschau`; clicking the other side switches. In Present, clicking „Code“ (like Mod+Shift+M) ends Present and shows the Code view.

### Settings

„Einstellungen …“ (macOS Cmd+, in the app menu, otherwise Ctrl+, in the „Datei“ menu) opens the dialog: default folder for new notes, snippet folder, font factor in presentation mode and the default for the YAML header in the preview (as YAML or as title block). A read-only status block shows the version of the pipeline and of the bundled Typst. Changing the default folder never moves or deletes files. The dialog names values it did not take after saving; the previous value stays in effect for them.

### Outline

A sidebar on the right lists the note's H1 and H2 headings. The arrow in front of an entry with content folds or unfolds the section in the text and in the outline at the same time; „fold/unfold all“ acts on both as well. Clicking an entry jumps to the heading in the text; the focus stays in the editor. Mod+Shift+O shows or hides the outline; the setting is remembered separately for the editor and Present.

### Snippets

Type `:` at the start of a line or after a space, plus at least one letter (e.g. `:mee`), and the snippet list appears; Ctrl+Space after a single `:` shows all of them. On macOS, Ctrl+Space may be taken by the input-source switch; then just type `:` and a letter. Enter or Tab inserts the snippet, Tab / Shift+Tab jump through the fields. Prose such as `Hinweis:`, `10:30` or `:D` triggers nothing.

Inside a snippet, Esc first leaves field mode; in presentation mode only a further Esc leaves Present. Header snippets (`:meeting`, `:telefonnotiz`, `:header`) keep the YAML header open in presentation mode while a field inside it is active; afterwards it collapses into the title block. Follow-up lines of a multi-line snippet take over the indentation of the current line, and tabs at the start of a template line become two spaces.

| Snippet | Content |
|---------|---------|
| `:meeting` | Meeting note with header, participants, agenda, minutes and tasks |
| `:telefonnotiz` | Phone note |
| `:aufgabe` | Task line `- [ ] Aufgabe – Name, bis Datum` |
| `:header` | YAML header with all keys of the set `memo` |
| `:newpage` | Page break `<!-- pagebreak -->` |

The menu **Einfügen → YAML-Header (memo)** puts the front-matter template of the set `memo` (`memo.header.md`) unchanged at the top of the note: every key with its default value and explanation. The cursor then sits in the title. A note that already has a header is left unchanged.

Your own snippets are files `name.tpl.md` in the snippet folder (default `~/Documents/Markdown Office/Snippets/`, setting „Snippet-Ordner“). Your own snippet with the same name replaces the built-in one. New files are picked up the next time the window gets focus. Supported syntax: `$1`, `${1:default}`, `$0` (final position) and `$CURRENT_YEAR`, `$CURRENT_MONTH`, `$CURRENT_DATE`, `$CURRENT_HOUR`, `$CURRENT_MINUTE`, `$CURRENT_SECOND` (also in the form `${CURRENT_YEAR}`). `\$` gives a literal `$`, `\\` a backslash, and inside a default `\}` gives a literal `}`.

## The markdown-office command

```bash
markdown-office note.md                      # PDF next to the note
markdown-office note.md target.pdf           # exactly this path
markdown-office --no-source note.md          # without source in the PDF
markdown-office --soft-breaks note.md        # line breaks become spaces
markdown-office --template my-set note.md    # another template set
markdown-office --help                       # all options
markdown-office --app [note.md …]            # open the editor
```

Without an argument the command prints its help.

**Output name:** without a second argument the PDF lands next to the source. With `date:` in the front matter it gets an ISO prefix (`2026-10-13_note.pdf`), which `isodate_praefix: false` disables. An explicitly given output path is written exactly as given. After the build the PDF opens in the default viewer.

| Option | Effect |
|--------|--------|
| `--no-source` | Do **not** embed the Markdown source (e.g. client PDFs); same as `embed_source: false` |
| `--hard-breaks` | Every line stays a line, as typed in the editor (default); same as `hard_breaks: true` |
| `--soft-breaks` | Single line breaks become spaces (CommonMark), for wrapped prose; same as `hard_breaks: false` |
| `--template NAME` | Template set or `.typ` file for this build; like `template:` |
| `--app [note.md …]` | Open the editor instead of producing a PDF (first argument only) |
| `--version`, `-V` | Print the Markdown Office and Typst versions |
| `--help`, `-h` | Print help |

On Windows the same options apply, plus `-Version` and `-Help`. There the command is a `.cmd` file: arguments containing the cmd metacharacters `&`, `^`, `%` or `|` must be quoted when called from PowerShell or cmd.

| Environment variable | Effect |
|----------------------|--------|
| `MDO_NO_OPEN=1` | Do not open the PDF after the build (batch, cron, other programs) |
| `MDO_BASE_DIR=folder` | Image and logo paths relative to this folder instead of the source's folder |
| `MDO_TEMPLATES=folder` | Folder with your own template sets instead of `~/Documents/Markdown Office/Vorlagen` |
| `TYPST=/path/typst` | Use a specific Typst binary instead of the bundled one (≥ 0.15) |
| `SOURCE_DATE_EPOCH` | Fix the PDF date when no `date:` is set |

### From other programs

`markdown-office` is built as an export target:

- The exit code is 0 only on success; errors and warnings go to stderr, short and in German.
- Typst comes with the app and is found even with a minimal `PATH` (started from a GUI app).
- Input and output may be absolute paths with spaces; relative paths count from the caller's working directory.
- For a temporary copy of the note (for example when exporting unsaved changes) `MDO_BASE_DIR` points to the real note folder, so images and the logo are found.

```bash
MDO_NO_OPEN=1 MDO_BASE_DIR="/path/to/note" markdown-office --no-source "/path/note.md" "/path/target.pdf"
```

## Front matter

A YAML block at the start of the file controls individual documents. All keys are optional; the front-matter template of the set `memo` (menu **Einfügen → YAML-Header (memo)** or the `:header` snippet) contains every key with its default value and a comment.

```yaml
---
title: "Kick-off relaunch"   # title: title block, header, PDF title
subtitle: "Workshop"         # subtitle
client: "Example Ltd"        # client, small and letter-spaced above the title
author: [Anna, Ben]          # author(s): line "date · author"
date: 2026-10-13             # date (ISO or D.M.YYYY)
lang: en                     # language; default de
watermark: "DRAFT"           # watermark
logo: company.svg            # logo in the header (without: no logo)
embed_source: false          # do not embed the source
hard_breaks: false           # line breaks become spaces
---
```

| Key | Values | Default | Effect |
|-----|--------|---------|--------|
| `template` | set name or `.typ` file | `memo` | The document's template set, see [Template sets](#template-sets). |
| `title` | text | — | Title block on top, header from page 1, PDF metadata title. Without `title` there is no title block; the PDF title is then the file name. `# …` in the text is always a chapter, never the title. |
| `subtitle` | text | — | Subtitle below the title. |
| `client` | text | — | Client/company, small and letter-spaced above the title. |
| `author` | text or `[A, B]` | — | Line below the title: “date · author”. |
| `date` | `2026-10-13` or `13.10.2026` | — | Date bottom right (per `lang`), ISO prefix on the file name, fixed PDF date. An unrecognised date is shown as is, without a prefix. |
| `isodate_praefix` | `true` / `false` | `true` | ISO prefix on the file name when `date` is set. |
| `lang` | `de`, `en`, … | `de` | Language: date, hyphenation, quotes, labels (Seite/Page, Inhalt/Contents, Aufgabe/Task, callouts). |
| `toc` | `auto` / `true` / `false` | `auto` | Table of contents (H1 + H2 only); `auto` above five H1/H2. |
| `h1_break` | `auto` / `true` / `false` | `auto` | Every chapter (`#`) on a new page; `auto` as for `toc`. |
| `header` | text | — | Fixed header text from page 1 instead of the running chapter. |
| `print_filename` | `true` / `false` | `true` | Show/hide the bottom-left entry (file name or “client · title”). |
| `watermark` | text | — | Diagonal light-grey watermark beneath everything. |
| `logo` | file `.svg`/`.png`/`.jpg`/`.jpeg` | no logo | Logo in the header, only when set; see [Logo](#logo). |
| `logo-height` | `15mm`, `1.5cm`, `40pt`, … | `13mm` | Maximum logo height (at most 25 mm); the logo keeps its proportions and is at most 60 mm wide. |
| `embed_source` | `true` / `false` | `true` | Embed the Markdown source as an attachment. |
| `hard_breaks` | `true` / `false` | `true` | Every line break stays one (as typed in the editor), even without an entry. Only `false` switches to CommonMark: a single break becomes a space. |

**Rules:** empty values (`subtitle: ""` or just `subtitle:`) are ignored, never an error. Yes/no keys accept `true`/`false`, `yes`/`no`, `on`/`off` in any case; an unrecognised value produces a warning and the default applies. Comments (`# …`) may stand on their own lines and after values. In paths (`logo:`, images) `~`, `$VAR`, `${VAR}` and `%VAR%` are expanded.

### Logo

A logo appears **only** when `logo:` is set. Without the key, with an empty value or commented out, the header has no logo.

| Value of `logo:` | Looked up |
|------------------|-----------|
| `company.svg`, `logos/company.svg` | 1. in the note's folder (or `MDO_BASE_DIR`), 2. in the home folder (`~`, Windows `%USERPROFILE%`), 3. in the app's pipeline folder – the first existing file wins |
| `/path/company.svg`, `C:\Logos\company.png` | exactly this file |
| `~/company.svg`, `$HOME/company.svg`, `%USERPROFILE%\company.svg` | exactly this file, variables expanded |

- Allowed are `.svg`, `.png`, `.jpg` and `.jpeg`.
- If nothing is found (or the extension is wrong, or it is a web address), the PDF is built **without a logo**, with a note, never with an error.
- **Your own logo for all documents:** put it in the home folder once (`~/company.svg`) and write `logo: company.svg` in each note. A file of the same name next to the note takes precedence, e.g. for a client logo.
- The app ships the Markdown Office mark as `logo.svg`: `logo: logo.svg` finds it as long as no `logo.svg` of your own lies next to the note or in the home folder.

## Markdown in the PDF

CommonMark works as usual: `*italic*`, `**bold**`, `` `code` ``, links, lists, quotes, footnotes, tables. On top of that:

- **Tasks:** a list made only of tasks (`- [ ] Sitemap erstellen – Ben Probe, bis 17.10.`) becomes the table *Task · Owner · Due · Status* (German *Aufgabe · Wer · Bis · Status*).
- **Callouts:** `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` and the German keywords `[!INFO]`, `[!TIPP]`, `[!WICHTIG]`, `[!HINWEIS]`, `[!ACHTUNG]`.
- **Typography:** quotes per language, `--` and `---` as en and em dash, `...` as ellipsis, non-breaking spaces (`z. B.`, `5 %`), `==highlight==`.
- **Page break:** `<!-- pagebreak -->` or `\newpage` on a line of its own.
- **Images:** `![Caption](image.png){width=50%}`; a missing image never stops the export, remote images are skipped offline.
- **Formulas** in LaTeX syntax (`$…$`, `$$…$$`), **code** with syntax highlighting, **definition lists** and **Mermaid diagrams** (drawn offline).

## Template sets

A template set defines how a document looks. It consists of up to three files sharing one name:

| File | Purpose | Required |
|------|---------|----------|
| `name.typ` | Typst template for the PDF | yes |
| `name.header.md` | Front-matter template with all keys; contains `template: name` | no |
| `name.css` | Look in the editor (reserved; the editor does not read it yet) | no |

The set `memo` ([MarkdownOffice-set-memo](https://github.com/jcmx9/MarkdownOffice-set-memo)), the default layout, ships with the app. Your own sets live as `name.typ` in the folder `~/Documents/Markdown Office/Vorlagen/` (Windows: `Documents\Markdown Office\Vorlagen\`) and take precedence over a bundled set of the same name. Names use `a-z`, `0-9`, `_` and `-`.

A note picks its set with `template: name` in the front matter; without the key, `memo` applies. `template: ./offer.typ` uses a single template relative to the note. `--template` overrides the key. An unknown set stops the build with a message.

A template is Typst code and can read your files; only use templates you trust.

Your own template gets the same inputs (`sys.inputs`) as `memo.typ`, among them `mdo`, the app's pipeline folder, and `version`, so it can use the pipeline's building blocks:

```typst
#import sys.inputs.mdo + "/lib/markdown.typ": preprocess
#import sys.inputs.mdo + "/vendor/cmarker/lib.typ" as cmarker
#cmarker.render(preprocess(read(sys.inputs.source)))
```

`memo.typ` handles images with its own function (`safe-image`); a template without it stops at a missing image.

## PDF/A, source and metadata

- **PDF/A-3b**, all fonts embedded.
- The **Markdown source** is attached to the PDF (under its file name, without a local path) and can be extracted again, e.g. with `mutool extract file.pdf`. Disable with `embed_source: false` or `--no-source`.
- The **PDF date** is the note's `date:`, otherwise the source's modification time, never the build time.
- **Further metadata:** title and subject from `title:`, author only from `author:`, language from `lang:`; the keywords contain the client and “Markdown Office <version>”. Typst records itself as the creating program.

## Fonts and licences

Preview and PDF use the same bundled fonts: Adobe's variable Source fonts (Source Serif 4, Source Sans 3, Source Code Pro) and, for characters without a Source glyph, Noto Emoji and Noto Sans Symbols 2, all under the SIL Open Font License 1.1. Typst (Apache-2.0) and the Typst packages cmarker (MIT), mitex (Apache-2.0) and mmdr (MIT) carry their own licences. The licence texts ship with the app in the pipeline folder under `licenses/` (`typst/` with LICENSE and NOTICE, `fonts/`, `packages/`; macOS: `Markdown Office.app/Contents/Resources/pipeline/licenses/`, Windows and Linux: `resources/pipeline/licenses/` in the install folder). Versions and checksums are in `scripts/pipeline-assets.json`.

## Development

Prerequisites: Node.js ≥ 22.12 (CI: 24), npm, Git; for the pipeline tests `pdftotext` (poppler) or `mutool` (mupdf), for the equivalence test poppler.

```bash
git clone git@github.com:jcmx9/MarkdownOffice.git
cd MarkdownOffice
npm ci
npm run assets                    # Typst, fonts, packages, set memo; then the dev layout
npm run dev                       # app with hot reload (macOS: menu bar shows "Markdown Office", via postinstall)
npm run lint && npm run typecheck
npm test                          # unit tests (Vitest, including pipeline/*.test.mjs)
npm run test:e2e                  # end-to-end (Playwright + Electron)
bash pipeline/tests/test-pdf.sh          # pipeline: PDFs of the test notes and the interface (macOS/Linux)
bash pipeline/tests/test-equivalence.sh  # pipeline: set memo against the reference PDFs
npm run dist                      # package for the current system into dist/
bash scripts/test-bootstrap.sh    # install, update, uninstall with the package from dist/
```

`npm run assets` downloads the pinned pipeline assets into `build/pipeline-assets/`, verifies every file against its SHA-256 checksum from `scripts/pipeline-assets.json` and builds the development layout `build/pipeline-dev/`, which matches the app's packaged layout. On Windows, `pipeline/tests/test-windows.ps1` checks the pipeline (Windows PowerShell 5.1).

In development the app uses its own app data folder `Markdown Office Dev` next to `Markdown Office`, so an installed app and the development build never share settings, session or the single-instance lock. `MDO_USER_DATA` (tests) overrides the folder.

## Project structure

```
src/main/       main process: files, export, session, menu, window
src/preload/    secure bridge window.mdo
src/renderer/   editor (CodeMirror 6), tabs, UI
src/shared/     shared types and IPC channels
pipeline/       Markdown → PDF/A: cli.js, build.sh, convert.ps1, lib/markdown.typ, tests
scripts/        assets, signing, installation, release
tests/          unit and end-to-end tests of the editor
docs/           release workflow
```

## Versioning

[CalVer](https://calver.org/) in the format `YY.M.MICRO`. The single source is `package.json`; [docs/github-release.md](docs/github-release.md) describes the workflow.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please do not report security vulnerabilities as public issues, see [SECURITY.md](SECURITY.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT – see [LICENSE](LICENSE). Bundled fonts, Typst and Typst packages are under their own licences (see [Fonts and licences](#fonts-and-licences)).
