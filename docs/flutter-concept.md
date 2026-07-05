# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projekt

**MarkdownOffice** — Cross-Platform Flutter-App (macOS, iOS, iPadOS, Android, Windows, Linux, Web) die Geschaeftsbriefe aus Markdown erzeugt. Layout wird durch YAML-Templates definiert. Port der Python-Implementierung: https://github.com/jcmx9/markdown-secretary

### Zwei Varianten

| Variante | Plattform | Features |
|----------|-----------|----------|
| Native App | macOS, iOS, iPadOS, Android, Windows, Linux | Voller Funktionsumfang: Template-Management, Profilverwaltung, Datei-Lookup-Kette |
| Web App | Docker / statisch gehostet | Privacy-First: kein Login, kein Tracking, LocalStorage fuer Profile, nur DIN 5008 Form B (technisch template-basiert aber ohne UI fuer Template-Auswahl) |

## Build & Dev Commands

```bash
# Setup
flutter pub get

# Run (debug)
flutter run

# Web
flutter run -d chrome
flutter build web

# Tests
flutter test
flutter test test/path/to/specific_test.dart    # einzelner Test

# Analyse & Format
dart analyze
dart format .

# Docker (Web)
docker build -t markdownoffice .
docker run -p 8080:80 markdownoffice
```

## Referenz-Implementierung (Python)

Lies bei Bedarf diese Dateien aus dem Python-Repo als Referenz:
- `src/markdown_secretary/config.py` — DIN 5008 Masse, Fonts, Konstanten
- `src/markdown_secretary/models/letter.py` — LetterModel (Frontmatter-Felder)
- `src/markdown_secretary/models/profile.py` — ProfileModel (Absenderprofil)
- `src/markdown_secretary/core/markdown.py` — Markdown-Parser, Zwischenformat
- `src/markdown_secretary/core/pdf_render.py` — PDF-Renderer mit fpdf2

## Architektur

### Kernmodule

1. **Markdown-Parser** — YAML-Frontmatter + Markdown-Body in strukturierte Daten
2. **Template-Engine** — YAML-Template → Layout-Objekt mit mm-Positionen
3. **PDF-Renderer** — Layout-Objekt + Brief-Daten → PDF (kennt kein YAML, kein Dateisystem)
4. **Config-Loader** — Lookup-Kette fuer Profile/Templates/Config
5. **GUI** — Dokumenten-zentriert: Formular + Textfeld + PDF-Vorschau

### Projektstruktur

```
lib/
  core/
    config_loader.dart      # Lookup-Kette, Config lesen
    template_engine.dart    # Template-YAML → Layout-Objekt
    markdown_parser.dart    # YAML-Frontmatter + Body parsen
    pdf_renderer.dart       # Layout-Objekt + Brief-Daten → PDF
  features/
    editor/                 # Dokument-Screen, Formular, Textfeld, Preview
    profiles/               # Profil-Liste, Profil-Editor
    templates/              # Template-Liste, Reset aus Repo
  models/
    letter.dart             # Brief (Frontmatter + Body)
    profile.dart            # Absenderprofil
    template.dart           # Layout-Definition
    config.dart             # App-Config
  providers/
    letter_provider.dart
    profile_provider.dart
    template_provider.dart
    config_provider.dart
```

### Datenfluss

```
Markdown-Datei
    → markdown_parser → Letter (Frontmatter + Body)
    → Letter.profile → config_loader → Profile
    → Profile.template → config_loader → Template
    → pdf_renderer(Letter, Profile, Template) → PDF-Bytes
```

## Dateien und Lookup

### YAML-Dateien

| Datei | Inhalt |
|-------|--------|
| `mdo_config.yaml` | Cloud-Pfad, App-Einstellungen |
| `mdo_profiles.yaml` | `default` + weitere Profile, jedes referenziert ein Template |
| `mdo_templates.yaml` | Layout-Definitionen (Positionen, Raender, Typografie) |

Alle YAML-Werte nach `:` werden gestrippt und als Text behandelt. Keine Anfuehrungszeichen noetig.

### Lookup-Kette (Desktop)

1. Arbeitsverzeichnis (`./`)
2. Cloud-Pfad (aus `mdo_config.yaml`)
3. Home (`~/.config/markdownoffice/`)

### Lookup-Kette (Mobile)

1. Cloud-Pfad (aus Config)
2. App-Documents

Erster Treffer gewinnt. Kein Merge. Config nur unter `~/.config/markdownoffice/` (Desktop) bzw. App-Documents (Mobile).

### Web

Profile in LocalStorage. DIN 5008 Form B Template fest eingebaut (technisch template-basiert, ohne UI).

## DIN 5008 Form B (Standard)

| Position | mm von oben |
|----------|-------------|
| Oberer Rand | 20 |
| Briefkopf | 45 |
| Ruecksendezeile | 62.6 |
| Adressfeld | 63.6 |
| Textkoerper | 103.6 |
| Falzmarke 1 | 105 |
| Lochmarke | 148.5 |
| Falzmarke 2 | 210 |
| Unterer Rand | 277 (= 297-20) |
| Seitenraender | links 25, rechts 20 |

## DIN 5008 Form A

| Position | mm von oben |
|----------|-------------|
| Oberer Rand | 20 |
| Briefkopf | 27 |
| Ruecksendezeile | 44 |
| Adressfeld | 45 |
| Textkoerper | 85 |
| Falzmarke 1 | 87 |
| Lochmarke | 148.5 |
| Falzmarke 2 | 192 |
| Unterer Rand | 277 |
| Seitenraender | links 25, rechts 20 |

## DIN 5008 Regeln (Renderer-Logik)

- DIN 5008:2020
- Schriftgrad: 11pt, Zeilenabstand einzeilig (Faktor 1.15)
- 1 Leerzeile zwischen Absaetzen
- 1 Leerzeile vor Ueberschriften, keine danach
- 3 Leerzeilen zwischen Schlussformel und Name (Platz fuer Unterschrift)
- Fusszeile: 3 Zeilen (Kontakt, Bank optional, Seitenzahl fest auf Zeile 3)
- Trennzeichen: U+25AA statt Interpunkt (nur in Sans/Mono, nicht in Serif — als separater Run rendern)
- QR-Code (vCard) im Absenderblock: 18x18mm, grau #808080
- Signatur: Hoehe begrenzt (max 15mm = 3 Zeilenhoehen), Breite proportional
- Anlagen, Schlussformel und Ueberschriften ueber Seitenumbrueche zusammenhalten

## Fonts

- Body: Source Serif 4 (Variable Font, wght 400/700)
- UI: Source Sans 3 (Variable Font, wght 400/700)
- Mono: Source Code Pro
- Grau: #808080 (50% Schwarz)
- Fonts als Assets mitliefern (SIL Open Font License erlaubt Buendelung)

## Profil-Felder

```yaml
name:             # Pflicht
street:           # Pflicht
zip:              # Pflicht
city:             # Pflicht
phone:            # Optional
email:            # Optional
bank:             # Optional
  holder:
  iban:
  bic:
  bank_name:
signature:        # Optional — Pfad zur PNG (nur native App)
signature_height: 15mm
print_qr: true    # vCard QR-Code
template: din5008_b
```

## Brief-Header (YAML Frontmatter)

```yaml
profile:          # Profilname
recipient:
  name:
  extra:          # Optional — z.B. Abteilung
  street:
  zip:
  city:
subject:
date: YYYY-MM-DD
closing: Mit freundlichen Gruessen
sign: false
attachments:
  - Anlage 1
```

## Flutter-Packages

- PDF: `pdf` (pub.dev)
- Markdown: `markdown` (pub.dev)
- YAML: `yaml` (pub.dev)
- QR: `qr_flutter` (pub.dev)
- State Management: `flutter_riverpod`
- Datei-Picker: `file_picker`

## Conventions

- Dart: effective_dart Style
- Tests: flutter_test
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`)
- Deutsch in UI und Dokumentation
- MIT-Lizenz, keine proprietaeren Abhaengigkeiten
