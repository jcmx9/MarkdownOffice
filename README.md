# Markdown Office

> Ruhiger Markdown-Editor mit eingebauter PDF/A-Pipeline: Die Notiz sieht schon beim Tippen aus wie das PDF.

**Version:** 26.10.2-dev.0 · [English](README.en.md)

[![CI](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/MarkdownOffice/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)

## Beschreibung

Markdown Office ist ein Editor zum Mitschreiben, etwa im Kundentermin bei geteiltem Bildschirm, und eine Pipeline, die aus derselben Markdown-Datei ein archivfähiges **PDF/A-3b** setzt (Typst, offline, ohne Pandoc). Beides steckt in einer App: Der Editor exportiert über die mitgelieferte Pipeline, und der Befehl `markdown-office` erzeugt PDFs im Terminal oder aus anderen Programmen. Die Markdown-Datei bleibt Byte für Byte so, wie sie getippt wurde.

Markdown Office führt den Editor rf-write und die Pipeline real-fast-document in einem Produkt zusammen.

- **Editor:** Tabs, Autosave mit atomarem Schreiben, Wiederherstellen der Sitzung, Erkennen externer Änderungen ohne stilles Überschreiben, Vorschau in der Optik des PDFs, Präsentationsmodus, Gliederung, Snippets.
- **PDF:** festes Layout aus dem Vorlagen-Set `memo` (DIN A4, Titelblock, Kopf- und Fußzeile, Inhaltsverzeichnis, Hinweisboxen, Aufgabentabellen, Formeln, Mermaid-Diagramme), Markdown-Quelle als Anhang, eigene Vorlagen-Sets.
- **Alles dabei:** Typst, Schriften und Typst-Packages liegen in der App; nichts muss zusätzlich installiert werden.

## Installation

macOS und Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.ps1 | iex
```

Das Skript lädt das passende Archiv der neuesten stabilen GitHub-Release, prüft es gegen `SHA256SUMS` und installiert ohne Adminrechte.

| System | Programm | Befehl |
|--------|----------|--------|
| macOS | `~/Applications/Markdown Office.app` | `~/.local/bin/markdown-office` |
| Linux | `~/.local/share/markdown-office/app/` (entpacktes AppImage) und `~/.local/share/applications/markdown-office.desktop` | `~/.local/bin/markdown-office` |
| Windows | `%LOCALAPPDATA%\Markdown Office\` und Startmenü-Verknüpfung | `%LOCALAPPDATA%\Microsoft\WindowsApps\markdown-office.cmd` (bereits im PATH) |

Die App ist nicht signiert. Unter macOS ist sie ad-hoc signiert (auch das mitgelieferte Typst), und das Skript entfernt die Quarantäne-Markierung, sodass Gatekeeper nicht blockiert. Unter Windows kann SmartScreen warnen. Unter Linux entpackt das Skript das AppImage einmal; `libfuse2` wird daher nicht gebraucht. Auf Ubuntu 24.04 und neuer sperrt AppArmor unprivilegierte User-Namespaces, die Electrons Sandbox braucht; dann startet der Editor nicht (die PDF-Erzeugung läuft trotzdem). Das Skript warnt in diesem Fall und gibt ein AppArmor-Profil nur für Markdown Office aus (anlegen braucht sudo). Das Startprotokoll des Editors liegt unter `~/.local/share/markdown-office/launch.log`.

### Rechtsklick „Markdown-PDF“

Die Installation legt zusätzlich einen Eintrag „Markdown-PDF“ im Dateimanager an: Rechtsklick auf eine Markdown-Datei, und das PDF entsteht daneben, ohne dass der Editor startet. Er ruft den Befehl `markdown-office` auf, es gilt also derselbe Ausgabename (ISO-Präfix aus `date:`), und das PDF öffnet sich danach im Standardprogramm.

| System | Wo | Was angelegt wird |
|--------|----|-------------------|
| macOS | Finder → Rechtsklick → Schnelle Aktionen → Markdown-PDF (nur bei `.md`/`.markdown`) | Quick Action `~/Library/Services/Markdown-PDF.workflow` |
| Linux | Dateimanager → Rechtsklick → Öffnen mit → Markdown-PDF; in Nautilus und Nemo zusätzlich unter Skripte | `~/.local/share/applications/markdown-office-pdf.desktop`, bei vorhandenem Nautilus/Nemo `~/.local/share/nautilus/scripts/Markdown-PDF` bzw. `…/nemo/scripts/Markdown-PDF` |
| Windows | Explorer → Rechtsklick auf `.md`/`.markdown` → Markdown-PDF (Windows 11: unter „Weitere Optionen anzeigen“) | Registry-Schlüssel `HKCU\Software\Classes\SystemFileAssociations\.md\shell\Markdown-PDF` (und `.markdown`), Hilfsskript `markdown-pdf.js` im Installationsordner |

Unter macOS und Linux rufen die Einträge `~/.local/share/markdown-office/markdown-pdf.sh` auf. Das Ergebnis erscheint als Mitteilung (macOS: Mitteilungszentrale, Linux: `notify-send`, falls vorhanden), mehrere ausgewählte Dateien werden nacheinander umgewandelt, andere Dateien übersprungen. Unter Windows startet der Eintrag ohne Konsolenfenster (über `wscript.exe`, ein Fehler erscheint als Meldungsfenster); dafür muss Windows Script Host aktiviert sein. Die Ausgabe des letzten Laufs steht in `markdown-pdf.log` neben dem Skript. Unter Linux beanspruchen Editor und „Markdown-PDF“ beide den Typ `text/markdown`; damit ein Doppelklick die Notiz weiterhin im Editor öffnet statt sie umzuwandeln, trägt die Installation Markdown Office als Standardprogramm für Markdown in `~/.config/mimeapps.list` ein – nur wenn dort noch keines gewählt ist.

Was davon angelegt wurde, steht in `.mdo-file-manager` neben der Installationsmarkierung; Update und Deinstallation ersetzen bzw. entfernen genau das. Ein gleichnamiger Eintrag, der nicht von Markdown Office stammt, bleibt unangetastet.

## Update

Den Installationsbefehl erneut ausführen. Die installierte Version wird ersetzt; schlägt der Download fehl, bleibt die alte Version unverändert. Eine bestimmte Version: `... | bash -s -- --version 26.10.0` bzw. `-Version 26.10.0` unter Windows.

## Deinstallation

macOS und Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.sh | bash -s -- --uninstall
```

Windows (PowerShell):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.ps1))) -Uninstall
```

Entfernt wird nur, was die Installation angelegt hat (erkennbar an ihrer Installationsmarkierung): App, Befehl, Startmenü- bzw. Desktop-Eintrag und der Dateimanager-Eintrag „Markdown-PDF“ (samt der Ordner und Registry-Schlüssel, die nur dafür angelegt wurden). Dokumente, eigene Vorlagen-Sets, Snippets und Einstellungen bleiben unangetastet.

## Testversion

Vorabversionen (Pre-Releases) zum Testen; sie können älter sein als die neueste stabile Version:

```bash
curl -fsSL https://raw.githubusercontent.com/jcmx9/MarkdownOffice/dev/scripts/bootstrap.sh | bash -s -- --pre
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/dev/scripts/bootstrap.ps1))) -Pre
```

## Editor

### Starten

```bash
markdown-office --app                 # letzte Sitzung oder neue Notiz
markdown-office --app notiz.md        # Datei öffnen (bei laufender Instanz als Tab)
markdown-office --app --version
markdown-office --app --help
```

Außerdem startet der Editor über das Startmenü (Windows), den Desktop-Eintrag (Linux) oder `~/Applications/Markdown Office.app` (macOS). Symbolische Links auf einzelne Notizen öffnen die verlinkte Datei (Tab-Name, Umbenennen und Export beziehen sich auf sie); verlinkte Ordner sind davon nicht betroffen.

Neue Notizen landen im Standardordner `~/Documents/Markdown Office/` (Windows: im Ordner „Dokumente“). Die Einstellungen liegen in `settings.json` im App-Datenordner (macOS `~/Library/Application Support/Markdown Office`, Windows `%APPDATA%\Markdown Office`, Linux `~/.config/Markdown Office`).

Die Vorschau nutzt die mitgelieferten Schriften des PDFs; fehlt eine Schriftdatei, fällt sie auf Systemschriften zurück. Fließtext wird wie im PDF im Blocksatz gesetzt, aber ohne Silbentrennung; getrennt wird erst beim Export durch Typst. Anführungszeichen nach `lang`, Apostroph, Halbgeviert- und Geviertstrich und Auslassungszeichen zeigt die Vorschau wie das PDF (nicht in Code, Formeln, HTML und Tabellen), Links in `<…>` ohne die spitzen Klammern; die Zeile mit dem Cursor zeigt die getippten Zeichen, und der Text der Notiz bleibt unverändert. Mod+E speichert die Notiz und exportiert sie mit der Pipeline; das PDF landet neben der Notiz (Name wie beim [Befehl](#befehl-markdown-office)) und öffnet sich im Standardprogramm.

Schrift, Größen, Satzbreite und die Blöcke über und unter dem Text (etwa Absender, Anschrift, Betreff und Grußformel eines Briefs) übernimmt die Vorschau vom Set der Notiz: aus `name.css` und `name.preview.yaml` (siehe [Vorlagen-Sets](#vorlagen-sets) und TEMPLATES.md). Sets ohne diese Dateien sehen aus wie `memo`. Bei 100 % Zoom entspricht die Vorschau der Papiergröße (11 pt sind 11 pt, 165 mm sind 165 mm); Zoom und Präsentationsfaktor skalieren alle Druckgrößen gemeinsam.

| Kürzel | Aktion |
|--------|--------|
| Mod+N | Neue Notiz im Standardordner (`JJJJ-MM-TT_HH-mm-ss.md`), beginnt mit dem YAML-Header des Sets `memo`; die Datei entsteht erst beim ersten Tippen. Ohne offene Notiz macht der Knopf „Neues Memo …“ dasselbe |
| Mod+Shift+N | Neu aus Vorlage …: Vorlagen-Set (`memo` vorne und vorausgewählt, ggf. mit Profil) wählen, neue Notiz mit dessen YAML-Header |
| Mod+O | Öffnen |
| Mod+Shift+R | Umbenennen |
| Mod+W | Tab schließen |
| Mod+E | PDF exportieren |
| Mod+Shift+M | Code-Ansicht ein/aus (Vorschau ist Standard); beim Präsentieren beendet es die Präsentation und zeigt die Code-Ansicht |
| Mod+Shift+H | YAML-Header in der Vorschau ein-/ausblenden (ausgeblendet erscheint der Titelblock wie im PDF) |
| Mod+Shift+O | Gliederung ein/aus (je Modus gemerkt) |
| macOS Cmd+Alt+[ / ], sonst Ctrl+Shift+[ / ] | Abschnitt ein-/ausklappen |
| macOS Ctrl+Alt+[ / ], sonst Alt+0 / Alt+Shift+0 | Alle Abschnitte ein-/ausklappen |
| Mod+Shift+P, Esc | Präsentieren ein/aus (Vollbild, nur Text und Infozeile, auf Wunsch mit Gliederung) |
| Mod+Enter | Seitenumbruch einfügen (`<!-- pagebreak -->`) |
| Mod+Plus / Mod+- / Mod+0 | Vergrößern / Verkleinern / Originalgröße (je Modus gespeichert) |
| Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 | Tabs wechseln |
| Mod+Z / Mod+Shift+Z, Mod+X/C/V, Mod+A | Widerrufen/Wiederholen, Ausschneiden/Kopieren/Einfügen, Alles auswählen |

`Mod` = Cmd unter macOS, sonst Ctrl. Die Auswahl mit Shift bzw. Mod+Shift und den Pfeiltasten übernimmt CodeMirror.

Ein Rechtsklick auf einen Tab oder auf den Dateinamen in der Statuszeile öffnet ein Menü mit Umbenennen, Im Finder zeigen (Windows: Im Explorer zeigen, Linux: Im Dateimanager zeigen), PDF exportieren und Tab schließen. „Im Finder zeigen“ steht auch im Menü „Datei“ und zeigt die aktive Notiz im Dateimanager des Systems (eine neue Notiz wird dafür zuerst gespeichert; nicht beim Präsentieren). Die Statuszeile zeigt links die Uhrzeit und die Umschalter `Editor | Präsentation` und `Code | Vorschau`; ein Klick auf die andere Seite schaltet um. Rechts daneben schalten `Gliederung` und `YAML` die Gliederung (Mod+Shift+O) und den YAML-Header der Vorschau (Mod+Shift+H) ein oder aus; ist ein Schalter hervorgehoben, ist er an. `YAML` ist ausgegraut, wenn die Notiz keinen Header hat oder die Code-Ansicht (dort ist der Header immer sichtbar) aktiv ist. Beim Präsentieren beendet ein Klick auf „Code“ (wie Mod+Shift+M) die Präsentation und zeigt die Code-Ansicht. Neben dem Dateinamen steht das Set der Notiz (`template:`), rot bei Fehlern im YAML-Header (siehe [YAML prüfen](#frontmatter)).

### Einstellungen

„Einstellungen …“ (macOS Cmd+, im App-Menü, sonst Ctrl+, im Menü „Datei“) öffnet den Dialog: Standardordner für neue Notizen, Snippet-Ordner, Schriftfaktor im Präsentationsmodus und die Voreinstellung für den YAML-Header in der Vorschau (als YAML oder als Titelblock) sowie die Rechtschreibung (Schalter, automatische Wörterbuch-Updates, eigene Wörter). Ein schreibgeschützter Statusblock zeigt die Version der Pipeline und des mitgelieferten Typst. Der Knopf „Vorlagen-Ordner öffnen“ öffnet den Ordner für eigene Vorlagen-Sets (`~/Documents/Markdown Office/Vorlagen/` bzw. `MDO_TEMPLATES`, siehe [Vorlagen-Sets](#vorlagen-sets)) im Dateimanager und legt ihn an, wenn er fehlt. Das Ändern des Standardordners verschiebt oder löscht keine Dateien. Nicht übernommene Werte nennt der Dialog nach dem Speichern; für sie gilt der bisherige Wert.

### Gliederung

Eine Seitenleiste rechts listet die Überschriften H1 und H2 der Notiz. Die Einträge lesen sich als Liste: ein Kapitel mit Unterkapiteln zeigt einen Pfeil, ein Eintrag ohne Unterkapitel steht bündig ohne Zeichen davor. Die höchste Überschriftenebene der Notiz bekommt die Optik der obersten Ebene; eine Notiz nur mit H2-Überschriften zeigt diese also als oberste Einträge. Der Pfeil klappt den Abschnitt im Text und in der Gliederung gleichzeitig ein oder aus; „Alle ein-/ausklappen“ wirkt ebenso auf beide. Ein Seitenumbruch oder Kommentar am Ende eines Abschnitts gehört zur nächsten Überschrift. Ein Klick auf einen Eintrag springt im Text zur Überschrift, der Fokus bleibt im Editor. Lange Überschriften enden mit „…“; mit der Maus darüber erscheint der volle Text. Die Breite lässt sich am linken Rand der Gliederung mit der Maus ziehen (Doppelklick: Standardbreite). Im Editor wird sie gemerkt; in der Präsentation startet die Gliederung jedes Mal mit der Standardbreite, eine gezogene Breite gilt nur bis zum Ende der Präsentation. Mod+Shift+O blendet die Gliederung ein oder aus; die Einstellung wird getrennt für Editor und Präsentation gemerkt.

### Snippets

Tippe `:` am Zeilenanfang oder nach einem Leerzeichen und mindestens einen Buchstaben (z. B. `:mee`), dann erscheint die Liste der Snippets; Strg+Leertaste zeigt nach einem einzelnen `:` alle. Unter macOS kann Strg+Leertaste von der Eingabequellen-Umschaltung belegt sein; dann einfach `:` und einen Buchstaben tippen. Enter oder Tab fügt das Snippet ein, Tab / Shift+Tab springen durch die Felder. Prosa wie `Hinweis:`, `10:30` oder `:D` löst nichts aus.

In einem Snippet beendet Esc zuerst den Feldmodus; im Präsentationsmodus verlässt erst ein weiteres Esc die Präsentation. Header-Snippets (`:meeting`, `:telefonnotiz`) lassen im Präsentationsmodus den YAML-Header offen, solange ein Feld darin aktiv ist; danach klappt er zum Titelblock zu. Folgezeilen eines mehrzeiligen Snippets übernehmen die Einrückung der aktuellen Zeile, und Tabs am Zeilenanfang einer Vorlage werden zu zwei Leerzeichen.

| Snippet | Inhalt |
|---------|--------|
| `:meeting` | Meeting-Notiz mit Header, Teilnehmern, Agenda, Mitschrift und Aufgaben |
| `:telefonnotiz` | Telefonnotiz |
| `:aufgabe` | Aufgabenzeile `- [ ] Aufgabe – Name, bis Datum` |
| `:newpage` | Seitenumbruch `<!-- pagebreak -->` |

Das Menü **Einfügen → Vorlage …** macht eine Notiz von anderswo zur Notiz eines Vorlagen-Sets. Es fragt mit derselben Auswahl wie „Neu aus Vorlage …“ nach dem Set (`memo` steht vorne und ist vorausgewählt) und, wenn dessen Header `profile:` enthält, nach dem Profil. Danach gilt:

- Ohne YAML-Header kommt die Frontmatter-Vorlage des Sets (`name.header.md`, siehe [Vorlagen-Sets](#vorlagen-sets)) an den Anfang der Notiz: alle Schlüssel mit Standardwerten, je Schlüssel eine Zeile mit kurzem Kommentar. Der Cursor steht danach im Titel.
- Mit YAML-Header werden beide zusammengeführt: Vorhandene Schlüssel behalten ihren Wert, fehlende Schlüssel des Sets kommen mit Standardwert und Kommentar unten in den Header; nichts wird doppelt, vorhandene Kommentare und die Reihenfolge bleiben unverändert.
- `template:` erhält das gewählte Set (an Ort und Stelle, sonst unten angefügt), ebenso `profile:` das gewählte Profil.
- `date:` wird geprüft: gültig sind `JJJJ-MM-TT`, `T.M.JJJJ` (auch `TT.MM.JJJJ`) oder leer. Bei einer anderen Schreibweise erscheint ein Hinweis mit dem Knopf „In JJJJ-MM-TT ändern“ (heutiges Datum); geändert wird erst beim Klick.

Das Zusammenführen ist ein einziger Rückgängig-Schritt, die Datumsänderung ein eigener; Zeilenenden (LF/CRLF) und BOM der Notiz bleiben erhalten. Hat der Header schon alle Schlüssel des Sets, meldet ein kurzer Hinweis, dass nichts zu ergänzen war.

Eigene Snippets sind Dateien `name.tpl.md` im Snippet-Ordner (Standard `~/Documents/Markdown Office/Snippets/`, Einstellung „Snippet-Ordner“). Ein eigenes Snippet mit demselben Namen ersetzt das eingebaute. Neue Dateien werden beim nächsten Fokus des Fensters erkannt. Unterstützte Syntax: `$1`, `${1:Vorgabe}`, `$0` (Endposition) sowie `$CURRENT_YEAR`, `$CURRENT_MONTH`, `$CURRENT_DATE`, `$CURRENT_HOUR`, `$CURRENT_MINUTE`, `$CURRENT_SECOND` (auch in der Form `${CURRENT_YEAR}`). `\$` ergibt ein wörtliches `$`, `\\` einen Backslash, und in einer Vorgabe ergibt `\}` eine wörtliche geschweifte Klammer `}`.

### Rechtschreibprüfung

Der Schalter **Bearbeiten → Rechtschreibprüfung** (auch in den Einstellungen) prüft die Rechtschreibung im Editor. Geprüft wird nie in der Präsentation, in Codeblöcken oder im Frontmatter. Ein Rechtsklick auf ein unterstrichenes Wort bietet Vorschläge und „Zum Wörterbuch hinzufügen“; eigene Wörter lassen sich in den Einstellungen wieder entfernen.

Die Sprache bestimmt `lang:` der Notiz, sonst die Systemsprache. macOS nutzt die Rechtschreibprüfung des Systems; Sprachen und Wörterbücher verwaltet macOS unter Systemeinstellungen → Tastatur → Texteingabe. Unter Windows und Linux arbeitet die Prüfung vollständig offline mit den mitgelieferten Wörterbüchern de-DE und en-US. Aktualisierungen und weitere Sprachen kommen ausschließlich aus dem Repository `jcmx9/MarkdownOffice-dictionaries`, jede Datei wird gegen ihre Prüfsumme verifiziert. Beim Start prüft der Editor höchstens einmal am Tag auf neue Wörterbücher (abschaltbar in den Einstellungen; „Jetzt prüfen“ fragt sofort nach). Ein aktualisiertes Wörterbuch wird nach einem Neustart aktiv, eine neu geladene Sprache sofort. Fehlt das Wörterbuch für die `lang:` einer Notiz, fragt ein Hinweis, ob es geladen werden soll – nur beim Bearbeiten mit eingeschalteter Prüfung, nie in der Präsentation.

Lizenzen: Das deutsche Wörterbuch (aus Chromiums `de-DE-3-0.bdic`, entstanden aus `de_DE_neu` von „Lantol“) steht unter der LGPL; der Lizenztext und die README liegen bei. Das englische Wörterbuch basiert auf SCOWL und steht unter dessen freizügiger Lizenz (Kevin Atkinson, u. a.). Beide Dateien sind reine Daten und liegen getrennt von der Anwendung, die Texte unter `licenses/dictionaries/` im Pipeline-Ordner.

## Befehl markdown-office

```bash
markdown-office notiz.md                      # PDF neben der Notiz
markdown-office notiz.md ziel.pdf             # genau dieser Pfad
markdown-office --no-source notiz.md          # ohne Quelle im PDF
markdown-office --soft-breaks notiz.md        # Umbrüche werden Leerzeichen
markdown-office --template mein-set notiz.md  # anderes Vorlagen-Set
markdown-office --help                        # alle Optionen
markdown-office --app [notiz.md …]            # Editor öffnen
markdown-office validate notiz.md             # YAML-Header prüfen
```

Ohne Argument gibt der Befehl die Hilfe aus.

**Ausgabename:** Ohne zweites Argument landet das PDF neben der Quelle. Mit `date:` im Frontmatter bekommt es einen ISO-Präfix (`2026-10-13_notiz.pdf`), abschaltbar mit `isodate_praefix: false`. Ein ausdrücklich angegebener Ausgabepfad wird exakt so geschrieben. Nach dem Build öffnet sich das PDF im Standardprogramm.

| Option | Wirkung |
|--------|---------|
| `--no-source` | Markdown-Quelle **nicht** ins PDF einbetten (z. B. Kunden-PDFs); wie `embed_source: false` |
| `--hard-breaks` | Jede Zeile bleibt eine Zeile, wie im Editor getippt (Standard); wie `hard_breaks: true` |
| `--soft-breaks` | Einzelne Zeilenumbrüche werden zu Leerzeichen (CommonMark), für umbrochenen Fließtext; wie `hard_breaks: false` |
| `--template NAME` | Vorlagen-Set oder `.typ`-Datei für diesen Build; wie `template:` |
| `--app [notiz.md …]` | Editor öffnen statt ein PDF zu erzeugen (nur als erstes Argument) |
| `--version`, `-V` | Version von Markdown Office und Typst ausgeben |
| `--help`, `-h` | Hilfe ausgeben |

Unter Windows gelten dieselben Optionen, zusätzlich `-Version` und `-Help`. Der Befehl ist dort eine `.cmd`-Datei: Argumente mit den cmd-Sonderzeichen `&`, `^`, `%` oder `|` müssen aus PowerShell und cmd in Anführungszeichen stehen.

| Umgebungsvariable | Wirkung |
|-------------------|---------|
| `MDO_NO_OPEN=1` | PDF nach dem Build nicht öffnen (Batch, Cron, andere Programme) |
| `MDO_BASE_DIR=ordner` | Bild- und Logopfade relativ zu diesem Ordner statt zum Ordner der Quelle |
| `MDO_TEMPLATES=ordner` | Ordner mit eigenen Vorlagen-Sets statt `~/Documents/Markdown Office/Vorlagen` |
| `TYPST=/pfad/typst` | bestimmtes Typst-Binary statt des mitgelieferten verwenden (≥ 0.15) |
| `SOURCE_DATE_EPOCH` | PDF-Datum festlegen, wenn kein `date:` gesetzt ist |

### YAML prüfen

```bash
markdown-office validate notiz.md                  # Befunde ausgeben, nichts ändern
markdown-office validate notiz.md --fix            # Korrekturen schreiben
markdown-office validate notiz.md --add-missing    # fehlende Schlüssel des Sets ergänzen
markdown-office validate notiz.md --json           # Ergebnis als JSON
```

Der Befehl prüft den YAML-Header mit denselben Regeln wie **Bearbeiten → „YAML prüfen …“** im Editor (siehe [Frontmatter](#frontmatter)). `--fix` schreibt die vorgeschlagenen Korrekturen (Tippfehler-Vermutungen nie), `--add-missing` hängt die fehlenden Schlüssel des Sets an; beide ändern nur die betroffenen Zeilen, Zeilenenden und BOM bleiben. Exit-Code: `0` keine Fehler (Warnungen und Hinweise zählen nicht), `1` Fehler oder nicht geschlossener Header, `2` falscher Aufruf oder Datei nicht les- bzw. schreibbar.

### Aus anderen Programmen

`markdown-office` ist als Exportziel gebaut:

- Der Exit-Code ist nur bei Erfolg 0; Fehler und Warnungen gehen kurz und auf Deutsch auf stderr.
- Typst kommt aus der App und wird auch mit minimalem `PATH` gefunden (Start aus einer GUI-App).
- Ein- und Ausgabe dürfen absolute Pfade mit Leerzeichen sein; relative Pfade gelten ab dem Arbeitsverzeichnis des Aufrufs.
- Bei einer temporären Kopie der Notiz (etwa beim Export ungespeicherter Änderungen) zeigt `MDO_BASE_DIR` auf den echten Notizordner, damit Bilder und Logo gefunden werden.

```bash
MDO_NO_OPEN=1 MDO_BASE_DIR="/pfad/zur/notiz" markdown-office --no-source "/pfad/notiz.md" "/pfad/ziel.pdf"
```

## Frontmatter

Ein YAML-Block am Dateianfang steuert einzelne Dokumente. Alle Schlüssel sind optional; die Frontmatter-Vorlage des Sets `memo` (Menü **Einfügen → Vorlage …**) enthält jeden Schlüssel mit Standardwert und Kommentar.

**Anführungszeichen:** Freitext steht in Anführungszeichen (`title: "Kick-off: Relaunch"`), feste Werte ohne (`lang: de`, `toc: auto`, `true`, `13mm`). Ohne Anführungszeichen missversteht YAML Text mit `: ` oder ` #` (alles ab `#` wird Kommentar), Wörter wie `no`, `yes`, `on`, `off` (Wahrheitswerte), Zahlen mit führender Null wie `01067` (wird 1067) und Text, der mit `[`, `{`, `*`, `&`, `!`, `@`, `` ` ``, `|`, `>` oder `%` beginnt. `""` heißt ausdrücklich leer. Ein Datum wie `date: 2026-10-20` darf ohne Anführungszeichen stehen.

```yaml
---
title: "Kick-off Relaunch"   # Titel: Titelblock, Kopfzeile, PDF-Titel
subtitle: "Workshop"         # Untertitel
toptitle: "Muster GmbH"      # Toptitel, klein und gesperrt über dem Titel
author: [Anna, Ben]          # Autor(en): Zeile "Datum · Autor"
date: 13.10.2026             # Datum (ISO oder T.M.JJJJ)
lang: de                     # Sprache; Standard de
watermark: "ENTWURF"         # Wasserzeichen
logo: firma.svg              # Logo im Kopf (ohne: kein Logo)
embed_source: false          # Quelle nicht einbetten
hard_breaks: false           # Umbrüche werden Leerzeichen
---
```

| Schlüssel | Werte | Standard | Wirkung |
|-----------|-------|----------|---------|
| `template` | Set-Name oder `.typ`-Datei | `memo` | Vorlagen-Set des Dokuments, siehe [Vorlagen-Sets](#vorlagen-sets). |
| `title` | Text | — | Titelblock oben, Kopfzeile ab Seite 1, PDF-Metadatentitel. Ohne `title` kein Titelblock; der PDF-Titel ist dann der Dateiname. `# …` im Text ist immer ein Kapitel, nie der Titel. |
| `subtitle` | Text | — | Untertitel unter dem Titel. |
| `toptitle` | Text | — | Kleine, gesperrte Zeile über dem Titel, etwa Kunde oder Firma; auch vorn in der Fußzeile und in den PDF-Stichwörtern. |
| `author` | Text oder `[A, B]` | — | Zeile unter dem Titel: „Datum · Autor“. |
| `date` | `2026-10-13` oder `13.10.2026` | — | Datum unten rechts (nach `lang`), ISO-Präfix am Dateinamen, festes PDF-Datum. Ein nicht erkanntes Datum erscheint unverändert, ohne Präfix. |
| `isodate_praefix` | `true` / `false` | `true` | ISO-Präfix am Dateinamen, wenn `date` gesetzt ist. |
| `lang` | `de`, `en`, … | `de` | Sprache: Datum, Silbentrennung, Anführungszeichen, Beschriftungen (Seite/Page, Inhalt/Contents, Aufgabe/Task, Hinweisboxen). |
| `toc` | `auto` / `true` / `false` | `auto` | Inhaltsverzeichnis (nur H1 + H2); `auto` ab mehr als fünf H1/H2. |
| `h1_break` | `auto` / `true` / `false` | `auto` | Jedes Kapitel (`#`) auf neuer Seite; `auto` wie bei `toc`. |
| `header` | Text | — | Fester Kopfzeilentext ab Seite 1 statt des laufenden Kapitels. |
| `print_filename` | `true` / `false` | `true` | Angabe unten links (Dateiname bzw. „Toptitel · Titel“) ein-/ausblenden. |
| `watermark` | Text | — | Diagonales, hellgraues Wasserzeichen unter allem. |
| `logo` | Datei `.svg`/`.png`/`.jpg`/`.jpeg` | kein Logo | Logo im Kopf, nur wenn gesetzt; siehe [Logo](#logo). |
| `logo-height` | `15mm`, `1.5cm`, `40pt`, … | `13mm` | Maximale Logohöhe (höchstens 25 mm); das Logo bleibt proportional und höchstens 60 mm breit. |
| `profile` | Name oder `.yaml`-Pfad | kein Profil | Absender-Profil: ein Name sucht `<name>.yaml` in `profiles/` neben der Notiz, in `Vorlagen/<set>/profiles/`, in `Vorlagen/profiles/` und im Set; ein Pfad auf eine `.yaml`-Datei gilt relativ zur Notiz. Nur für Sets, die Profile nutzen (z. B. din5008a); nicht gefunden: Fehler, kein PDF. |
| `embed_source` | `true` / `false` | `true` | Markdown-Quelle als Anhang ins PDF einbetten. |
| `hard_breaks` | `true` / `false` | `true` | Jeder Zeilenumbruch bleibt einer (wie im Editor getippt), auch ohne Eintrag. Nur `false` setzt CommonMark: Ein einzelner Umbruch wird zum Leerzeichen. |

**Regeln:** Leere Werte (`subtitle: ""` oder nur `subtitle:`) werden ignoriert, nie ein Fehler. Ja/Nein-Schlüssel verstehen `true`/`false`, `yes`/`no`, `on`/`off` in jeder Schreibweise; ein nicht erkannter Wert erzeugt eine Warnung, der Standard bleibt. Kommentare (`# …`) dürfen auf eigenen Zeilen und hinter Werten stehen. In Pfaden (`logo:`, Bilder) werden `~`, `$VAR`, `${VAR}` und `%VAR%` ersetzt.

**YAML prüfen:** Das Menü **Bearbeiten → „YAML prüfen …“** (Mod+Shift+Y) prüft den Header der Notiz gegen die Regeln der Pipeline und des gewählten Sets: ungültige Werte (etwa `toc: ja`, `date: 20.10.26`, ein unbekanntes Set oder ein nicht gefundenes `profile:`), mehrfach vorkommende Schlüssel und vermutete Tippfehler. Zusätzliche eigene Schlüssel sind immer erlaubt. Der Dialog zeigt jeden Befund mit einem Korrekturvorschlag; „Übernehmen“ schreibt die angehakten Korrekturen als **einen** Undo-Schritt, alles andere in der Notiz bleibt Byte für Byte. „Fehlende ergänzen“ hängt die Schlüssel des Sets an, die der Header noch nicht hat (standardmäßig aus). Ohne Befund erscheint „YAML in Ordnung“. Beim Export prüft die App den Header still vorab; bei Fehlern meldet ein Hinweis „YAML hat n Fehler“ mit „Prüfen …“, der Export läuft trotzdem. Das gilt auch nach „Einfügen → Vorlage …“. Nennt die Notiz ein Set (`template:`), zeigt die Statuszeile seinen Namen neben dem Dateinamen; die App prüft den Header dafür still im Hintergrund (beim Öffnen, beim Tab-Wechsel und eine halbe Sekunde nach dem letzten Tastendruck). Bei Fehlern wird der Name rot (Warnungen und Hinweise zählen nicht, auch ein nicht installiertes Set oder ein nicht gefundenes Profil ist ein Fehler), der Tooltip nennt die Anzahl („memo – 2 Fehler im YAML-Kopf“); ein Klick öffnet „YAML prüfen …“. Welche Schlüssel und Werte ein Set erwartet, steht in seiner `name.schema.yaml`, siehe [TEMPLATES.md](TEMPLATES.md) (Englisch). Dieselbe Prüfung gibt es im Terminal: [`markdown-office validate`](#yaml-prüfen).

### Logo

Ein Logo erscheint **nur**, wenn `logo:` gesetzt ist. Ohne den Schlüssel, mit leerem Wert oder auskommentiert bleibt der Kopf ohne Logo.

| Wert von `logo:` | Gesucht wird |
|------------------|--------------|
| `firma.svg`, `logos/firma.svg` | 1. im Ordner der Notiz (bzw. `MDO_BASE_DIR`), 2. im Benutzerordner (`~`, Windows `%USERPROFILE%`), 3. im Vorlagen-Ordner (`~/Documents/Markdown Office/Vorlagen/` bzw. `MDO_TEMPLATES`), 4. im Pipeline-Ordner der App – die erste vorhandene Datei gewinnt |
| `/Pfad/firma.svg`, `C:\Logos\firma.png` | genau diese Datei |
| `~/firma.svg`, `$HOME/firma.svg`, `%USERPROFILE%\firma.svg` | genau diese Datei, Variablen ersetzt |

- Erlaubt sind `.svg`, `.png`, `.jpg` und `.jpeg`.
- Wird nichts gefunden (oder ist die Endung falsch, oder ist es eine Web-Adresse), entsteht das PDF **ohne Logo**, mit einem Hinweis, nie mit einem Fehler.
- **Eigenes Logo für alle Dokumente:** einmal im Vorlagen-Ordner ablegen (`~/Documents/Markdown Office/Vorlagen/firma.svg`) und in jeder Notiz `logo: firma.svg` schreiben. Eine gleichnamige Datei neben der Notiz hat Vorrang, etwa für ein Kundenlogo.
- Die App bringt das Markdown-Office-Zeichen als `logo.svg` mit: `logo: logo.svg` findet es, solange keine eigene `logo.svg` neben der Notiz, im Benutzerordner oder im Vorlagen-Ordner liegt.

## Markdown im PDF

CommonMark funktioniert wie gewohnt: `*kursiv*`, `**fett**`, `` `Code` ``, Links, Listen, Zitate, Fußnoten, Tabellen. Darüber hinaus:

- **Aufgaben:** Eine Liste nur aus Aufgaben (`- [ ] Sitemap erstellen – Ben Probe, bis 17.10.`) wird zur Tabelle *Aufgabe · Wer · Bis · Status*.
- **Hinweisboxen:** `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` sowie die deutschen Schlüsselwörter `[!INFO]`, `[!TIPP]`, `[!WICHTIG]`, `[!HINWEIS]`, `[!ACHTUNG]`.
- **Typografie:** Anführungszeichen nach Sprache, `--` und `---` als Halbgeviert- und Geviertstrich, `...` als Auslassungszeichen, geschützte Leerzeichen (`z. B.`, `5 %`), `==Markierung==`.
- **Seitenumbruch:** `<!-- pagebreak -->` oder `\newpage` auf eigener Zeile.
- **Bilder:** `![Unterschrift](bild.png){width=50%}`; ein fehlendes Bild bricht den Export nie ab, Remote-Bilder entfallen offline.
- **Formeln** in LaTeX-Syntax (`$…$`, `$$…$$`), **Code** mit Syntax-Hervorhebung, **Definitionslisten** und **Mermaid-Diagramme** (offline gezeichnet).

## Vorlagen-Sets

Ein Vorlagen-Set legt fest, wie ein Dokument aussieht. Es besteht aus bis zu vier Dateien mit gemeinsamem Namen:

| Datei | Zweck | Pflicht |
|-------|-------|---------|
| `name.typ` | Typst-Vorlage für das PDF | ja |
| `name.header.md` | Frontmatter-Vorlage mit allen Schlüsseln; enthält `template: name` | nein |
| `name.css` | Aussehen der Vorschau im Editor (Schrift, Größen, Satzbreite) | nein |
| `name.preview.yaml` | Blöcke über und unter dem Text in der Vorschau (Kopf und Fuß) | nein |

Mitgeliefert sind das Set `memo` ([MarkdownOffice-set-memo](https://github.com/jcmx9/MarkdownOffice-set-memo)), das Standardlayout, und das Set `din5008a` ([MarkdownOffice-set-din5008a](https://github.com/jcmx9/MarkdownOffice-set-din5008a), Briefe nach DIN 5008 Form A). Eigene Sets liegen als `name.typ` oder als Ordner `name/name.typ` (etwa ein geklontes Set-Repo) im Ordner `~/Documents/Markdown Office/Vorlagen/` (Windows: `Dokumente\Markdown Office\Vorlagen\`) und gehen einem mitgelieferten Set gleichen Namens vor. Namen bestehen aus `a-z`, `0-9`, `_` und `-`.

Neue Notizen beginnen mit dem Header eines Sets: Mod+N mit `memo`, **Datei → Neu aus Vorlage …** (Mod+Shift+N) mit einem Set aus einer Auswahl aller Sets (`memo` vorne und vorausgewählt, dann mitgelieferte und eigene alphabetisch; je Set ein Hinweis aus der ersten `# …`-Kommentarzeile seiner Header-Datei). Der Editor liest dazu `name.header.md` neben der gewählten `name.typ`: bei einem eigenen Set als Datei also `Vorlagen/name.header.md`, als Ordner `Vorlagen/name/name.header.md`. Fehlt die Datei, beginnt die Notiz mit einem Header, der nur `template: name` enthält. **Einfügen → Vorlage …** führt denselben Header in eine vorhandene Notiz zusammen (siehe [Snippets](#snippets)). Enthält der Header einen Schlüssel `profile:`, bietet die Auswahl zusätzlich die vorhandenen Profile an (siehe [Briefe](#briefe-din5008a)).

Eine Notiz wählt ihr Set mit `template: name` im Frontmatter; ohne Schlüssel gilt `memo`. `template: ./angebot.typ` nimmt eine einzelne Vorlage relativ zur Notiz. `--template` überschreibt den Schlüssel. Ein unbekanntes Set bricht den Build mit einer Meldung ab.

Eine Vorlage ist Typst-Code und kann deine Dateien lesen; nutze nur Vorlagen, denen du vertraust.

Eine eigene Vorlage bekommt dieselben Eingaben (`sys.inputs`) wie `memo.typ`, darunter `mdo`, den Pipeline-Ordner der App, und `version`. Damit nutzt sie die Bausteine der Pipeline:

```typst
#import sys.inputs.mdo + "/lib/markdown.typ": preprocess
#import sys.inputs.mdo + "/vendor/cmarker/lib.typ" as cmarker
#cmarker.render(preprocess(read(sys.inputs.source)))
```

Bilder behandelt `memo.typ` mit einer eigenen Funktion (`safe-image`); eine eigene Vorlage ohne sie bricht bei einem fehlenden Bild ab.

Wie man ein eigenes Set schreibt (alle Eingaben, die zu rendernden Elemente, PDF/A-Anforderungen, ein lauffähiges Grundgerüst), beschreibt [TEMPLATES.md](TEMPLATES.md) (Englisch).

## Briefe (din5008a)

Das Set `din5008a` setzt Briefe nach DIN 5008 Form A mit Absender-Profil, vCard-QR-Code und Unterschrift. Eine minimale Notiz:

```markdown
---
template: din5008a
profile: beispiel
x-to:
  - Beispiel GmbH
  - Frau Muster
  - Musterstraße 1
  - 12345 Musterstadt
x-subject: Anfrage zum Angebot
x-closing: Mit freundlichen Grüßen
---

Sehr geehrte Frau Muster,

vielen Dank für Ihr Angebot.
```

Einen Brief beginnt **Datei → Neu aus Vorlage …** (Mod+Shift+N) mit dem Set `din5008a`: Die Auswahl bietet die gefundenen Absender-Profile an (eigene aus `Vorlagen/din5008a/profiles/` und `Vorlagen/profiles/` sowie die Beispielprofile des Sets, alphabetisch), und das gewählte Profil steht danach unter `profile:` im Header. Ohne gefundenes Profil bleibt der Wert aus der Header-Vorlage stehen.

Eigene Absender-Profile liegen je Set als `~/Documents/Markdown Office/Vorlagen/din5008a/profiles/<name>.yaml` (Windows: `Dokumente\Markdown Office\Vorlagen\din5008a\profiles\<name>.yaml`); der Ordner `Vorlagen/din5008a/` braucht dafür keine `din5008a.typ` und verdeckt das mitgelieferte Set nicht. Profile in `Vorlagen/profiles/` gelten weiterhin für alle Sets. Beim Export gewinnt das erste gefundene Profil: `profiles/` neben der Notiz, dann `Vorlagen/<set>/profiles/`, dann `Vorlagen/profiles/`, dann die Beispielprofile des Sets. Alle Schlüssel, Profilfelder und Optionen beschreibt die README des Set-Repos MarkdownOffice-set-din5008a.

Die Absender-Adresse besteht im Profil aus `street`, `zip` (Postleitzahl, in Anführungszeichen: `zip: "01067"`, sonst liest YAML die Zahl 1067), `city` und optional `country` (leer heißt Germany). Gedruckt wird `<zip> <city>` in einer Zeile, im vCard-QR-Code landen Postleitzahl, Ort und Land in eigenen Adressfeldern. Ältere Profile mit nur `city: 33609 Bielefeld` drucken unverändert; für den QR-Code trennt das Set eine führende vier- oder fünfstellige Postleitzahl ab.

Ein eigenes Profil legt **Datei → Profil anlegen …** an: In einer Notiz mit `template: din5008a` (oder einem anderen Set mit Beispielprofil) fragt der Editor nach einem Namen (`a–z`, `0–9`, `-`, `_`), kopiert das Beispielprofil des Sets samt Begleitdateien nach `Vorlagen/<set>/profiles/<name>.yaml` (aus `beispiel-unterschrift.svg` wird `<name>-unterschrift.svg`, `signature:` zeigt auf die Kopie), setzt `profile: <name>` in der Notiz und öffnet die YAML-Datei als Tab zum Bearbeiten (Code-Ansicht, ohne Rechtschreibprüfung, kein PDF-Export). Vorhandene Dateien werden nie überschrieben: Gibt es den Namen schon, meldet der Editor das und ändert nichts.

## PDF/A, Quelle und Metadaten

- **PDF/A-3b**, alle Schriften eingebettet.
- Die **Markdown-Quelle** liegt als Anhang im PDF (unter ihrem Dateinamen, ohne lokalen Pfad) und lässt sich z. B. mit `mutool extract datei.pdf` wieder herauslösen. Abschalten mit `embed_source: false` oder `--no-source`.
- Das **PDF-Datum** ist das `date:` der Notiz, sonst die Änderungszeit der Quelle, nie der Zeitpunkt des Builds.
- **Weitere Metadaten:** Titel und Thema aus `title:`, Autor nur aus `author:`, Sprache aus `lang:`; die Stichwörter enthalten den Toptitel (`toptitle:`) und „Markdown Office <Version>“. Als erzeugendes Programm trägt Typst sich selbst ein.

## Schriften und Lizenzen

Vorschau und PDF nutzen dieselben mitgelieferten Schriften: die variablen Source-Schriften von Adobe (Source Serif 4, Source Sans 3, Source Code Pro) und für Zeichen ohne Source-Glyph Noto Emoji und Noto Sans Symbols 2, alle unter der SIL Open Font License 1.1. Typst (Apache-2.0) und die Typst-Packages cmarker (MIT), mitex (Apache-2.0) und mmdr (MIT) stehen unter ihren eigenen Lizenzen. Die Lizenztexte liegen der App im Pipeline-Ordner unter `licenses/` bei (`typst/` mit LICENSE und NOTICE, `fonts/`, `packages/`; macOS: `Markdown Office.app/Contents/Resources/pipeline/licenses/`, Windows und Linux: `resources/pipeline/licenses/` im Installationsordner). Versionen und Prüfsummen stehen in `scripts/pipeline-assets.json`.

## Entwicklung

Voraussetzungen: Node.js ≥ 22.12 (CI: 24), npm, Git; für die Pipeline-Tests `pdftotext` (poppler) oder `mutool` (mupdf), für den Äquivalenztest poppler.

```bash
git clone git@github.com:jcmx9/MarkdownOffice.git
cd MarkdownOffice
npm ci
npm run assets                    # Typst, Schriften, Packages, Set memo; danach das Dev-Layout
npm run dev                       # App mit Hot Reload (macOS: Menüleiste zeigt "Markdown Office", per postinstall)
npm run build:cli                 # den Befehl markdown-office (src/cli/) nach out/cli/cli.js bauen
npm run lint && npm run typecheck
npm test                          # Unit-Tests (Vitest, tests/unit)
npm run test:e2e                  # Ende-zu-Ende (Playwright + Electron; lokal nur simuliertes Vollbild)
bash pipeline/tests/test-pdf.sh          # Pipeline: PDFs der Testnotizen und Schnittstelle (macOS/Linux)
bash pipeline/tests/test-equivalence.sh  # Pipeline: Set memo gegen die Referenz-PDFs
npm run dist                      # Paket für das aktuelle System nach dist/
bash scripts/test-bootstrap.sh    # Installation, Update, Deinstallation mit dem Paket aus dist/
bash scripts/test-file-manager.sh # Dateimanager-Eintrag „Markdown-PDF“ (Generatoren, ohne Build)
```

`npm run assets` lädt die gepinnten Pipeline-Assets nach `build/pipeline-assets/`, prüft jede Datei gegen ihre SHA-256-Prüfsumme aus `scripts/pipeline-assets.json` und baut das Entwicklungs-Layout `build/pipeline-dev/`, das dem gepackten Layout der App entspricht. Unter Windows prüft `pipeline/tests/test-windows.ps1` die Pipeline (Windows PowerShell 5.1).

Der Befehl `markdown-office` ist TypeScript (`src/cli/`, gemeinsame Logik in `src/core/`) und wird zu einer Datei gebündelt. `npm run dev` baut ihn nicht neu: Nach Änderungen in `src/cli/` oder `src/core/` aktualisieren `npm run build:cli` (oder `npm run build`) die CLI im Dev-Layout.

In der Entwicklung nutzt die App einen eigenen App-Datenordner `Markdown Office Dev` neben `Markdown Office`. So teilen eine installierte App und die Entwicklungsversion nie Einstellungen, Sitzung oder Single-Instance-Sperre. `MDO_USER_DATA` (Tests) überschreibt den Ordner.

## Projektstruktur

```
src/main/       Main-Prozess: Dateien, Export, Sitzung, Menü, Fenster
src/preload/    sichere Brücke window.mdo
src/renderer/   Editor (CodeMirror 6), Tabs, Oberfläche
src/shared/     gemeinsame Typen und IPC-Kanäle
src/core/       gemeinsame Logik für App, CLI und später MCP (ohne Electron und Node-Module)
src/cli/        der Befehl markdown-office (TypeScript, gebündelt zu pipeline/cli.js im Paket)
pipeline/       Markdown → PDF/A: build.sh, convert.ps1, lib/markdown.typ, Tests
scripts/        Assets, Signieren, Installation, Release
tests/          Unit- und Ende-zu-Ende-Tests des Editors
docs/           Release-Ablauf
```

## Versionierung

[CalVer](https://calver.org/) im Format `YY.M.MICRO`. Die einzige Quelle ist `package.json`; den Ablauf beschreibt [docs/github-release.md](docs/github-release.md).

## Mitwirken

Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Sicherheit

Sicherheitslücken bitte nicht als öffentliches Issue melden, siehe [SECURITY.md](SECURITY.md).

## Changelog

Siehe [CHANGELOG.md](CHANGELOG.md).

## Lizenz

Copyright © 2026 jcmx9. Markdown Office ist freie Software unter der **GNU Affero General Public License, Version 3 oder später** (AGPL-3.0-or-later), siehe [LICENSE](LICENSE). Du darfst das Programm nutzen, auch geschäftlich, es verändern und weitergeben. Wer eine veränderte Fassung weitergibt oder als Netzwerkdienst anbietet, muss deren vollständigen Quelltext unter derselben Lizenz offenlegen. Für eine Nutzung außerhalb der AGPL, etwa in einem geschlossenen Produkt, ist eine gesonderte kommerzielle Lizenz möglich; Anfragen über ein Issue im Repository. Das Programm wird ohne jede Gewährleistung bereitgestellt.

Versionen bis einschließlich 26.10.0 wurden unter der MIT-Lizenz veröffentlicht; ab 26.10.1 gilt die AGPL. Die Vorlagen-Sets (`memo`, `din5008a`) bleiben unter MIT, damit für die erzeugten Dokumente keine Pflichten entstehen. Mitgelieferte Schriften, Typst und Typst-Packages stehen unter ihren eigenen Lizenzen (siehe [Schriften und Lizenzen](#schriften-und-lizenzen)).
