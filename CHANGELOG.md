# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [CalVer](https://calver.org/) (`YY.M.MICRO`).

## [Unreleased]

### Added

- `render <datei.md>` — render a DIN 5008 Form A letter from Markdown to PDF/A-3b, with the Markdown
  source embedded in the PDF (`pdf.attach`, `relationship: source`).
- `serve` — local loopback browser editor (CodeMirror) with a live PDF/A preview.
- YAML frontmatter schema mirroring `mdo-cli` (sender, recipient, subject, accent color, vCard QR,
  bank details, attachments); plain-language German error messages.
- German decimal-comma alignment for table numbers via the `zero` Typst package.
- Self-contained builds via the `embed_assets` build tag: bundled Typst, fonts and packages,
  extracted idempotently into the user data directory on first run.
- `--version` / `-V` flag.
- Project governance: MIT license, README (German + English), CI workflow, `SECURITY.md`,
  `CONTRIBUTING.md`, this changelog, Dependabot and CODEOWNERS.

[Unreleased]: https://github.com/jcmx9/mdo-service/commits/main
