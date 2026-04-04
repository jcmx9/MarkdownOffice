# Design: MarkdownOffice v2

Universelle Dokumenten-App: Jedes Typst-Template wird zum Formular. User fuellt aus, schreibt Markdown-Body, bekommt PDF. Kein Typst-Wissen noetig.

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

### Jedes Typst-Template wird zum Formular

1. App liest ein `.typ`-Template
2. `typst-syntax` parsed den AST und findet alle `sys.inputs.at("...")` Aufrufe
3. Daraus entsteht eine Liste von Feldern mit Name, Required/Optional, Default-Wert
4. App generiert ein Formular — ein Widget pro Feld
5. User fuellt aus + schreibt Markdown-Body
6. App uebergibt alles an Typst → PDF

Der Template-Ersteller muss nichts ueber MarkdownOffice wissen. Jedes existierende Typst-Template das `sys.inputs` verwendet funktioniert automatisch.

### Datenfluss

```
Template (.typ)
    → typst-syntax AST → discover_inputs()
    → Liste von InputField (name, required, default)
    → App generiert Formular
    → User fuellt aus + schreibt Body
    → typst_bridge.compile(template, inputs, fonts, files) → PDF
```

### Input-Erkennung (discover_inputs)

Rust-Funktion im `typst_flutter`-Fork, basierend auf `typst-syntax`:

```rust
fn discover_inputs(source: &str) -> Vec<InputField>
```

Walked den AST und findet:
- `sys.inputs.at("key")` → InputField(name: "key", required: true)
- `sys.inputs.at("key", default: "value")` → InputField(name: "key", required: false, default: "value")

Reine Syntax-Analyse, keine Kompilierung. Schnell.

### Label-Mapping

`sys.inputs` liefert nur den Key (z.B. `sender_name`). Das ist auch das Default-Label im Formular. Fuer unsere mitgelieferten Templates pflegen wir ein optionales Label-Mapping als Sidecar-Datei:

```yaml
# din5008_b.labels.yaml
sender_name: Name
sender_street: Strasse
sender_zip: PLZ
sender_city: Ort
recipient_name: Empfaenger
subject: Betreff
date: Datum
closing: Schlussformel
```

Fremde Templates ohne Sidecar zeigen den Feld-Namen direkt als Label. Funktioniert, sieht nur weniger poliert aus. Template-Ersteller die schoene Labels wollen benennen ihre Inputs entsprechend (z.B. `sys.inputs.at("Betreff")` statt `sys.inputs.at("subject")`).

## Profile

Profile bleiben YAML-Dateien (`mdo_profiles.yaml`). Ein Profil speichert wiederkehrende Werte. Wenn der User ein Profil waehlt, werden alle Formular-Felder vorausgefuellt deren Key im Profil existiert.

```yaml
default:
  sender_name: Roland Kreus
  sender_street: Schillerstrasse 20B
  sender_zip: 33609
  sender_city: Bielefeld
  sender_phone: 0171/3017808
  sender_email: roland@kreus.de
```

Profil-Keys die das Template nicht kennt werden ignoriert. Template-Felder die das Profil nicht hat bleiben leer. YAML-Werte werden als Strings behandelt (alles nach `:` strippen).

## Dateien und Lookup

### Dateien

| Datei | Inhalt |
|-------|--------|
| `mdo_config.yaml` | Cloud-Pfad, App-Einstellungen |
| `mdo_profiles.yaml` | Absenderprofile |
| `templates/*.typ` | Typst-Templates (ein Ordner, eine Datei pro Template) |
| `templates/*.labels.yaml` | Optionales Label-Mapping (Sidecar) |

### Lookup-Kette (Desktop)

1. Arbeitsverzeichnis (`./`)
2. Cloud-Pfad (aus `mdo_config.yaml`)
3. Home (`~/.config/markdownoffice/`)

### Lookup-Kette (Mobile)

1. Cloud-Pfad (aus Config)
2. App-Documents

Config nur unter `~/.config/markdownoffice/` (Desktop) bzw. App-Documents (Mobile).

Fuer Profile und Config: erster Treffer gewinnt, kein Merge.
Fuer Templates: alle Pfade werden gemerged (Templates aus verschiedenen Quellen sind additiv). Bei Namenskollision gewinnt die spezifischere Quelle (CWD > Cloud > Home).

### Mitgelieferte Templates

Die App liefert mit:
- `din5008_b.typ` — DIN 5008 Form B Geschaeftsbrief (+ Labels-Sidecar)
- `din5008_a.typ` — DIN 5008 Form A Geschaeftsbrief (+ Labels-Sidecar)
- `elegant.typ` — Persoenlicher Brief im Korrespondenz-Stil (+ Labels-Sidecar)

"Werkseinstellungen" laedt diese aus dem App-Bundle neu.

## Architektur

### Projektstruktur

```
lib/
  core/
    typst_bridge.dart       # Typst FFI: compile + discoverInputs
    template_loader.dart    # Templates aus Lookup-Kette laden, Labels mergen
    config_loader.dart      # Lookup-Kette fuer Config/Profiles
    markdown_parser.dart    # YAML-Frontmatter + Body (fuer .md Import)
  features/
    editor/                 # Dokument-Screen, dynamisches Formular, Textfeld, Preview
    profiles/               # Profil-Liste, Profil-Editor
    templates/              # Template-Auswahl
  models/
    input_field.dart        # InputField (name, required, default)
    profile.dart            # Absenderprofil
    config.dart             # App-Config
  providers/
    editor_provider.dart    # Aktuelles Template, Felder, Werte, Body, PDF
    profile_provider.dart
    template_provider.dart
    config_provider.dart
assets/
  templates/
    din5008_b.typ
    din5008_b.labels.yaml
    din5008_a.typ
    din5008_a.labels.yaml
    elegant.typ
    elegant.labels.yaml
  fonts/
    SourceSerif4-Regular.ttf
    SourceSerif4-Bold.ttf
    SourceSans3-Regular.ttf
    SourceSans3-Bold.ttf
    SourceCodePro-Regular.ttf
```

### Typst-Bridge API

```dart
class TypstBridge {
  /// Findet alle sys.inputs.at(...) im Template (AST-Analyse, keine Kompilierung)
  static Future<List<InputField>> discoverInputs(String templateSource);

  /// Kompiliert Template mit Inputs zu PDF
  static Future<Uint8List> compile({
    required String templateSource,
    required Map<String, String> inputs,
    required List<FontSource> fonts,
    List<FileSource> files = const [],  // Signatur (PNG/SVG), Logo, etc.
  });
}
```

### Packages

| Zweck | Package |
|-------|---------|
| Typst Rendering + Input Discovery | `typst_flutter` (Fork, git dependency) |
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
| Links/Oben | Dynamisches Formular (aus Template-Inputs generiert) + Textfeld fuer Markdown-Body |
| Rechts/Unten | PDF-Live-Vorschau |

### Dynamisches Formular

- Ein TextField pro erkanntem Input-Feld
- Required-Felder sind markiert
- Felder mit Default zeigen den Default als Placeholder
- Profil-Auswahl fuellt Felder vor deren Key im Profil existiert
- Label = Feld-Name, oder huebscher Name aus Labels-Sidecar

### Responsive Layout

- **Desktop / Tablet (landscape):** Split-View — Formular links, Preview rechts
- **Tablet (portrait):** Split-View mit schmalerem Formular
- **Phone:** Tab-Wechsel — Bearbeiten / Vorschau

### Navigation

- Seitenleiste (Desktop) / Drawer (Mobile): Dokument, Profile, Templates
- Template-Screen: Liste aller verfuegbaren Templates
- Profil-Screen: Profile anlegen/bearbeiten/loeschen

### Export

- PDF speichern (FilePicker)
- Share-Sheet (iOS/iPadOS)
- Druck-Dialog
- Markdown-Export (.md mit YAML-Frontmatter der aktuellen Feld-Werte)

## Markdown-Import

User kann eine `.md`-Datei oeffnen. Frontmatter-Felder werden ins Formular geladen, Body ins Textfeld.

```yaml
---
template: din5008_b
profile: default
recipient_name: Max Mustermann
subject: Kuendigung
date: 2026-04-04
---

Sehr geehrter Herr Mustermann,
...
```

## Error Handling

- Typst-Kompilierung schlaegt fehl → Typst-Fehlermeldung in Preview anzeigen
- Profil-Feld passt nicht zu Template-Feld → Wird ignoriert
- Signatur-Datei nicht gefunden → Warnung im UI
- Keine Templates gefunden → Builtin-Templates aus App-Bundle laden
- Keine Profile gefunden → Leerer Zustand, Default-Profil anlegen anbieten
- Template ohne sys.inputs → Leeres Formular, nur Body-Textfeld

## Mitgelieferte Templates

### DIN 5008 Form B (din5008_b.typ)

Standard-Geschaeftsbrief nach DIN 5008:2020 Form B. Falzmarken, Lochmarke, Ruecksendezeile, QR-Code, Fusszeile mit Kontakt/Bank/Seite. Serif-Body, Sans-UI-Elemente.

### DIN 5008 Form A (din5008_a.typ)

Wie Form B mit hoeherem Briefkopf und kurzerem Adressfeld.

### Elegant (elegant.typ)

Persoenlicher Brief: zentrierter Briefkopf in Burgundy Small Caps, Cremeton-Hintergrund, eingerueckte Absaetze, Referenzzeile, In-Kopie-Feld, minimale Fusszeile. Basiert auf dem Korrespondenz-Beispiel.
