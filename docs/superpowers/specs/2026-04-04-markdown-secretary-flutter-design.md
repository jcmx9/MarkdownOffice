# Design: MarkdownOffice v2

Universelle Dokumenten-App: Markdown + Typst-Templates = PDF. Templates definieren ihre eigenen Felder — die App generiert das Formular dynamisch. Nicht nur Briefe, sondern alles was ein Typst-Template darstellen kann.

## Plattformen

| Plattform | Status | Rendering |
|-----------|--------|-----------|
| macOS | v1 | Typst via FFI |
| iOS / iPadOS | v1 | Typst via FFI |
| Windows | geplant | Typst via FFI |
| Android | geplant | Typst via FFI |
| Linux | geplant | Typst via FFI |
| Web | geplant | Typst via WASM (typst.ts) |

## Kern-Konzept

### Template-Driven Dynamic Forms

Ein Typst-Template definiert einen `meta`-Block der beschreibt welche Daten es braucht. Die App liest diesen Block und generiert daraus das UI-Formular.

```typst
// Am Anfang jedes MarkdownOffice-Templates
#let mdo-meta = (
  name: "DIN 5008 Form B",
  description: "Geschaeftsbrief nach DIN 5008:2020",
  author: "MarkdownOffice",
  version: "1.0",
  fields: (
    sender_name: (label: "Name", required: true, group: "Absender"),
    sender_street: (label: "Strasse", required: true, group: "Absender"),
    sender_zip: (label: "PLZ", required: true, group: "Absender"),
    sender_city: (label: "Ort", required: true, group: "Absender"),
    sender_phone: (label: "Telefon", group: "Absender"),
    sender_email: (label: "E-Mail", group: "Absender"),
    recipient_name: (label: "Name", required: true, group: "Empfaenger"),
    recipient_extra: (label: "Zusatz", group: "Empfaenger"),
    recipient_street: (label: "Strasse", required: true, group: "Empfaenger"),
    recipient_zip: (label: "PLZ", required: true, group: "Empfaenger"),
    recipient_city: (label: "Ort", required: true, group: "Empfaenger"),
    subject: (label: "Betreff", required: true),
    date: (label: "Datum", type: "date", default: "today"),
    closing: (label: "Schlussformel", default: "Mit freundlichen Gruessen"),
    sign: (label: "Unterschrift", type: "bool", default: "false"),
    attachments: (label: "Anlagen", type: "list"),
  ),
)
```

### Datenfluss

```
Template (.typ)
    → App parsed mdo-meta → Generiert UI-Formular
    → User fuellt Formular aus + schreibt Markdown-Body
    → App fuettert Werte als sys.inputs + Body an Typst
    → Typst rendert PDF
```

### Was der User sieht

1. Template auswaehlen (Dropdown: "DIN 5008", "Elegant", "Rechnung", ...)
2. Formular erscheint — Felder passen sich dem Template an
3. Markdown-Body schreiben
4. PDF-Vorschau live
5. Exportieren / Teilen / Drucken

### Was der Template-Ersteller sieht

Eine `.typ`-Datei die:
1. Einen `mdo-meta`-Block definiert (welche Felder, welche Gruppen, welche Defaults)
2. Die Felder via `sys.inputs.at("field_name")` liest
3. Den Body via `sys.inputs.at("body")` einbindet
4. Volle Typst-Gestaltungsfreiheit hat

## Meta-Block Feld-Typen

| type | UI-Widget | Wert |
|------|-----------|------|
| (default) | TextField | String |
| date | DatePicker | YYYY-MM-DD |
| bool | Switch | true/false |
| list | Dynamische TextFields | Komma-separiert oder einzeln |
| file | FilePicker | Pfad (Signatur, Logo) |
| select | Dropdown | Optionen in `options`-Feld |

### Erweiterte Feld-Definitionen

```typst
fields: (
  // Einfaches Textfeld
  subject: (label: "Betreff", required: true),

  // Datum mit Default "heute"
  date: (label: "Datum", type: "date", default: "today"),

  // Boolean
  sign: (label: "Unterschrift", type: "bool", default: "false"),

  // Liste
  attachments: (label: "Anlagen", type: "list"),

  // Datei (Signatur, Logo)
  signature: (label: "Unterschrift", type: "file", accept: "image/png,image/svg+xml"),

  // Dropdown
  anrede: (label: "Anrede", type: "select", options: ("Sehr geehrte/r", "Liebe/r", "Hallo")),
)
```

## Profile

Profile bleiben YAML-Dateien (`mdo_profiles.yaml`). Ein Profil speichert wiederkehrende Absenderdaten. Wenn der User ein Profil waehlt, werden die passenden Formular-Felder vorausgefuellt.

```yaml
default:
  sender_name: Roland Kreus
  sender_street: Schillerstrasse 20B
  sender_zip: 33609
  sender_city: Bielefeld
  sender_phone: 0171/3017808
  sender_email: roland@kreus.de
```

Profile-Felder muessen zu Template-Feldern passen (gleiche Keys). Felder im Profil die das Template nicht kennt werden ignoriert. Felder im Template die das Profil nicht hat bleiben leer.

## Dateien und Lookup

### Dateien

| Datei | Inhalt |
|-------|--------|
| `mdo_config.yaml` | Cloud-Pfad, App-Einstellungen |
| `mdo_profiles.yaml` | Absenderprofile |
| `templates/*.typ` | Typst-Templates (ein Ordner, eine Datei pro Template) |

### Lookup-Kette (Desktop)

1. Arbeitsverzeichnis (`./`)
2. Cloud-Pfad (aus `mdo_config.yaml`)
3. Home (`~/.config/markdownoffice/`)

### Lookup-Kette (Mobile)

1. Cloud-Pfad (aus Config)
2. App-Documents

Erster Treffer gewinnt. Kein Merge. Config nur unter `~/.config/markdownoffice/` (Desktop) bzw. App-Documents (Mobile).

### Templates-Ordner

Templates liegen als einzelne `.typ`-Dateien in einem `templates/`-Unterordner an jedem Lookup-Pfad. Die App sammelt alle Templates aus allen Lookup-Pfaden (hier wird gemerged — Templates aus verschiedenen Quellen sind additiv, nicht exklusiv). Bei Namenskollision gewinnt die spezifischere Quelle (CWD > Cloud > Home).

### Mitgelieferte Templates

Die App liefert DIN 5008 Form A, Form B und ein "Elegant"-Template (wie das Korrespondenz-Beispiel) als Default mit. "Werkseinstellungen" laedt diese aus dem App-Bundle neu.

## Architektur

### Projektstruktur

```
lib/
  core/
    typst_bridge.dart       # Typst FFI Wrapper, compileString
    template_parser.dart    # mdo-meta aus .typ parsen
    config_loader.dart      # Lookup-Kette, Config/Profiles/Templates lesen
    markdown_parser.dart    # YAML-Frontmatter + Body (fuer .md Import)
  features/
    editor/                 # Dokument-Screen, dynamisches Formular, Textfeld, Preview
    profiles/               # Profil-Liste, Profil-Editor
    templates/              # Template-Liste, Template-Info
  models/
    template_meta.dart      # Meta-Block Datenstruktur (Fields, Groups, Types)
    profile.dart            # Absenderprofil
    config.dart             # App-Config
  providers/
    editor_provider.dart    # Aktuelles Template, Formular-Werte, Body, PDF-Bytes
    profile_provider.dart
    template_provider.dart
    config_provider.dart
assets/
  templates/
    din5008_b.typ
    din5008_a.typ
    elegant.typ
  fonts/
    SourceSerif4-Regular.ttf
    SourceSerif4-Bold.ttf
    SourceSans3-Regular.ttf
    SourceSans3-Bold.ttf
    SourceCodePro-Regular.ttf
```

### Datenfluss PDF-Erzeugung

```
Template (.typ) → template_parser → TemplateMeta (Felder, Gruppen, Defaults)
                                  ↓
                          Editor generiert Formular
                                  ↓
                    User fuellt aus + schreibt Body
                                  ↓
              typst_bridge.compile(template, inputs, fonts) → PDF-Bytes
```

### Typst-Bridge

```dart
class TypstBridge {
  static Future<Uint8List> compile({
    required String templateSource,  // .typ Inhalt
    required Map<String, String> inputs,  // Feld-Werte
    required List<FontSource> fonts,
    List<FileSource> files = const [],  // Signatur, Logo, etc.
  }) async {
    return TypstFlutter.compileString(
      template: templateSource,
      inputs: inputs,
      fonts: fonts,
      extraFiles: files,
    );
  }
}
```

### Template-Parser

Parsed den `mdo-meta`-Block aus einer `.typ`-Datei. Muss NICHT den ganzen Typst-Code verstehen — nur den Meta-Block am Anfang der Datei extrahieren und die Feld-Definitionen parsen.

### Packages

| Zweck | Package |
|-------|---------|
| Typst Rendering | `typst_flutter` (git dependency) |
| YAML-Parsing | `yaml` |
| State Management | `flutter_riverpod` |
| Datei-Picker | `file_picker` |
| PDF-Vorschau | `printing` |
| Share/Export | `share_plus` |
| Pfade | `path_provider`, `path` |

### Fonts

Als Assets mitgeliefert und an Typst uebergeben:
- Body: Source Serif 4 (Regular, Bold)
- UI: Source Sans 3 (Regular, Bold)
- Mono: Source Code Pro (Regular)
- Signatur: SVG oder PNG (vom User bereitgestellt)

## GUI

### Hauptscreen — Editor

| Bereich | Inhalt |
|---------|--------|
| App-Bar | Template-Auswahl (Dropdown), Profil-Auswahl (Dropdown), Export/Share/Druck |
| Links/Oben | Dynamisches Formular (aus Template-Meta generiert) + Textfeld fuer Markdown-Body |
| Rechts/Unten | PDF-Live-Vorschau |

### Dynamisches Formular

- Felder werden nach `group` gruppiert (Absender, Empfaenger, etc.)
- Jede Gruppe ist ein ExpansionTile oder eine Section
- Feld-Typ bestimmt das Widget (TextField, DatePicker, Switch, FilePicker, Dropdown)
- Required-Felder sind markiert
- Profil-Auswahl fuellt Felder vor deren Key im Profil existiert

### Responsive Layout

- **Desktop / Tablet (landscape):** Split-View — Formular links, Preview rechts
- **Tablet (portrait):** Split-View mit schmalerem Formular
- **Phone:** Tab-Wechsel — Bearbeiten / Vorschau

### Navigation

- Seitenleiste (Desktop) / Drawer (Mobile) fuer: Dokument, Profile, Templates
- Template-Screen: Liste aller verfuegbaren Templates mit Beschreibung
- Profil-Screen: Profile anlegen/bearbeiten/loeschen

### Export

- PDF speichern (FilePicker)
- Share-Sheet (iOS/iPadOS)
- Druck-Dialog
- Markdown-Export (.md mit YAML-Frontmatter der aktuellen Feld-Werte)

## Markdown-Import

User kann eine `.md`-Datei mit YAML-Frontmatter oeffnen. Die Frontmatter-Felder werden ins Formular geladen, der Body ins Textfeld. Das Profil und Template werden aus dem Frontmatter gelesen (falls angegeben).

```yaml
---
template: din5008_b
profile: default
recipient_name: Max Mustermann
recipient_street: Beispielweg 5
subject: Kuendigung
date: 2026-04-04
---

Sehr geehrter Herr Mustermann,
...
```

## Error Handling

- Template hat keinen mdo-meta Block → Fehlermeldung, Template nicht ladbar
- Profil-Feld passt nicht zu Template-Feld → Wird ignoriert
- Typst-Kompilierung schlaegt fehl → Fehler in Preview anzeigen (Typst-Fehlermeldung)
- Signatur-Datei nicht gefunden → Warnung im UI
- Keine Templates gefunden → Builtin-Templates aus App-Bundle laden
- Keine Profile gefunden → Leerer Zustand, Default-Profil anlegen anbieten

## Mitgelieferte Templates

### DIN 5008 Form B (din5008_b.typ)

Standard-Geschaeftsbrief nach DIN 5008:2020 Form B. Felder: Absender, Empfaenger, Betreff, Datum, Schlussformel, Unterschrift, Anlagen. Falzmarken, Lochmarke, Ruecksendezeile, QR-Code, Fusszeile mit Kontakt/Bank/Seite.

### DIN 5008 Form A (din5008_a.typ)

Wie Form B, aber mit hoeherem Briefkopf und kurzerem Adressfeld.

### Elegant (elegant.typ)

Persoenlicher Brief wie das Korrespondenz-Beispiel. Zentrierter Briefkopf in Burgundy Small Caps, Cremeton-Hintergrund, eingerueckte Absaetze, Referenzzeile, In-Kopie-Feld. Keine Falzmarken, kein QR-Code, minimale Fusszeile (nur Seitenzahl).
