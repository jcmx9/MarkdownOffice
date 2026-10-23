# Markdown Office

> Calm Markdown editor with a built-in PDF/A pipeline: the note already looks like the PDF while you type.

**Version:** 26.10.3-dev.0 · [Deutsch](README.md)

[![CI](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)

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

### Right-click "Markdown-PDF"

The installation also adds a file-manager entry "Markdown-PDF": right-click a Markdown file and the PDF appears next to it, without starting the editor. It calls the `markdown-office` command, so the same output name applies (ISO prefix from `date:`), and the PDF then opens in the default viewer.

| System | Where | What gets created |
|--------|-------|-------------------|
| macOS | Finder → right-click → Quick Actions → Markdown-PDF (only for `.md`/`.markdown`) | Quick Action `~/Library/Services/Markdown-PDF.workflow` |
| Linux | File manager → right-click → Open With → Markdown-PDF; in Nautilus and Nemo also under Scripts | `~/.local/share/applications/markdown-office-pdf.desktop`, with Nautilus/Nemo present `~/.local/share/nautilus/scripts/Markdown-PDF` or `…/nemo/scripts/Markdown-PDF` |
| Windows | Explorer → right-click on `.md`/`.markdown` → Markdown-PDF (Windows 11: under "Show more options") | Registry key `HKCU\Software\Classes\SystemFileAssociations\.md\shell\Markdown-PDF` (and `.markdown`), helper script `markdown-pdf.js` in the install folder |

On macOS and Linux the entries call `~/.local/share/markdown-office/markdown-pdf.sh`. The result appears as a notification (macOS: Notification Centre, Linux: `notify-send` if available); several selected files are converted one after the other, other files are skipped. On Windows the entry starts without a console window (via `wscript.exe`; an error appears as a message box), which needs Windows Script Host to be enabled. The output of the last run is in `markdown-pdf.log` next to the script. On Linux the editor and "Markdown-PDF" both claim the type `text/markdown`; so that a double-click still opens the note in the editor instead of converting it, the installation sets Markdown Office as the default application for Markdown in `~/.config/mimeapps.list`, only if none is chosen there yet.

What of this was created is listed in `.mdo-file-manager` next to the install marker; update and uninstall replace or remove exactly that. An entry of the same name that does not come from Markdown Office is left untouched.

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

Only what the installation created is removed (recognised by its install marker): app, command, Start-menu or desktop entry and the file-manager entry "Markdown-PDF" (with the folders and registry keys created only for it). Documents, your own template sets, snippets and settings are left untouched.

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

The preview uses the PDF's bundled fonts; if a font file is missing, it falls back to system fonts. Paragraphs without the cursor are set like the PDF: with Typst's hyphenation and line breaking, justified with the same word spacing and with the PDF's typographic characters. The paragraph with the cursor shows the typed text and wraps like the browser. The preview shows quotes per `lang`, the apostrophe, en and em dashes and the ellipsis as the PDF does; code, formulas, HTML and tables stay raw. The PDF currently also substitutes in table cells and indented code (a pipeline quirk, to be fixed separately). Links in `<…>` show without the angle brackets; the line with the cursor shows the typed characters, and the note's text stays unchanged. The preview (and Present) draws top-level Mermaid blocks (` ```mermaid `) as diagrams, with the same mmdr plugin and the same values as the set's PDF; a block inside a list or a quote, the block with the cursor, the code view and a diagram that cannot be drawn show the source. A set without `mermaid:` in `name.preview.yaml` draws no diagrams. Mod+E saves the note and exports it with the pipeline; the PDF lands next to the note (named as by the [command](#the-markdown-office-command)) and opens in the default viewer.

Font, sizes, text width and the blocks above and below the text (such as a letter's sender, address, subject and closing) come from the note's set in the preview: from `name.css` and `name.preview.yaml` (see [Template sets](#template-sets) and TEMPLATES.md). Sets without these files look like `memo`. At 100 % zoom the preview matches the paper size (11 pt is 11 pt, 165 mm is 165 mm); zoom and the Present factor scale all print sizes together.

| Shortcut | Action |
|----------|--------|
| Mod+N | New note in the default folder (`YYYY-MM-DD_HH-mm-ss.md`), starting with the YAML header of the set `memo`; the file is only created once you type. Without an open note the button „Neues Memo …“ does the same |
| Mod+Shift+N | Neu aus Vorlage …: pick a template set (`memo` first and preselected, with a profile if any), new note with its YAML header |
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

Right-clicking a tab or the file name in the status line opens a menu with rename, „Im Finder zeigen“ (Windows: „Im Explorer zeigen“, Linux: „Im Dateimanager zeigen“), export PDF and close tab. „Im Finder zeigen“ is also in the „Datei“ menu and shows the active note in the system's file manager (a new note is saved first; not while presenting). The status line shows the clock on the left and the switches `Editor | Präsentation` and `Code | Vorschau`; clicking the other side switches. Next to them, `Gliederung` and `YAML` turn the outline (Mod+Shift+O) and the Preview's YAML header (Mod+Shift+H) on or off; a highlighted toggle is on. `YAML` is greyed out when the note has no header or the Code view is active (the header is always visible there). In Present, clicking „Code“ (like Mod+Shift+M) ends Present and shows the Code view. Next to the file name stands the note's set (`template:`), red when the YAML header has errors (see [Check YAML](#front-matter)).

### Settings

„Einstellungen …“ (macOS Cmd+, in the app menu, otherwise Ctrl+, in the „Datei“ menu) opens the dialog: default folder for new notes, snippet folder, font factor in presentation mode and the default for the YAML header in the preview (as YAML or as title block) as well as spelling (switch, automatic dictionary updates, own words). A read-only status block shows the version of the pipeline and of the bundled Typst. The button „Vorlagen-Ordner öffnen“ opens the folder for your own template sets (`~/Documents/Markdown Office/Vorlagen/` or `MDO_TEMPLATES`, see [Template sets](#template-sets)) in the file manager and creates it when it is missing. Changing the default folder never moves or deletes files. The dialog names values it did not take after saving; the previous value stays in effect for them.

### Outline

A sidebar on the right lists the note's H1 and H2 headings. Entries read as a list: a chapter with sub-chapters shows an arrow, an entry without sub-chapters sits flush, with nothing in front. The highest heading level in the note gets the top-level look, so a note with only H2 headings shows them as top-level entries. The arrow folds or unfolds the section in the text and in the outline at the same time; „fold/unfold all“ acts on both as well. A page break or comment at the end of a section belongs to the next heading. Clicking an entry jumps to the heading in the text; the focus stays in the editor. Long headings end in „…“; hovering shows the full text. The width can be dragged with the mouse at the outline's left edge (double-click: default width). In the editor it is remembered; in Present the outline starts at the default width every time and a dragged width lasts only until Present ends. Mod+Shift+O shows or hides the outline; the setting is remembered separately for the editor and Present.

### Snippets

Type `:` at the start of a line or after a space, plus at least one letter (e.g. `:mee`), and the snippet list appears; Ctrl+Space after a single `:` shows all of them. On macOS, Ctrl+Space may be taken by the input-source switch; then just type `:` and a letter. Enter or Tab inserts the snippet, Tab / Shift+Tab jump through the fields. Prose such as `Hinweis:`, `10:30` or `:D` triggers nothing.

Inside a snippet, Esc first leaves field mode; in presentation mode only a further Esc leaves Present. Header snippets (`:meeting`, `:telefonnotiz`) keep the YAML header open in presentation mode while a field inside it is active; afterwards it collapses into the title block. Follow-up lines of a multi-line snippet take over the indentation of the current line, and tabs at the start of a template line become two spaces.

| Snippet | Content |
|---------|---------|
| `:meeting` | Meeting note with header, participants, agenda, minutes and tasks |
| `:telefonnotiz` | Phone note |
| `:aufgabe` | Task line `- [ ] Aufgabe – Name, bis Datum` |
| `:newpage` | Page break `<!-- pagebreak -->` |

The menu **Einfügen → Vorlage …** turns a note from elsewhere into a note of a template set. With the same picker as „Neu aus Vorlage …“ it asks for the set (`memo` comes first and is preselected) and, when its header has `profile:`, for the profile. Then:

- Without a YAML header the set's front-matter template (`name.header.md`, see [Template sets](#template-sets)) goes to the top of the note: every key with its default value, one line per key with a short comment. The cursor then sits in the title.
- With a YAML header both are merged: existing keys keep their values, the set's missing keys are added at the bottom of the header with default value and comment; nothing is duplicated, existing comments and the order stay unchanged.
- `template:` gets the chosen set (in place, else added at the bottom), and `profile:` the chosen profile likewise.
- `date:` is checked: valid are `YYYY-MM-DD`, `D.M.YYYY` (also `DD.MM.YYYY`) or empty. Another notation brings up a notice with the button „In YYYY-MM-DD ändern“ (today's date); the date only changes on that click.

The merge is a single undo step, the date change one of its own; the note's line endings (LF/CRLF) and BOM are kept. When the header already has every key of the set, a short notice says there was nothing to add.

Your own snippets are files `name.tpl.md` in the snippet folder (default `~/Documents/Markdown Office/Snippets/`, setting „Snippet-Ordner“). Your own snippet with the same name replaces the built-in one. New files are picked up the next time the window gets focus. Supported syntax: `$1`, `${1:default}`, `$0` (final position) and `$CURRENT_YEAR`, `$CURRENT_MONTH`, `$CURRENT_DATE`, `$CURRENT_HOUR`, `$CURRENT_MINUTE`, `$CURRENT_SECOND` (also in the form `${CURRENT_YEAR}`). `\$` gives a literal `$`, `\\` a backslash, and inside a default `\}` gives a literal `}`.

### Spell checking

The switch **Bearbeiten → Rechtschreibprüfung** (also in the settings) checks spelling in the editor. Nothing is checked in Present, in code blocks or in the front matter. A right click on an underlined word offers suggestions and „Zum Wörterbuch hinzufügen“; own words can be removed again in the settings.

The language comes from the note's `lang:`, otherwise from the system language. macOS uses the system spellchecker; macOS manages languages and dictionaries under System Settings → Keyboard → Text Input. On Windows and Linux checking works fully offline with the bundled dictionaries de-DE and en-US. Updates and further languages come only from the repository `jcmx9/MarkdownOffice-dictionaries`, and every file is verified against its checksum. At start the editor looks for new dictionaries at most once a day (can be switched off in the settings; „Jetzt prüfen“ asks at once). An updated dictionary becomes active after a restart, a newly downloaded language at once. If the dictionary for a note's `lang:` is missing, a notice asks whether to download it – only while editing with checking on, never in the presentation.

Licences: the German dictionary (from Chromium's `de-DE-3-0.bdic`, built from `de_DE_neu` by "Lantol") is under the LGPL; the licence text and the README ship with it. The English dictionary is based on SCOWL and is under its permissive licence (Kevin Atkinson, among others). Both files are plain data kept separate from the application; the texts are in `licenses/dictionaries/` in the pipeline folder.

## The markdown-office command

```bash
markdown-office note.md                      # PDF next to the note
markdown-office note.md target.pdf           # exactly this path
markdown-office --no-source note.md          # without source in the PDF
markdown-office --soft-breaks note.md        # line breaks become spaces
markdown-office --template my-set note.md    # another template set
markdown-office --help                       # all options
markdown-office --app [note.md …]            # open the editor
markdown-office validate note.md             # check the YAML header
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

### Check YAML

```bash
markdown-office validate note.md                   # print findings, change nothing
markdown-office validate note.md --fix             # write the corrections
markdown-office validate note.md --add-missing     # add the set's missing keys
markdown-office validate note.md --json            # result as JSON
```

The command checks the YAML header with the same rules as **Bearbeiten → „YAML prüfen …“** in the editor (see [Front matter](#front-matter)). `--fix` writes the suggested corrections (never typo guesses), `--add-missing` appends the set's missing keys; both change only the lines concerned, line endings and BOM stay. Exit code: `0` no errors (warnings and hints do not count), `1` errors or an unclosed header, `2` wrong usage or the file cannot be read or written.

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

A YAML block at the start of the file controls individual documents. All keys are optional; the front-matter template of the set `memo` (menu **Einfügen → Vorlage …**) contains every key with its default value and a comment.

**Quotes:** free text goes in quotes (`title: "Kick-off: relaunch"`), fixed values go without (`lang: de`, `toc: auto`, `true`, `13mm`). Without quotes YAML misreads text containing `: ` or ` #` (everything from `#` on becomes a comment), words like `no`, `yes`, `on`, `off` (booleans), numbers with a leading zero like `01067` (becomes 1067) and text starting with `[`, `{`, `*`, `&`, `!`, `@`, `` ` ``, `|`, `>` or `%`. `""` explicitly means empty. A date like `date: 2026-10-20` may stay unquoted.

```yaml
---
title: "Kick-off relaunch"   # title: title block, header, PDF title
subtitle: "Workshop"         # subtitle
toptitle: "Example Ltd"      # top title, small and letter-spaced above the title
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
| `toptitle` | text | — | Small, letter-spaced line above the title, e.g. client or company; also first in the footer and in the PDF keywords. |
| `author` | text or `[A, B]` | — | Line below the title: “date · author”. |
| `date` | `2026-10-13` or `13.10.2026` | — | Date bottom right (per `lang`), ISO prefix on the file name, fixed PDF date. An unrecognised date is shown as is, without a prefix. |
| `isodate_praefix` | `true` / `false` | `true` | ISO prefix on the file name when `date` is set. |
| `lang` | `de`, `en`, … | `de` | Language: date, hyphenation, quotes, labels (Seite/Page, Inhalt/Contents, Aufgabe/Task, callouts). |
| `toc` | `auto` / `true` / `false` | `auto` | Table of contents (H1 + H2 only); `auto` above five H1/H2. |
| `h1_break` | `auto` / `true` / `false` | `auto` | Every chapter (`#`) on a new page; `auto` as for `toc`. |
| `header` | text | — | Fixed header text from page 1 instead of the running chapter. |
| `print_filename` | `true` / `false` | `true` | Show/hide the bottom-left entry (file name or “top title · title”). |
| `watermark` | text | — | Diagonal light-grey watermark beneath everything. |
| `logo` | file `.svg`/`.png`/`.jpg`/`.jpeg` | no logo | Logo in the header, only when set; see [Logo](#logo). |
| `logo-height` | `15mm`, `1.5cm`, `40pt`, … | `13mm` | Maximum logo height (at most 25 mm); the logo keeps its proportions and is at most 60 mm wide. |
| `profile` | name or `.yaml` path | no profile | Sender profile: a name looks for `<name>.yaml` in `profiles/` next to the note, in `Vorlagen/<set>/profiles/`, in `Vorlagen/profiles/` and in the set; a path to a `.yaml` file is relative to the note. Only for sets that use profiles (e.g. din5008a); not found: error, no PDF. |
| `embed_source` | `true` / `false` | `true` | Embed the Markdown source as an attachment. |
| `hard_breaks` | `true` / `false` | `true` | Every line break stays one (as typed in the editor), even without an entry. Only `false` switches to CommonMark: a single break becomes a space. |

**Rules:** empty values (`subtitle: ""` or just `subtitle:`) are ignored, never an error. Yes/no keys accept `true`/`false`, `yes`/`no`, `on`/`off` in any case; an unrecognised value produces a warning and the default applies. Comments (`# …`) may stand on their own lines and after values. In paths (`logo:`, images) `~`, `$VAR`, `${VAR}` and `%VAR%` are expanded.

**Check YAML:** the menu **Bearbeiten → „YAML prüfen …“** (Mod+Shift+Y) checks the note's header against the rules of the pipeline and of the chosen set: invalid values (for example `toc: ja`, `date: 20.10.26`, an unknown set or a `profile:` that is not found), repeated keys and presumed typos. Extra keys of your own are always allowed. The dialog shows every finding with a suggested fix; „Übernehmen“ writes the ticked fixes as **one** undo step, everything else in the note stays byte for byte. „Fehlende ergänzen“ appends the set's keys the header does not have yet (off by default). Without findings „YAML in Ordnung“ appears. On export the app checks the header silently first; with errors a notice „YAML hat n Fehler“ offers „Prüfen …“, and the export runs anyway. The same goes for „Einfügen → Vorlage …“. When the note names a set (`template:`), the status line shows its name next to the file name; for this the app checks the header silently in the background (on opening, on switching tabs and half a second after the last keystroke). With errors the name turns red (warnings and hints do not count; a set that is not installed or a profile that is not found is an error too), the tooltip gives the count („memo – 2 Fehler im YAML-Kopf“); a click opens „YAML prüfen …“. Which keys and values a set expects is described in its `name.schema.yaml`, see [TEMPLATES.md](TEMPLATES.md). The same check exists in the terminal: [`markdown-office validate`](#check-yaml).

### Logo

A logo appears **only** when `logo:` is set. Without the key, with an empty value or commented out, the header has no logo.

| Value of `logo:` | Looked up |
|------------------|-----------|
| `company.svg`, `logos/company.svg` | 1. in the note's folder (or `MDO_BASE_DIR`), 2. in the home folder (`~`, Windows `%USERPROFILE%`), 3. in the templates folder (`~/Documents/Markdown Office/Vorlagen/` or `MDO_TEMPLATES`), 4. in the app's pipeline folder – the first existing file wins |
| `/path/company.svg`, `C:\Logos\company.png` | exactly this file |
| `~/company.svg`, `$HOME/company.svg`, `%USERPROFILE%\company.svg` | exactly this file, variables expanded |

- Allowed are `.svg`, `.png`, `.jpg` and `.jpeg`.
- If nothing is found (or the extension is wrong, or it is a web address), the PDF is built **without a logo**, with a note, never with an error.
- **Your own logo for all documents:** put it in the templates folder once (`~/Documents/Markdown Office/Vorlagen/company.svg`) and write `logo: company.svg` in each note. A file of the same name next to the note takes precedence, e.g. for a client logo.
- The app ships the Markdown Office mark as `logo.svg`: `logo: logo.svg` finds it as long as no `logo.svg` of your own lies next to the note, in the home folder or in the templates folder.

## Markdown in the PDF

CommonMark works as usual: `*italic*`, `**bold**`, `` `code` ``, links, lists, quotes, footnotes, tables. On top of that:

- **Tasks:** a list made only of tasks (`- [ ] Sitemap erstellen – Ben Probe, bis 17.10.`) becomes the table *Task · Owner · Due · Status* (German *Aufgabe · Wer · Bis · Status*).
- **Callouts:** `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` and the German keywords `[!INFO]`, `[!TIPP]`, `[!WICHTIG]`, `[!HINWEIS]`, `[!ACHTUNG]`.
- **Typography:** quotes per language, `--` and `---` as en and em dash, `...` as ellipsis, non-breaking spaces (`z. B.`, `5 %`), `==highlight==`.
- **Page break:** `<!-- pagebreak -->` or `\newpage` on a line of its own.
- **Images:** `![Caption](image.png){width=50%}`; a missing image never stops the export, remote images are skipped offline.
- **Formulas** in LaTeX syntax (`$…$`, `$$…$$`), **code** with syntax highlighting, **definition lists** and **Mermaid diagrams** (drawn offline).

## Template sets

A template set defines how a document looks. It consists of up to four files sharing one name:

| File | Purpose | Required |
|------|---------|----------|
| `name.typ` | Typst template for the PDF | yes |
| `name.header.md` | Front-matter template with all keys; contains `template: name` | no |
| `name.css` | Look of the preview in the editor (font, sizes, text width) | no |
| `name.preview.yaml` | Blocks above and below the text in the preview (head and foot) | no |

The set `memo` ([MarkdownOffice-set-memo](https://github.com/jcmx9/MarkdownOffice-set-memo)), the default layout, and the set `din5008a` ([MarkdownOffice-set-din5008a](https://github.com/jcmx9/MarkdownOffice-set-din5008a), DIN 5008 Form A letters) ship with the app. Your own sets live as `name.typ` or as a folder `name/name.typ` (e.g. a cloned set repo) in the folder `~/Documents/Markdown Office/Vorlagen/` (Windows: `Documents\Markdown Office\Vorlagen\`) and take precedence over a bundled set of the same name. Names use `a-z`, `0-9`, `_` and `-`.

New notes start with a set's header: Mod+N with `memo`, **Datei → Neu aus Vorlage …** (Mod+Shift+N) with a set chosen from all sets (`memo` first and preselected, then bundled and your own alphabetically; each with a hint taken from the first `# …` comment line of its header file). The editor reads `name.header.md` next to the chosen `name.typ`: for your own set as a file that is `Vorlagen/name.header.md`, as a folder `Vorlagen/name/name.header.md`. Without that file the note starts with a header that only contains `template: name`. **Einfügen → Vorlage …** merges the same header into an existing note (see [Snippets](#snippets)). When the header has a `profile:` key, the picker also offers the existing profiles (see [Letters](#letters-din5008a)).

A note picks its set with `template: name` in the front matter; without the key, `memo` applies. `template: ./offer.typ` uses a single template relative to the note. `--template` overrides the key. An unknown set stops the build with a message.

A template is Typst code and can read your files; only use templates you trust.

Your own template gets the same inputs (`sys.inputs`) as `memo.typ`, among them `mdo`, the app's pipeline folder, and `version`, so it can use the pipeline's building blocks:

```typst
#import sys.inputs.mdo + "/lib/markdown.typ": preprocess
#import sys.inputs.mdo + "/vendor/cmarker/lib.typ" as cmarker
#cmarker.render(preprocess(read(sys.inputs.source)))
```

`memo.typ` handles images with its own function (`safe-image`); a template without it stops at a missing image.

How to write your own set (all inputs, the elements to render, PDF/A requirements, a working skeleton) is described in [TEMPLATES.md](TEMPLATES.md).

## Letters (din5008a)

The set `din5008a` sets letters to DIN 5008 Form A with a sender profile, vCard QR code and signature. A minimal note:

```markdown
---
template: din5008a
profile: beispiel
x-to:
  - Beispiel GmbH
  - Frau Muster
  - Musterstraße 1
  - 12345 Musterstadt
x-subject: Anfrage zum Angebot
x-closing: Mit freundlichen Grüßen
---

Sehr geehrte Frau Muster,

vielen Dank für Ihr Angebot.
```

**Datei → Neu aus Vorlage …** (Mod+Shift+N) with the set `din5008a` starts a letter: the picker offers the sender profiles it finds (your own from `Vorlagen/din5008a/profiles/` and `Vorlagen/profiles/` plus the set's example profiles, alphabetically), and the chosen profile then stands under `profile:` in the header. Without a profile found, the header template's value stays.

Your own sender profiles live per set as `~/Documents/Markdown Office/Vorlagen/din5008a/profiles/<name>.yaml` (Windows: `Documents\Markdown Office\Vorlagen\din5008a\profiles\<name>.yaml`); the folder `Vorlagen/din5008a/` needs no `din5008a.typ` for this and does not shadow the bundled set. Profiles in `Vorlagen/profiles/` still apply to all sets. On export the first profile found wins: `profiles/` next to the note, then `Vorlagen/<set>/profiles/`, then `Vorlagen/profiles/`, then the set's example profiles. All keys, profile fields and options are described in the README of the set repository MarkdownOffice-set-din5008a.

In the profile the sender address consists of `street`, `zip` (postal code, in quotes: `zip: "01067"`, otherwise YAML reads the number 1067), `city` and optionally `country` (empty means Germany). The PDF prints `<zip> <city>` on one line; in the vCard QR code postal code, city and country go into their own address fields. Older profiles with only `city: 33609 Bielefeld` print unchanged; for the QR code the set splits off a leading four- or five-digit postal code.

**Datei → Profil anlegen …** creates your own profile: in a note with `template: din5008a` (or another set with an example profile) the editor asks for a name (`a–z`, `0–9`, `-`, `_`), copies the set's example profile with its companion files to `Vorlagen/<set>/profiles/<name>.yaml` (`beispiel-unterschrift.svg` becomes `<name>-unterschrift.svg`, `signature:` points to the copy), sets `profile: <name>` in the note and opens the YAML file as a tab for editing (Code view, no spell checking, no PDF export). Existing files are never overwritten: if the name is taken, the editor says so and changes nothing.

## PDF/A, source and metadata

- **PDF/A-3b**, all fonts embedded.
- The **Markdown source** is attached to the PDF (under its file name, without a local path) and can be extracted again, e.g. with `mutool extract file.pdf`. Disable with `embed_source: false` or `--no-source`.
- The **PDF date** is the note's `date:`, otherwise the source's modification time, never the build time.
- **Further metadata:** title and subject from `title:`, author only from `author:`, language from `lang:`; the keywords contain the top title (`toptitle:`) and “Markdown Office <version>”. Typst records itself as the creating program.

## Fonts and licences

Preview and PDF use the same bundled fonts: Adobe's variable Source fonts (Source Serif 4, Source Sans 3, Source Code Pro) and, for characters without a Source glyph, Noto Emoji and Noto Sans Symbols 2, all under the SIL Open Font License 1.1. Typst (Apache-2.0) and the Typst packages cmarker (MIT), mitex (Apache-2.0) and mmdr (MIT) carry their own licences. The licence texts ship with the app in the pipeline folder under `licenses/` (`typst/` with LICENSE and NOTICE, `fonts/`, `packages/`; macOS: `Markdown Office.app/Contents/Resources/pipeline/licenses/`, Windows and Linux: `resources/pipeline/licenses/` in the install folder). Versions and checksums are in `scripts/pipeline-assets.json`. For the preview's paragraph setting the app contains code ported from Typst and hypher, the German and English hyphenation patterns and the npm package `linebreak` with Unicode data; the same mmdr WebAssembly (MIT, built on mermaid-rs-renderer, MIT) that draws the PDF also runs in the app's preview; their notices and licence texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which ships with the app (macOS: `Markdown Office.app/Contents/Resources/`, Windows and Linux: `resources/` in the install folder).

## Development

Prerequisites: Node.js ≥ 22.12 (CI: 24), npm, Git; for the pipeline tests `pdftotext` (poppler) or `mutool` (mupdf), for the equivalence test poppler.

```bash
git clone git@github.com:jcmx9/MarkdownOffice.git
cd MarkdownOffice
npm ci
npm run assets                    # Typst, fonts, packages, set memo; then the dev layout
npm run dev                       # app with hot reload (macOS: menu bar shows "Markdown Office", via postinstall)
npm run build:cli                 # build the markdown-office command (src/cli/) into out/cli/cli.js
npm run lint && npm run typecheck
npm test                          # unit tests (Vitest, tests/unit)
npm run test:e2e                  # end-to-end (Playwright + Electron; locally only a simulated fullscreen)
bash pipeline/tests/test-pdf.sh          # pipeline: PDFs of the test notes and the interface (macOS/Linux)
bash pipeline/tests/test-equivalence.sh  # pipeline: set memo against the reference PDFs
npm run dist                      # package for the current system into dist/
bash scripts/test-bootstrap.sh    # install, update, uninstall with the package from dist/
bash scripts/test-file-manager.sh # "Markdown-PDF" file-manager entry (generators, no build needed)
```

`npm run assets` downloads the pinned pipeline assets into `build/pipeline-assets/`, verifies every file against its SHA-256 checksum from `scripts/pipeline-assets.json` and builds the development layout `build/pipeline-dev/`, which matches the app's packaged layout. On Windows, `pipeline/tests/test-windows.ps1` checks the pipeline (Windows PowerShell 5.1).

The `markdown-office` command is TypeScript (`src/cli/`, shared logic in `src/core/`) and is bundled into one file. `npm run dev` does not rebuild it: after changes in `src/cli/` or `src/core/`, `npm run build:cli` (or `npm run build`) refreshes the CLI in the dev layout.

In development the app uses its own app data folder `Markdown Office Dev` next to `Markdown Office`, so an installed app and the development build never share settings, session or the single-instance lock. `MDO_USER_DATA` (tests) overrides the folder.

## Project structure

```
src/main/       main process: files, export, session, menu, window
src/preload/    secure bridge window.mdo
src/renderer/   editor (CodeMirror 6), tabs, UI
src/shared/     shared types and IPC channels
src/core/       shared logic for app, CLI and later MCP (no Electron, no Node modules)
src/cli/        the markdown-office command (TypeScript, bundled to pipeline/cli.js in the package)
pipeline/       Markdown → PDF/A: build.sh, convert.ps1, lib/markdown.typ, tests
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

Copyright © 2026 jcmx9. Markdown Office is free software under the **GNU Affero General Public License, version 3 or later** (AGPL-3.0-or-later), see [LICENSE](LICENSE). You may use the program, commercially too, modify it and pass it on. Whoever passes on a modified version or offers it as a network service must publish its complete source code under the same licence. For use outside the AGPL, e.g. in a closed product, a separate commercial licence is possible; ask via an issue in the repository. The program comes without any warranty.

Versions up to and including 26.10.0 were released under the MIT licence; from 26.10.1 on the AGPL applies. The template sets (`memo`, `din5008a`) stay under MIT, so the documents they produce carry no obligations. Bundled fonts, Typst and Typst packages are under their own licences (see [Fonts and licences](#fonts-and-licences)).
