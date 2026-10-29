# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [26.10.10] - 2026-10-29

### Fixed
- Windows export: `h1_break` was ignored (the front matter reader skipped keys with digits), so `h1_break: false` still broke before every chapter whenever `auto` would

## [26.10.9] - 2026-10-29

### Fixed
- Preview/Present: Enter at the start of a paragraph directly under a heading seemed to do nothing (the new blank line collapses at the heading like in the PDF, the cursor stayed on the text). It now opens a new empty paragraph above with the cursor in it

### Changed
- Present always starts with focus on, like slides; „Fokus“ can still turn it off for that Present. Edit keeps its remembered setting
- Present: a click in the outline only jumps (the cursor moves, so focus follows), without a blinking caret or revealed Markdown, under the plain mouse arrow; Page Down/Page Up keep working. A click into the text edits as before
- Code view always shows the full source: focus does not apply there and its switch reads off and rests (Mod+Shift+F explains this in a toast); the `YAML` switch reads on, also when the Preview hides the header. The focus choice is kept and applies again in Preview

## [26.10.8] - 2026-10-28

### Added
- Settings: „Ebenen in der Gliederung“ sets how many heading levels the outline lists (1–6, default 2 = H1 and H2), counted from the note's highest level; applies at once in Edit and Present, deeper levels nest under their section. Focus mode and the PDF's table of contents are unchanged

### Changed
- Focus works like slides: every chapter heading, the path of headings down to the section with the cursor and only that section's own text (no sibling or sub-sections). Page Down/Page Up step to the next/previous section with text (presenter remotes send these keys), skipping headings without own text; a new section scrolls its chapter to the top
- Present uses the preview's text width (the set's measure), scaled by the Present factor like the font, instead of its own narrower 70ch column: lines break in Present as in the preview and the PDF

## [26.10.7] - 2026-10-27

### Added
- Tables are edited in place in Preview and Present: they never switch to their Markdown there (only the code view shows it). A click makes just that cell editable, showing its own Markdown; Tab/Shift+Tab move to the next/previous cell, Enter to the cell below, Esc leaves the table. A typed `|` is escaped as `\|`, line breaks become spaces. Every input changes only that cell's text, so the rest of the note stays byte-identical; undo, the formatting toolbar and its table commands work on the edited cell. Cmd/Ctrl+click on a link in a cell still opens it
- App update in the app: at start (at most once a day, switch „Nach Updates suchen“ in the settings) and via „Nach Updates suchen …“ (macOS app menu, else Hilfe) the app looks for a newer stable release on GitHub. A notice offers „Jetzt aktualisieren“, „Was ist neu?“, „Später“ and „Diese Version überspringen“. „Jetzt aktualisieren“ downloads the bootstrap script of exactly that tag, quits through the normal close path and lets a detached helper run it once the app has ended (log `update.log` in the app data folder), then starts the app again; the next start reports the result. Only for bootstrap installs (install marker); the app is unsigned, so the bootstrap's verified swap replaces electron-updater
- Focus mode (owner, 2026-10-27): only the chapter headings (H1), the headings of the chapter with the cursor and the text of the section with the cursor stay visible, so an audience cannot read ahead. Switch `Fokus` in the status line and in Present's info line, Ansicht → „Fokus ein/aus“, Mod+Shift+F; remembered per mode. Moving the cursor (click, outline, search) opens a section. Decorations only: the file stays byte-exact, user folds are untouched, the PDF is unaffected
- Typing over selected text wraps it: `*` once, twice or three times gives `*Text*`, `**Text**`, `***Text***`; `~~` and `==` (two presses, as in Markdown) give `~~Text~~` and `==Text==`. The selection stays on the text, every press is an undo step; without a selection, in code and formulas the keys type as usual
- Settings: block „Standardprogramm“ shows whether `.md` files open with Markdown Office, and „Als Standard für Markdown festlegen“ makes it the default: macOS via Launch Services, Linux via `xdg-mime`; on Windows (where no program may set itself) it registers the app for `.md`/`.markdown` and opens Settings → Default apps at Markdown Office
- Windows install (`bootstrap.ps1`) registers Markdown Office as a program for `.md` and `.markdown` (ProgID, „Öffnen mit“, Default-apps list, below HKCU); uninstall removes exactly these keys

### Fixed
- Windows and Linux: the menu bar comes back after leaving Present. Electron's leave restored the bar to its hidden state from the enter, so it stayed gone until the app restarted

## [26.10.6] - 2026-10-26

### Added
- Links open with Cmd+click (macOS) or Ctrl+click (Windows, Linux) in the system's browser or mail program, in Code, Preview, Present and in rendered table cells; inline, reference and `<auto>` links and bare URLs. Only `http`, `https` and `mailto` (checked again in main); a plain click still places the cursor. While the key is held the pointer turns into a hand over a link
- Find and replace: Bearbeiten → „Suchen …“ (Mod+F), „Ersetzen …“ (Cmd+Alt+F on macOS, Ctrl+H elsewhere), „Weitersuchen“/„Rückwärts suchen“ (Mod+G, Mod+Shift+G). CodeMirror's search panel (`@codemirror/search` 6.7.2, MIT) above the note, German labels, match case, whole word and regular expressions; in every view and in profile tabs. Present only finds. No further keys: CodeMirror's search keymap (Mod+D, Mod+Shift+L, Mod+Alt+G) stays off

### Changed
- The app folder for new notes, own template sets (`Vorlagen/`) and snippets is now `~/Markdown Office` (Windows `%USERPROFILE%\Markdown Office`) instead of the documents folder, in the app, the CLI, build.sh and convert.ps1 alike. An existing `<Documents>/Markdown Office` stays in use while the home one does not exist; nothing is moved. Reason: Windows' controlled folder access silently refused the unsigned app in the (often OneDrive-redirected) documents folder

### Fixed
- A note that cannot be created no longer leaves an empty window without a word: a notice names the folder and the reason (on Windows with a hint at the controlled folder access) and offers the settings

## [26.10.5] - 2026-10-26

### Added
- Edit: the status line shows the zoom on the right with − and +, like Present's info line
- Shortcut for showing the note in the file manager: Cmd+Alt+R on macOS, Shift+Alt+R on Windows and Linux (not Ctrl+Alt, which is AltGr on German layouts); the README names the entry neutrally (the label already follows the system: Finder, Explorer, Dateimanager)
- Editor: formatting toolbar below the tab bar in Edit mode (Code and Preview): H1–H3, bold, italic, strikethrough, highlight, code, bullet/numbered/task list, quote, link (takes a single `http(s)://` URL from the clipboard, read only on that click), table, alert box (Info/Tipp/Wichtig/Hinweis/Achtung, inserting the GFM keyword) and page break. It inserts plain GFM only, nothing set-specific; buttons keep the editor's selection, show the cursor's format as active, and every click is one undo step. Hidden in Present and without a note, greyed out on a profile. Status switch „Leiste“ and Ansicht → „Formatierungsleiste ein/aus“ (Mod+Shift+T), remembered in the session (`toolbar.edit`, default on). Icons: Lucide 1.55.0 (ISC; four derived from Feather, MIT), bundled, listed in THIRD_PARTY_NOTICES.md
- Menu „Format“ with the same commands (no accelerators: CodeMirror's default keys stay), Einfügen → „Tabelle …“ and „Hinweisbox“. Format commands act only on the editor: ignored while a text field has focus, dropped while a dialog is open
- Tables: „Tabelle ▾“ inserts an empty GFM table from a size grid (up to 8 × 10, header row counted); with the cursor in a table it offers row below, column right, delete row and delete column, rewriting only the touched cells (padding and escaped `\|` stay byte-identical). Inline formats and links inside a cell stay within that cell
- Preview: `==highlight==` is shown with the set's background (`--mdo-mark-bg`, default memo's `#fbeab0`, TEMPLATES.md §8), also in table cells; the editor parses it by the pipeline's `marks()` rules

### Changed
- Outline: its width fits the longest title when it is shown and on a switch to or from Present, at most a fifth of the workspace; longer titles end in „…“ with the full title on hover, right-aligned. While shown, the width never follows typing or a tab switch. A dragged width lasts until the outline is shown again (double-click fits it again); the remembered Edit width (`outlineWidth` in the session) is gone
- Editor: the page break (Mod+Enter, Einfügen → Seitenumbruch, toolbar) is no longer inserted in Present, in tables, in fenced or indented code, in HTML blocks or comments, or inside a formula; there it would break the block or land in the code

### Fixed
- Outline: long H2 headings end in „…“ inside the bar and follow a dragged width (the children list never shrank below its longest label, so labels were cut at the edge without „…“); an open hover tip closes when the bar changes size; a click on a heading no longer shifts the outline sideways (the active entry is scrolled into view vertically only, so titles are never cut on the left)
- PDF: indented code blocks (4 spaces or a tab after a blank line, outside lists) keep their straight quotes, `--` and `...`; the pipeline's typography only skipped fenced code. A list item's indented continuation, a lazy paragraph line and a list closed by a heading behave as in CommonMark. The preview's port (`src/core/typography.ts`) mirrors the rule, checked by `pipeline/tests/test-typography.sh`
- Preview: table cells show the PDF's quotes, dashes and ellipses (per `lang`); like the pipeline, the row line is substituted before it is split into cells, so code spans, formulas and rows with HTML stay as typed
- PDF: an image with a title (`![a](bild.svg "Titel")`) is drawn again instead of printed as source: the typography no longer touches link and image destinations with their titles (it made `"Titel"` into `„Titel“`, which is no title), nor `--` in a URL; link reference definitions stay untouched
- PDF: link reference definitions in a row (`[a]: …`, `[b]: … "Titel"`) all work with hard line breaks (the default): the `\` the hard breaks appended turned every definition after the first into text, so `[x][b]` stayed source
- PDF: `==…==` inside an inline formula (`$a == b == c$`) no longer gets `<mark>`: the pipeline's `marks()` skips `$…$` like the typography does, as its comment always said; the editor mirrors the rule, checked by `pipeline/tests/test-marks.sh`

## [26.10.4] - 2026-10-25

### Changed
- Outline: the list sits in the optical centre of the bar (two parts of the free height above, three below) instead of at the top; a list taller than the bar starts at the top and scrolls as before. Expanding or collapsing keeps the clicked entry exactly where it was (also when a collapse at the scroll end shortens the list); the list is placed again only on showing, a note switch, a new bar height or a zoom change, never after a fold or an edit

### Security
- Export: `logo:` takes relative paths only and is looked up in the note's folder (or `MDO_BASE_DIR`), then the profile's folder, then the template's folder; absolute paths, `~`, `$VAR`/`%VAR%` and `..` out are refused with a hint, and the home folder, the templates folder and the pipeline folder are no longer searched. A logo for all documents now lives next to a profile or in a set folder
- Export: images come only from the note's folder and its subfolders (links resolved, no hidden folders); a visibly linked image from elsewhere (`../Steuer/scan.png`, `~/Ausweis.jpg`, an absolute path, a link leading out) is left out with the hint „Bild liegt außerhalb des Notizordners, kommt nicht ins PDF“, so a note someone sent cannot put a private file into a PDF that is passed on. With `MDO_BASE_DIR` (the app's temporary copy) that folder counts as the note's

## [26.10.3] - 2026-10-24

### Added
- Present: the info line has the „Gliederung“ toggle (Mod+Shift+O) like Edit's status line; lifted while the outline is shown
- Editor: Preview and Present show formulas (`$…$`, `$$…$$`) as the PDF sets them: the bundled Typst with the bundled mitex renders them in New Computer Modern Math (one Typst run per batch in the main process, in a sandbox: a fresh temp dir as `--root` with only mitex and the batch, empty package dirs, a dead proxy, a timeout; formula text never enters Typst source), sized in em of the surrounding text and drawn in its colour, inline on the baseline, display formulas centred, also in list items, quotes, headings, set paragraphs and table cells. The editor finds formulas by the PDF's rules (cmarker's pulldown-cmark: escapes, code spans, `{…}` groups), and spellcheck and typographic characters leave them alone. The formula with the cursor and the code view show the source; LaTeX commands the PDF does not know (such as `\ce`) are flagged at the formula with mitex's message as a tooltip (the bounded Typst run reports them; the failing formula is found by halving the batch); known ways into Typst code are refused in the preview (the commands `\iftypst`, `\includegraphics`, `\hspace`, `\vspace`, `\raisebox`, an unescaped `#`, a `\label` with more than a plain name, a non-letter colour model, mitex output with unexpected `#` code, and macros with parameters), a list that is not exhaustive: the sandbox is the boundary, now also with a memory limit (1 GiB on macOS/Linux) and a 20 MB cap on the SVG read back. Sets declare nothing; the display block `.mdo-math` takes spacing like `.mdo-diagram`. `pipeline/tests/test-math.sh` (CI, macOS/Linux) checks that the editor finds the formulas cmarker finds and that the app's path sets them exactly as the PDF's toolchain does. Documented in TEMPLATES.md §8.1 (with the known differences) and §8.5
- Docs: `THIRD_PARTY_NOTICES.md` adds mitex 0.2.7 (Apache-2.0), which the PDF pipeline has always shipped and the preview's formula renders now use too; README and README.en.md describe the formulas in the preview

### Security
- Export: Typst now reads only a fresh, private staging folder per export (Typst's `--root`; removed afterwards, also after a hard kill on the next run) that holds the note, the images it visibly includes (SVG, PNG, JPEG, GIF, WebP by content; SVGs without external references), the logo, the profile with the files it names, the set and the pipeline parts; the files are listed by the `markdown-office` wrapper (`MDO_MANIFEST`) with the editor's Markdown parser. Note text (`<!--raw-typst …-->`, mitex passthroughs) can no longer pull other local files into a PDF
- The bundled sets `memo` and `din5008a` turn `raw-typst` off and map `<mdo-pagebreak></mdo-pagebreak>` for the page break; a note's `<!--raw-typst …-->` is not executed
- A profile given as a path must lie in the note's folder or the templates folder, with no hidden folder on the way; a template named as a path in the note is used as that single regular file (no link) from those folders; a single `.typ` found by name brings its folder without `profiles` folders, hidden entries and links leading out
- Windows: UNC and device paths are refused (no NTLM hash leak to a network share)
- TEMPLATES.md and the READMEs document the staging folder, the rules above and what set authors must do (`raw-typst: false`, folder sets)

### Changed
- Sets pinned: memo 26.10.10 and din5008a 26.10.7 (raw-typst off, `<mdo-pagebreak>`)
- Windows: the hints for a rejected template or file (e.g. multi-file templates need a set folder `<name>\<name>.typ`) are now written on stderr
- Editor: „Datei → Profil anlegen …“ asks for the set first (the sets found that have profiles, the shown note's set preselected) and works without an open note; only a shown note of the same set gets `profile: <name>`

### Fixed
- Editor: the foot of a set (din5008a: closing, signature, signer) starts one paragraph gap below the text, as in the PDF, also when the note does not end with a line break; blank lines at the end of the note no longer change that gap. Documented in TEMPLATES.md §8

## [26.10.2] - 2026-10-23

### Added
- Editor: the preview and Present follow the note's template set. `<name>.css` (next to `<name>.typ`) sets font, sizes, measure, headings and tables through documented `--mdo-*` tokens and `.mdo-*` rules; `<name>.preview.yaml` describes the blocks above (`head`, replaces the front matter) and below (`foot`) the text, filled from the front matter and the sender profile (`{key}`, `{profile.key}`, `x-profile-<key>` overrides, the profile's signature as a picture). Sets without these files, a broken `.preview.yaml` (one notice per set per session) or a `.typ` path keep memo's look. The set's CSS is sanitised and scoped to the editor: only `.mdo-*` rules, no at-rules, nothing that loads a resource, `position` limited to static, relative or absolute, no `z-index`. The contract is in TEMPLATES.md §8
- Editor: „Im Finder zeigen“ (Windows „Im Explorer zeigen“, Linux „Im Dateimanager zeigen“) in the „Datei“ menu after „Umbenennen …“ and in the note's right-click menu (tab, status-line file name) shows the active note in the system's file manager. A new note is saved first; a missing file or a path the app did not open is reported as a notice; not available while presenting
- Settings: the button „Vorlagen-Ordner öffnen“ opens the folder for your own template sets (`~/Documents/Markdown Office/Vorlagen/` or `MDO_TEMPLATES`) in the file manager and creates it when it is missing; an error shows next to the button
- Editor: the status line shows the note's set (`template:`, e.g. `memo`, `din5008a`) next to the file name; nothing without `template:`. The header is checked silently in the background (on opening a note, on switching tabs, 500 ms after typing stops; main's set and profile inputs are fetched again only when the path, `template:` or `profile:` change, or when the window regains focus). The name turns red when the check finds errors (warnings and hints do not count, like the export notice and the CLI exit code; a set that is not installed or a missing profile is an error); the tooltip reads „memo – n Fehler im YAML-Kopf“, with „(Set nicht installiert)“ for an unknown set. A click opens „YAML prüfen …“ (not while presenting)
- TEMPLATES.md §8.5: how to derive each preview value of a set from its `.typ` and a PDF it produced (measure, font, weights, line height, alignment and word spacing, paragraph gap, headings, list indent, tables, code, no-break lists, head and foot blocks), with memo and din5008a as worked examples and how to check the result against the PDF; set READMEs describe their preview values (§11)
- Editor: Preview and Present draw top-level fenced `mermaid` blocks as diagrams, with the same mmdr WebAssembly (`typst_mmdr.wasm`, bundled with the PDF pipeline) and the same arguments as the set's Typst rule, so shape, colours and size match the PDF (checked byte for byte against Typst's output for memo by `pipeline/tests/test-mermaid.sh`). The main process hands the wasm to the renderer (`window.mdo.pluginWasm`, a fixed list of bundled plugins, never a path), the renderer instantiates it on the first diagram per window (the CSP gains `'wasm-unsafe-eval'`, nothing else) and caches drawings per (options, source). The SVG is never inserted as markup: it is parsed and rebuilt from an allowlist of what mmdr emits, dropping links, scripts, `foreignObject`, images, `use`, `style` elements, `href`, `on*`, `class` and `style` attributes and non-local `url(…)`, with ids prefixed per diagram. Blocks inside lists or quotes, the block with the cursor or a selection, the code view and any diagram that fails (a quiet notice shows under it) stay source; the note's text never changes
- Editor: `<name>.preview.yaml` accepts `mermaid:` (`base-theme`, `theme`, `layout`, `max-height`, `font-weight`): the arguments of the set's `mermaid-svg` call and size rule. every key is optional, and without `max-height` (mm, cm, pt, in) only the text width caps a diagram; a valid file without `mermaid:` means the set draws no diagrams, a missing or broken file or a `.typ` path uses memo's values. A diagram sits in a `.mdo-diagram` block that a set's CSS may style under the restricted text rules (spacing, typography, background). Documented in TEMPLATES.md §8.1, §8.2, §8.4 and §8.5 (row 11a)

### Changed
- Editor: the preview shows the set's figure style, so lines break like the PDF where numbers occur (memo prints old-style figures: "1627" is 19.72 pt wide; the former hard-coded `proportional-nums` made it 18.04 pt). New tokens `--mdo-numeric` (body, lists, quotes, headings) and `--mdo-table-numeric` (tables), CSS `font-variant-numeric` values, default `normal` (the font's own figures; code stays `normal`); memo.css sets `oldstyle-nums` and `lining-nums tabular-nums`. TEMPLATES.md §8.1 and §8.5
- Editor: the preview breaks lines like the PDF. Body and heading weights are the ones Typst prints for memo (380, bold 560, headings 470/470/380, table head 680; the text looks a little lighter than before), the optical size of the serif fonts is fixed in pt (`--mdo-body-opsz`, `--mdo-h1-opsz` to `--mdo-h3-opsz`) so breaks no longer change with the zoom, the text block is one space wider (the space before a break counts under CodeMirror's wrapping), list items hang by `--mdo-list-indent` (1.12em) on top of the line padding (inside quotes and alerts too; ordered numbers sit in a slot that fills the indent, nested items hang under their own text), and `--mdo-word-spacing` (default `0`; memo `-0.045em`) stood in for Typst's shrinking of word spaces (since the paragraphs are set like Typst it only applies to the paragraph with the cursor and to the fallback). New tokens are documented in TEMPLATES.md §8.1
- Editor: the set's CSS gets the optical size of its fonts from its pt sizes (`--mdo-body-size: 11pt` also sets `--mdo-body-opsz: 11`, likewise `--mdo-h1-size` to `--mdo-h3-size`), as Typst does, and `<name>.preview.yaml` accepts `nobreak:` (`words:`, `units:`) for phrases and number-unit pairs the preview keeps on one line (TEMPLATES.md §8)
- Editor: the preview keeps the set's no-break phrases (`z. B.`, `5 mm`; memo's lists without a set) on one line, never in code or tables, and no longer breaks a line at a hidden Markdown mark (`**fett**,` could start a line with the comma). The note's text is unchanged. List items get the hanging indent, and the app measures the body font's space advance per set (`--mdo-space-advance`) for the wider text block and the list marker slot. The set's CSS cannot override the values the app writes (`--mdo-space-advance` and the list hang), an `--mdo-*-opsz` with a unit is dropped, and the optical size follows a size's last kept declaration
- Editor: the set's CSS can no longer hide or fake the note's text in the preview. `content` keeps only decoration without letters or digits (`"▪ "`), and rules that may reach the note's lines (anything but the head and foot blocks) keep only typography and spacing with an opaque colour and a non-zero size (TEMPLATES.md §8.1)
- Template sets: memo 26.10.6 and din5008a 26.10.3 describe their editor preview (`<name>.css`, `<name>.preview.yaml`). din5008a shows the sender line, address, date and subject above the text and closing, signature, signer and enclosures below it, in serif 11 pt at the letter's 165 mm measure; memo states its look explicitly (unchanged)
- Template sets: memo 26.10.7 (weights as printed, `--mdo-word-spacing: -0.045em`, table head 680, list indent 1.12em, `nobreak:` lists) and din5008a 26.10.4 (list indent 0.804em, table head 600) carry the preview fidelity values
- Editor: rendered preview lines show the characters the PDF prints: „…“ and ‚…‘ (“…” and ‘…’ when `lang:` does not start with `de`), the apostrophe ’ in `geht's`, – for `--`, — for `---` and … for `...`. Inline code, code blocks, formulas, HTML and tables stay raw in the preview; the PDF currently also substitutes in table cells and indented code blocks (a pipeline quirk, to be fixed separately). Autolinks `<https://…>` show without their angle brackets. The line with the cursor or a selection keeps its raw characters, and the note's text is unchanged
- Editor: rendered preview paragraphs (also in Present) are set like the PDF: the app picks the line breaks itself the way Typst does — hyphenation with Typst's German and English patterns (when the set hyphenates: `--mdo-hyphenate`, by default with justified text; the costs `--mdo-hyphenation-cost` and `--mdo-runt-cost`), the best breaks for the whole paragraph in justified text, and word spaces shrunk or stretched per line so justified lines fill the measure; hyphenated breaks show a hyphen. Body paragraphs, list items and paragraphs in quotes and alerts are set; headings, tables and code are not. The paragraph with the cursor or a selection keeps the editor's normal wrapping until the cursor leaves it, and the note's text is unchanged. While fonts are still loading, the browser wraps the paragraph as before
- Editor: 100 % zoom now matches the paper size, and zoom and the Present factor scale the set's print sizes (body, headings, tables, code, measure) together; memo's measure is 145 mm instead of 41.1 em (0.03 px apart at 100 %)
- Docs: `THIRD_PARTY_NOTICES.md` names the code and data behind the paragraph setting (Typst 0.15.0 line breaking, Apache-2.0; hypher 0.1.5 and its German (MIT) and English (Kuiken) patterns; linebreak, MIT) and ships in `<resources>/` like `LICENSE` (the build checks it). TEMPLATES.md §8.1 and §8.5 describe the paragraph setting, `--mdo-hyphenate`, `--mdo-hyphenation-cost`, `--mdo-runt-cost`, its limits and how to derive the values from a `.typ`
- Docs: `THIRD_PARTY_NOTICES.md` adds mmdr 0.2.2 and mermaid-rs-renderer (MIT): the WebAssembly the PDF pipeline has always shipped now also runs in the app's UI for the preview's diagrams; README and README.en.md describe the diagrams in the preview
- Template sets: memo 26.10.8 (`--mdo-runt-cost: 200%`, old-style figures in text and lining tabular figures in tables, README section "Editor-Vorschau") and din5008a 26.10.5 (README section "Editor-Vorschau"); with them the preview breaks 98 % of the lines of a long memo dossier like the PDF (before: 68 %) and every line of a din5008a letter
- Template sets: memo 26.10.9 and din5008a 26.10.6 describe their Mermaid diagrams in `<name>.preview.yaml` (`mermaid:` with the values of their `.typ`: base theme `modern`, the theme colours, node and rank spacing 25/35, `max-height: 12cm`, font weight 500), so the preview draws their diagrams like the PDF

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
