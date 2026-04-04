# Design: markdown-secretary Flutter App

Cross-Platform Flutter-App (macOS, iOS, iPadOS, Android, Windows, Linux) die Geschaeftsbriefe aus Markdown erzeugt. Layout wird durch YAML-Templates definiert (nicht hardcoded). Port der Python-Implementierung: https://github.com/jcmx9/markdown-secretary

## Dateien und Lookup

### Drei YAML-Dateien

| Datei | Inhalt |
|-------|--------|
| `mdsec_config.yaml` | Cloud-Pfad, App-Einstellungen |
| `mdsec_profiles.yaml` | `default` + weitere Profile, jedes referenziert ein Template |
| `mdsec_templates.yaml` | Layout-Definitionen (Positionen, Raender, Typografie) |

### Lookup-Kette

**Desktop (macOS, Windows, Linux):**

1. Arbeitsverzeichnis (`./`)
2. Cloud-Pfad (aus `mdsec_config.yaml`)
3. Home (`~/.config/markdown-secretary/`)

**Mobile (iOS, iPadOS, Android):**

1. Cloud-Pfad (aus Config)
2. App-Documents

Erster Treffer gewinnt. Kein Merge zwischen Ebenen.

`mdsec_config.yaml` liegt nur an einem festen Ort: `~/.config/markdown-secretary/` (Desktop) bzw. App-Documents (Mobile).

### YAML-Werte

Alle Werte nach `:` werden gestrippt und als Text behandelt. Keine Anfuehrungszeichen noetig:

```yaml
zip: 12345      # wird als String "12345" gelesen
```

### Beispiel mdsec_config.yaml

```yaml
cloud_path: /Users/roland/Nextcloud/markdown-secretary
```

### Beispiel mdsec_profiles.yaml

```yaml
default:
  name: Roland Kreus
  street: Musterstr. 1
  zip: 12345
  city: Berlin
  email: mail@example.com
  template: din5008_b
  signature: signature.png
  signature_height: 15
  print_qr: true

geschaeftlich:
  name: Roland Kreus
  street: Firmenstr. 10
  zip: 54321
  city: Muenchen
  template: din5008_b
  bank:
    holder: Roland Kreus
    iban: DE89370400440532013000
    bic: COBADEFFXXX
    bank_name: Commerzbank
```

### Beispiel mdsec_templates.yaml

```yaml
din5008_b:
  description: DIN 5008 Form B - Geschaeftsbrief
  page:
    width: 210
    height: 297
  margins:
    top: 20
    bottom: 20
    left: 25
    right: 20
  positions:
    header: 45
    return_address: 62.6
    address_field: 63.6
    body: 103.6
    fold_mark_1: 105
    hole_mark: 148.5
    fold_mark_2: 210
  typography:
    font_body: Source Serif 4
    font_ui: Source Sans 3
    font_mono: Source Code Pro
    font_size: 11
    line_height: 1.15
    color_gray: "#808080"
  footer:
    lines: 3
    separator: "\u25AA"
  signature:
    max_height: 15
  qr_code:
    size: 18

din5008_a:
  description: DIN 5008 Form A - Geschaeftsbrief
  page:
    width: 210
    height: 297
  margins:
    top: 20
    bottom: 20
    left: 25
    right: 20
  positions:
    header: 27
    return_address: 44
    address_field: 45
    body: 85
    fold_mark_1: 87
    hole_mark: 148.5
    fold_mark_2: 192
  typography:
    font_body: Source Serif 4
    font_ui: Source Sans 3
    font_mono: Source Code Pro
    font_size: 11
    line_height: 1.15
    color_gray: "#808080"
  footer:
    lines: 3
    separator: "\u25AA"
  signature:
    max_height: 15
  qr_code:
    size: 18
```

## Architektur

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

### Datenfluss PDF-Erzeugung

```
Markdown-Datei
    → markdown_parser → Letter (Frontmatter + Body)
    → Letter.profile → config_loader → Profile
    → Profile.template → config_loader → Template
    → pdf_renderer(Letter, Profile, Template) → PDF-Bytes
```

Der PDF-Renderer bekommt nur fertige Objekte. Er kennt weder YAML noch Dateisystem noch Lookup-Logik. Er platziert Inhalte anhand der mm-Werte aus dem Template.

### Config-Loader Lookup

```
config_loader.loadProfiles():
  1. pruefe CWD/mdsec_profiles.yaml         (nur Desktop)
  2. pruefe cloud_path/mdsec_profiles.yaml   (falls konfiguriert)
  3. pruefe ~/.config/markdown-secretary/mdsec_profiles.yaml  (Desktop)
     bzw. App-Documents/mdsec_profiles.yaml  (Mobile)
  → return erster Treffer
```

Gleiche Logik fuer Templates.

### Packages

| Zweck | Package |
|-------|---------|
| PDF-Erzeugung | `pdf` |
| Markdown-Parsing | `markdown` |
| YAML-Parsing | `yaml` |
| QR-Code | `qr_flutter` |
| State Management | `flutter_riverpod` |
| Datei-Picker | `file_picker` |

### Fonts

Als Assets mitgeliefert (SIL Open Font License):

- Body: Source Serif 4 (Variable Font, wght 400/700)
- UI: Source Sans 3 (Variable Font, wght 400/700)
- Mono: Source Code Pro
- U+25AA (Trennzeichen) nur in Sans/Mono verfuegbar — als separater Run rendern

## GUI

### Hauptscreen — Dokument-Ansicht

| Bereich | Inhalt |
|---------|--------|
| App-Bar | Datei oeffnen, Profil-Auswahl (Dropdown), Export/Share/Druck |
| Links/Oben | Formular fuer Frontmatter-Felder (Empfaenger, Datum, Betreff, Schlussformel, Anlagen) + Textfeld fuer Markdown-Body |
| Rechts/Unten | PDF-Live-Vorschau |

### Responsive Layout

- **Desktop / Tablet (landscape):** Split-View — Formular links, Preview rechts
- **Tablet (portrait):** Split-View mit schmalerem Formular
- **Phone:** Tab-Wechsel — Bearbeiten / Vorschau

### Navigation

- Drawer oder Bottom-Nav fuer: Dokument, Profile, Templates, Einstellungen
- Auf Desktop: Seitenleiste statt Drawer

### Profilverwaltung-Screen

- Liste aller Profile aus `mdsec_profiles.yaml`
- Profil bearbeiten/loeschen/neu anlegen
- Aenderungen schreiben direkt in die YAML-Datei

### Template-Verwaltung-Screen

- Liste aller Templates aus `mdsec_templates.yaml`
- Template ansehen/bearbeiten
- "Werkseinstellungen" — DIN 5008 A/B aus Repo neu laden

### Datei-Workflow

1. User oeffnet `.md`-Datei (File-Picker oder Drag&Drop auf Desktop)
2. Frontmatter wird ins Formular geparsed, Body ins Textfeld
3. Profil wird aus Frontmatter-Feld geladen (Fallback: `default`)
4. Template wird aus Profil geladen
5. PDF-Vorschau rendert live bei Aenderungen
6. Export: PDF speichern, Share-Sheet, oder Druck-Dialog

### Export

- PDF als primaeres Format
- Share-Sheet (iOS/iPadOS/Android) und Druck-Dialog
- Kein DOCX in v1

## Error Handling

### Fehlende Dateien

- Keine `mdsec_profiles.yaml` gefunden → App startet mit leerem Zustand, bietet an ein Default-Profil anzulegen
- Keine `mdsec_templates.yaml` gefunden → App bietet an DIN 5008 Templates aus dem Repo zu laden
- Profil referenziert unbekanntes Template → Fehlermeldung im UI, kein PDF-Rendering

### YAML-Fehler

- Ungueltige YAML-Syntax → Fehlermeldung mit Zeilennummer, Datei wird nicht geladen
- Fehlende Pflichtfelder im Profil (name, street, zip, city) → Warnung im Profil-Editor

### Markdown-Datei

- Kein YAML-Frontmatter → Nur Body, User muss Felder im Formular ausfuellen
- Unbekanntes Profil im Frontmatter → Fallback auf `default`, Hinweis im UI

### PDF-Rendering

- Text laeuft ueber Seitenende → Automatischer Seitenumbruch, Anlagen/Schlussformel/Ueberschriften zusammenhalten
- Signatur-Datei nicht gefunden → Warnung, Platz bleibt leer

### Plattform

- Desktop: Drag&Drop und File-Picker
- Mobile: File-Picker und Share Extension (Datei aus anderer App teilen)
- Cloud-Pfad nicht erreichbar → Fallback auf naechste Lookup-Ebene, kein Fehler

## Brief-Format (Markdown + YAML Frontmatter)

Unveraendert gegenueber der Python-Version:

```yaml
---
profile: default
recipient:
  name: Max Mustermann
  street: Beispielweg 5
  zip: 10115
  city: Berlin
subject: Kuendigung Vertrag
date: 2026-04-04
closing: Mit freundlichen Gruessen
sign: false
attachments:
  - Vertragskopie
---

Sehr geehrter Herr Mustermann,

hiermit kuendige ich den oben genannten Vertrag fristgerecht.
```

## DIN 5008 Regeln (Renderer-Logik)

Diese Regeln sind Renderer-Logik, nicht Teil des Template-YAML. Das Template liefert Positionen und Masse, der Renderer setzt die typografischen und layouttechnischen Regeln um:

- Schriftgrad: 11pt, Zeilenabstand Faktor 1.15
- 1 Leerzeile zwischen Absaetzen
- 1 Leerzeile vor Ueberschriften, keine danach
- 3 Leerzeilen zwischen Schlussformel und Name (Platz fuer Unterschrift)
- Fusszeile: 3 Zeilen (Kontakt, Bank optional, Seitenzahl fest auf Zeile 3)
- Trennzeichen: U+25AA
- QR-Code (vCard) im Absenderblock: 18x18mm, grau #808080
- Signatur: max 15mm Hoehe, Breite proportional
- Anlagen, Schlussformel und Ueberschriften ueber Seitenumbrueche zusammenhalten
