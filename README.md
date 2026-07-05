# MarkdownOffice

> DIN-5008-Form-A-Geschäftsbriefe aus Markdown nach PDF/A-3b erzeugen — lokal, offline, self-contained.

[![CI](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

*Read this in [English](README.en.md).*

## Beschreibung

**MarkdownOffice** setzt einen in **Markdown** geschriebenen Geschäftsbrief nach **DIN 5008 Form A**
und erzeugt daraus ein archivtaugliches **PDF/A-3b** — mit der Markdown-Quelle **eingebettet** in
der PDF (via `pdf.attach`, `relationship: source`). So bleibt der Brief maschinen- wie
menschenlesbar und langzeitarchivierbar in einer Datei.

Der Absender wird über **YAML-Frontmatter** gepflegt, der Brieftext ist gewöhnliches Markdown
(Fett, Kursiv, Listen, Links, Tabellen). Zahlen in Tabellen werden deutsch formatiert und am
Dezimalkomma ausgerichtet.

Das Tool ist **Einzelnutzer- und local-first** ausgelegt: ein natives Go-Binary, kein Docker, kein
Server-Backend, keine Accounts. Der Satz läuft **offline** — die Release-Binaries bringen Typst,
Schriften und alle Typst-Pakete eingebettet mit.

### Features

- Markdown → PDF/A-3b nach DIN 5008 Form A, **veraPDF-validiert**
- Markdown-Quelle in der PDF eingebettet (PDF/A-3, `relationship: source`)
- Zwei Betriebsarten: One-Shot-CLI (`render`) und lokaler Browser-Editor mit Live-Vorschau (`serve`)
- Frei wählbare Akzentfarbe, optionaler vCard-**QR-Code**, Bankverbindung, Anlagenliste
- Deutsche Tabellenzahlen, dezimal am Komma ausgerichtet
- **Self-contained**: Release-Binary ohne System-Typst, ohne Netzwerk

## Voraussetzungen

- **Zum Nutzen der Release-Binary:** nichts weiter — Typst, Schriften und Pakete sind eingebettet.
- **Zum Bauen aus dem Quellcode:** [Go](https://go.dev/) >= 1.26
- **Für einen Build ohne eingebettete Assets** (`MDO_*`-Fallback): ein System-[Typst](https://typst.app/) >= 0.15
  sowie die vendorten Pakete/Fonts

## Installation

```bash
go install github.com/jcmx9/MarkdownOffice/cmd/mdo-service@latest
```

Alternativ eine self-contained Release-Binary (siehe [Releases](https://github.com/jcmx9/MarkdownOffice/releases)).

## Nutzung

```bash
# Einen Brief einmalig nach PDF/A-3b rendern
mdo-service render brief.md              # schreibt brief.pdf
mdo-service render brief.md -o out.pdf

# Browser-Editor mit Live-PDF-Vorschau starten (nur Loopback)
mdo-service serve                        # öffnet http://127.0.0.1:8765
mdo-service serve --addr 127.0.0.1:9000 --no-open
```

Ohne eingebettete Assets (Build ohne `embed_assets`) wird ein System-Typst über Umgebungsvariablen
gefunden:

```bash
MDO_PACKAGE_PATH=<dir>/pkgs \
MDO_PACKAGE_CACHE_PATH=<dir>/cache \
MDO_FONT_PATH=<dir>/fonts \
  mdo-service render brief.md
```

## Optionen

| Befehl / Option | Beschreibung |
|-----------------|--------------|
| `render <datei.md>` | Brief nach PDF/A-3b erzeugen |
| `-o <out.pdf>` | Ausgabedatei (Standard: `<datei>.pdf`) |
| `serve` | Browser-Editor mit Live-Vorschau starten |
| `--addr <host:port>` | Adresse (nur Loopback; Standard `127.0.0.1:8765`) |
| `--no-open` | Browser nicht automatisch öffnen |
| `--version`, `-V` | Version anzeigen und beenden |

### Umgebungsvariablen (nur ohne eingebettete Assets)

| Variable | Beschreibung |
|----------|--------------|
| `MDO_TYPST_BIN` | Pfad zum Typst-Binary (Standard: `typst`) |
| `MDO_PACKAGE_PATH` | `@local`-Pakete (`<pfad>/local/<name>/<version>/`) |
| `MDO_PACKAGE_CACHE_PATH` | `@preview`-Cache (`<pfad>/preview/<name>/<version>/`) |
| `MDO_FONT_PATH` | Schriftverzeichnis |

## Brief-Format

Ein Brief ist eine Markdown-Datei mit YAML-Frontmatter (Absender/Metadaten) und dem Brieftext als
Body:

```markdown
---
name: Dr. Anna Weber          # Pflicht
street: Lindenallee 12        # Pflicht
zip: 80331                    # Pflicht
city: München                 # Pflicht (zip + city → "PLZ Ort")
phone: 089 1234567            # optional
email: anna.weber@example.de  # optional
iban: DE91 7002 0500 0009 8765 43   # optional (Fußzeile)
bic: BFSWDE33MUE              # optional
bank: Bank für Sozialwirtschaft     # optional
accent: "#C2185B"             # optional, Akzentfarbe als Hex (#RRGGBB)
qr_code: true                 # optional, vCard-QR im Info-Block
date: null                    # null = heute (deutsch); sonst z. B. "5. April 2026"
subject: Ihr Angebot vom 1. Juli    # optional
recipient:                    # Pflicht (nicht leer)
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

Fehlerhafte Angaben (fehlende Pflichtfelder, ungültige Hex-Akzentfarbe, leerer Empfänger) werden mit
einer **laienfreundlichen deutschen Meldung** quittiert — ohne Stacktrace.

## Entwicklung

```bash
git clone git@github.com:jcmx9/MarkdownOffice.git
cd MarkdownOffice

make build          # Binary bauen
make test           # alle Tests
make fmt vet        # gofmt + go vet
golangci-lint run   # Linting

# Self-contained Binary (eingebettete Assets)
make assets                                    # Typst + Fonts + Pakete nach internal/assets/dist holen
go build -tags embed_assets ./cmd/mdo-service  # läuft ohne System-Typst

make web-assets     # CodeMirror-Bundle für den Editor neu vendern (node/npm)
```

## Projektstruktur

```
cmd/mdo-service/     – CLI (render, serve)
internal/frontmatter/– YAML-Frontmatter → Letter, Body, Source
internal/pipeline/   – Typst-Wrapper + Compile (Runner → Typst → PDF/A-3b)
internal/service/    – RenderMarkdown (Parse + Compile)
internal/web/        – Loopback-Editor (html/template + CodeMirror)
internal/assets/     – optionales Asset-Embedding (Build-Tag embed_assets)
internal/bootstrap/  – Entpacken der Assets ins Datenverzeichnis
scripts/             – fetch-assets.sh
```

## Versionierung

[CalVer](https://calver.org/) im Format `YY.M.MICRO`. Release-Binaries tragen die Version per
Build-Ldflags; ein Quellcode-Build meldet `dev`.

## Mitwirken

Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Sicherheit

Sicherheitslücken bitte **nicht** über öffentliche Issues melden — siehe [SECURITY.md](SECURITY.md).

## Changelog

Siehe [CHANGELOG.md](CHANGELOG.md).

## Lizenz

MIT — siehe [LICENSE](LICENSE).
