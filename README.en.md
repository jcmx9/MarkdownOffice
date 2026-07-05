# MarkdownOffice

> Turn Markdown into DIN 5008 Form A business letters as PDF/A-3b — local, offline, self-contained.

[![CI](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

*Auf Deutsch lesen: [README.md](README.md).*

## Description

**MarkdownOffice** typesets a business letter written in **Markdown** according to **DIN 5008 Form A**
and produces an archival **PDF/A-3b** — with the Markdown source **embedded** in the PDF (via
`pdf.attach`, `relationship: source`). The letter stays both machine- and human-readable and
long-term archivable in a single file.

The sender is configured through **YAML frontmatter**; the letter body is ordinary Markdown (bold,
italic, lists, links, tables). Numbers in tables are formatted German-style and aligned on the
decimal comma.

The tool is **single-user and local-first**: a native Go binary, no Docker, no server backend, no
accounts. Typesetting runs **offline** — release binaries ship Typst, fonts and all Typst packages
embedded.

### Features

- Markdown → PDF/A-3b per DIN 5008 Form A, **veraPDF-validated**
- Markdown source embedded in the PDF (PDF/A-3, `relationship: source`)
- Two modes: one-shot CLI (`render`) and a local browser editor with live preview (`serve`)
- Configurable accent color, optional vCard **QR code**, bank details, attachment list
- German table numbers, aligned on the decimal comma
- **Self-contained**: release binary with no system Typst and no network

## Prerequisites

- **To use the release binary:** nothing else — Typst, fonts and packages are embedded.
- **To build from source:** [Go](https://go.dev/) >= 1.26
- **For a build without embedded assets** (`MDO_*` fallback): a system [Typst](https://typst.app/) >= 0.15
  plus the vendored packages/fonts

## Installation

```bash
go install github.com/jcmx9/MarkdownOffice/cmd/mdo-service@latest
```

Alternatively, grab a self-contained release binary (see [Releases](https://github.com/jcmx9/MarkdownOffice/releases)).

## Usage

```bash
# Render a letter to PDF/A-3b once
mdo-service render brief.md              # writes brief.pdf
mdo-service render brief.md -o out.pdf

# Start the browser editor with a live PDF preview (loopback only)
mdo-service serve                        # opens http://127.0.0.1:8765
mdo-service serve --addr 127.0.0.1:9000 --no-open
```

Without embedded assets (a build without `embed_assets`), a system Typst is located via environment
variables:

```bash
MDO_PACKAGE_PATH=<dir>/pkgs \
MDO_PACKAGE_CACHE_PATH=<dir>/cache \
MDO_FONT_PATH=<dir>/fonts \
  mdo-service render brief.md
```

## Options

| Command / option | Description |
|------------------|-------------|
| `render <file.md>` | Produce a PDF/A-3b letter |
| `-o <out.pdf>` | Output file (default: `<file>.pdf`) |
| `serve` | Start the browser editor with a live preview |
| `--addr <host:port>` | Address (loopback only; default `127.0.0.1:8765`) |
| `--no-open` | Do not open the browser automatically |
| `--version`, `-V` | Show version and exit |

### Environment variables (only without embedded assets)

| Variable | Description |
|----------|-------------|
| `MDO_TYPST_BIN` | Path to the Typst binary (default: `typst`) |
| `MDO_PACKAGE_PATH` | `@local` packages (`<path>/local/<name>/<version>/`) |
| `MDO_PACKAGE_CACHE_PATH` | `@preview` cache (`<path>/preview/<name>/<version>/`) |
| `MDO_FONT_PATH` | Font directory |

## Letter format

A letter is a Markdown file with YAML frontmatter (sender/metadata) and the letter text as the body:

```markdown
---
name: Dr. Anna Weber          # required
street: Lindenallee 12        # required
zip: 80331                    # required
city: München                 # required (zip + city → "ZIP City")
phone: 089 1234567            # optional
email: anna.weber@example.de  # optional
iban: DE91 7002 0500 0009 8765 43   # optional (footer)
bic: BFSWDE33MUE              # optional
bank: Bank für Sozialwirtschaft     # optional
accent: "#C2185B"             # optional, accent color as hex (#RRGGBB)
qr_code: true                 # optional, vCard QR in the info block
date: null                    # null = today (German); otherwise e.g. "5. April 2026"
subject: Ihr Angebot vom 1. Juli    # optional
recipient:                    # required (non-empty)
  - Sonnenschein Verlag GmbH
  - Frau Lisa Bergmann
  - Rosenstraße 5
  - 50667 Köln
closing: Mit freundlichen Grüßen    # optional
attachments:                  # optional
  - Angebotsvergleich (PDF)
---

Sehr geehrte Frau Bergmann,

vielen Dank für Ihr Angebot. Mit **Markdown** schreibt sich der Brief bequem.
```

Invalid input (missing required fields, malformed hex accent color, empty recipient) is reported
with a **plain-language German message** — no stack trace.

## Development

```bash
git clone git@github.com:jcmx9/MarkdownOffice.git
cd MarkdownOffice

make build          # build the binary
make test           # run all tests
make fmt vet        # gofmt + go vet
golangci-lint run   # linting

# Self-contained binary (embedded assets)
make assets                                    # fetch Typst + fonts + packages into internal/assets/dist
go build -tags embed_assets ./cmd/mdo-service  # runs without a system Typst

make web-assets     # re-vendor the editor's CodeMirror bundle (node/npm)
```

## Project structure

```
cmd/mdo-service/     – CLI (render, serve)
internal/frontmatter/– YAML frontmatter → Letter, Body, Source
internal/pipeline/   – Typst wrapper + compile (Runner → Typst → PDF/A-3b)
internal/service/    – RenderMarkdown (Parse + Compile)
internal/web/        – loopback editor (html/template + CodeMirror)
internal/assets/     – optional asset embedding (build tag embed_assets)
internal/bootstrap/  – unpack assets into the data directory
scripts/             – fetch-assets.sh
```

## Versioning

[CalVer](https://calver.org/) in the format `YY.M.MICRO`. Release binaries carry the version via
build-time ldflags; a source build reports `dev`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please do **not** report security vulnerabilities via public issues — see [SECURITY.md](SECURITY.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
