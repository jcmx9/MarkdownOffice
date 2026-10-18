# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- First release of Markdown Office: the rf-write editor and the real-fast-document pipeline in one app; `markdown-office` CLI; set `memo`
- Editor: tabs, autosave with atomic, byte-exact writes (BOM, CRLF and mixed line endings kept), session restore, single instance, detection of external changes with a per-note conflict banner
- Editor: Preview in the PDF look with the bundled fonts, Code/Preview switch, YAML header that collapses into the title block, section folding, outline sidebar (H1/H2)
- Editor: Present mode (fullscreen, larger text, info line with clock, tabs and zoom); Code in Present ends Present and shows the Code view
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

