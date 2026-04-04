# Flutter markdown-secretary

Du baust eine Cross-Platform-App (macOS, iOS, Android, Windows, Linux) die DIN 5008-konforme Geschaeftsbriefe aus Markdown erzeugt.

## Referenz-Implementierung

Das bestehende Python-Projekt liegt unter: https://github.com/jcmx9/markdown-secretary

Lies die folgenden Dateien als Referenz:
- `README.md` — Was das Tool macht, Markdown-Format, YAML-Header
- `src/markdown_secretary/config.py` — DIN 5008 Masse (Form A + B), Fonts, Konstanten
- `src/markdown_secretary/models/letter.py` — LetterModel (Frontmatter-Felder)
- `src/markdown_secretary/models/profile.py` — ProfileModel (Absenderprofil)
- `src/markdown_secretary/core/markdown.py` — Markdown-Parser, Zwischenformat
- `src/markdown_secretary/core/pdf_render.py` — PDF-Renderer mit fpdf2 (DIN 5008 Positionen)
- `src/markdown_secretary/core/document.py` — DOCX-Renderer (gleiche Logik)

## Was portiert werden muss

1. **Markdown-Parser** — YAML-Frontmatter + Markdown-Body in strukturierte Daten
2. **PDF-Renderer** — DIN 5008 Layout auf A4 mit mm-Positionierung
3. **Profilverwaltung** — YAML-Profile fuer Absenderdaten
4. **GUI** — Dateiauswahl, Drag&Drop, Profilverwaltung, Signatur-Zuordnung

## DIN 5008 Form B (Standardwerte)

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

## Fonts

- Body: Source Serif 4 (Variable Font, wght 400/700)
- UI: Source Sans 3 (Variable Font, wght 400/700)
- Mono: Source Code Pro
- Grau: #808080 (50% Schwarz)
- Bullet/Trennzeichen: U+25AA (nur in Sans/Mono, nicht in Serif — als separater Run rendern)

## DIN 5008 Regeln

- DIN 5008:2020
- Schriftgrad: 11pt, Zeilenabstand einzeilig (Faktor 1.15)
- 1 Leerzeile zwischen Absaetzen
- 1 Leerzeile vor Ueberschriften, keine danach
- 3 Leerzeilen zwischen Schlussformel und Name (Platz fuer Unterschrift)
- Fusszeile: 3 Zeilen (Kontakt, Bank optional, Seitenzahl fest auf Zeile 3)
- Trennzeichen: U+25AA statt Interpunkt
- QR-Code (vCard) im Absenderblock: 18x18mm, grau #808080
- Signatur: Hoehe begrenzt (max 15mm = 3 Zeilenhoehen), Breite proportional
- Anlagen, Schlussformel und Ueberschriften ueber Seitenumbrueche zusammenhalten

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
signature:        # Optional — Pfad zur PNG
signature_height: 15mm
print_qr: true    # vCard QR-Code
din5008_form: B   # A oder B
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

## Alles FOSS

- MIT-Lizenz
- Deutsch fuer Dokumentation und UI
- Keine proprietaeren Abhaengigkeiten

## Flutter-spezifisch

- Dart-Package fuer PDF: `pdf` (pub.dev)
- Dart-Package fuer Markdown: `markdown` (pub.dev)
- Dart-Package fuer YAML: `yaml` (pub.dev)
- Dart-Package fuer QR: `qr_flutter` (pub.dev)
- State Management: Provider oder Riverpod
- Plattform-Integration: Share Extension (iOS/Android), Quick Action (macOS)
- Lokale Speicherung: Hive oder shared_preferences fuer Profile
- Fonts als Assets mitliefern (SIL Open Font License erlaubt Buendelung)

## Conventions

- Dart: effective_dart Style
- Tests: flutter_test
- Commits: Conventional Commits (feat:, fix:, docs:, refactor:)
- Deutsch in UI und Dokumentation
