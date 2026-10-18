#!/usr/bin/env bash
# End-to-End-Test: baut die Testnotizen aus pipeline/tests/fixtures/ mit
# build.sh und prüft den Text der erzeugten PDFs (pdftotext oder mutool) sowie
# die Schnittstelle (Ausgabepfad, Exit-Codes, eingebettete Quelle, minimaler PATH).
#
# Layout: getestet wird build.sh im Pipeline-Ordner MDO_PIPELINE_ROOT mit den
# Sets in MDO_SETS_DIR. Ohne MDO_PIPELINE_ROOT baut der Test das
# Entwicklungs-Layout build/pipeline-dev/ (tests/dev-layout.sh, braucht
# build/pipeline-assets aus `npm run assets`), das dem gepackten Layout der App
# entspricht. Alles, was der Test schreibt, liegt in einem mktemp-Ordner; eigene
# Vorlagen liest er nur aus MDO_TEMPLATES (dort), nie aus ~/Documents.
#
# Usage: bash pipeline/tests/test-pdf.sh
set -euo pipefail

test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly test_dir
if [[ -z "${MDO_PIPELINE_ROOT:-}" ]]; then
  dev="$(bash "${test_dir}/dev-layout.sh")"
  export MDO_PIPELINE_ROOT="${dev}/pipeline"
  export MDO_SETS_DIR="${dev}/sets"
fi
export MDO_SETS_DIR="${MDO_SETS_DIR:-${MDO_PIPELINE_ROOT}/../sets}"
readonly build="${MDO_PIPELINE_ROOT}/build.sh"
readonly fixtures="${test_dir}/fixtures"
readonly version="${MDO_VERSION:-dev}"
export MDO_NO_OPEN=1

out_dir="$(mktemp -d)"
cleanup() { rm -rf "${out_dir}"; }
trap cleanup EXIT
# Leerer Vorlagen-Ordner mit Leerzeichen: kein Set aus ~/Documents verfälscht den Test.
export MDO_TEMPLATES="${out_dir}/Keine Vorlagen"
mkdir -p "${MDO_TEMPLATES}"

die() {
  printf 'FEHLER: %s\n' "$*" >&2
  exit 1
}

# grep, das die Eingabe ganz liest: `cmd | grep -q` beendet sich beim ersten
# Treffer, cmd bekommt SIGPIPE (macOS strings: "failed to flush output") und
# pipefail macht daraus einen zufälligen Fehler.
quiet_grep() { grep "$@" >/dev/null; }

pdf_text() {
  if command -v pdftotext >/dev/null 2>&1; then
    pdftotext -layout "$1" -
  elif command -v mutool >/dev/null 2>&1; then
    mutool draw -q -F txt "$1"
  else
    die "pdftotext (poppler) oder mutool (mupdf) wird benötigt"
  fi
}

# Namen der eingebetteten Dateien (leer, wenn keine).
attachments() {
  mutool show "$1" trailer/Root/Names/EmbeddedFiles 2>/dev/null | grep -o '([^)]*)' | tr -d '()' || true
}

# render <fixture> [build-optionen…]: baut aus dem Fixture-Ordner heraus (wie
# ein Editor: Arbeitsverzeichnis = Ordner der Notiz) und gibt den PDF-Text aus.
render() {
  local name="$1" pdf="${out_dir}/${1%.md}.pdf"
  shift
  (cd "${fixtures}" && bash "${build}" "$@" "${name}" "${pdf}" >/dev/null 2>"${out_dir}/${name}.err") ||
    die "${name}: Export fehlgeschlagen: $(cat "${out_dir}/${name}.err")"
  [[ -s "${pdf}" ]] || die "${name}: leeres PDF"
  strings "${pdf}" | quiet_grep 'part>3</pdfaid:part' || die "${name}: kein PDF/A-3"
  pdf_text "${pdf}"
}

# expect <name> <text> <string>…: jeder String muss im Text vorkommen.
expect() {
  local name="$1" text="$2" s
  shift 2
  for s in "$@"; do
    grep -qF -- "${s}" <<<"${text}" || die "${name}: fehlt \"${s}\""
  done
}

# expect_compact <name> <text> <string>…: wie expect, aber ohne Leerraum
# verglichen – für gesperrten Text (tracking), den die Extraktion zerlegt.
expect_compact() {
  local name="$1" text s
  text="$(tr -d '[:space:]' <<<"$2")"
  shift 2
  for s in "$@"; do
    grep -qF -- "$(tr -d '[:space:]' <<<"${s}")" <<<"${text}" || die "${name}: fehlt \"${s}\""
  done
}

# expect_line <name> <text> <string>…: der String steht als eigene Zeile
# (nur Leerraum davor/danach) – prüft Zeilenumbrüche im Layout.
expect_line() {
  local name="$1" text="$2" s
  shift 2
  for s in "$@"; do
    awk -v want="${s}" '{ sub(/^[ \t]+/, ""); sub(/[ \t]+$/, "") } $0 == want { found = 1 } END { exit !found }' \
      <<<"${text}" || die "${name}: \"${s}\" steht nicht als eigene Zeile"
  done
}

# reject <name> <text> <string>…: kein String darf im Text vorkommen.
reject() {
  local name="$1" text="$2" s
  shift 2
  for s in "$@"; do
    if grep -qF -- "${s}" <<<"${text}"; then
      die "${name}: unerwartet \"${s}\""
    fi
  done
}

ok() { printf 'ok   %s\n' "$*"; }

# xmin <pdf> <wort>: linke Kante (pt) des ersten Vorkommens (pdftotext -bbox).
xmin() {
  pdftotext -bbox "$1" - | grep -F ">$2<" | head -n 1 | sed -E 's/.*xMin="([0-9.]+)".*/\1/'
}

# xmax <pdf> <wort>: rechte Kante (pt) jedes Vorkommens des Wortes (pdftotext -bbox).
xmax() {
  pdftotext -bbox "$1" - | grep -F ">$2<" | sed -E 's/.*xMax="([0-9.]+)".*/\1/'
}

test_fixtures() {
  # Spiegel des Pipeline-Ordners mit einem Test-logo.svg (Textmarke PIPELOGO):
  # macht die Erkennung unabhängig vom ausgelieferten Logo, das keinen Text hat.
  local mroot="${out_dir}/pipeline-marker" entry
  mkdir -p "${mroot}"
  for entry in "${MDO_PIPELINE_ROOT}"/*; do
    [[ "$(basename "${entry}")" == "logo.svg" ]] || ln -s "${entry}" "${mroot}/$(basename "${entry}")"
  done
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60"><text x="5" y="40" font-family="SourceSans3VF" font-size="30">PIPELOGO</text></svg>\n' >"${mroot}/logo.svg"
  local text

  # Hastig getippte Notiz ohne Titel/Front Matter darf nie scheitern.
  text="$(render edge-cases.md)"
  expect edge-cases.md "${text}" "Notiz ohne Titel" "Überschrift direkt auf Ebene drei" "leer links" \
    "Aufgabe ohne alles" "edge-cases.pdf"
  ok edge-cases.md

  # HTML-Kommentare (ein- und mehrzeilig) und [//]: # bleiben unsichtbar und
  # verschlucken keinen Text danach; in Code-Blöcken ist <!-- nur Text.
  text="$(render comments.md)"
  expect comments.md "${text}" "Vor den Kommentaren." "Mitten im Absatz" "und weiter im Absatz." \
    "CODE-SICHTBAR" "Nach den Kommentaren – mit Halbgeviertstrich."
  reject comments.md "${text}" "VERSTECKT" "–>"
  ok comments.md

  # Leere Felder werden ignoriert (kein Fehler, kein leerer Rest).
  text="$(render empty-fields.md)"
  expect_compact empty-fields.md "${text}" "MUSTER GMBH"
  expect empty-fields.md "${text}" "Leere Kopfdaten" "Alle optionalen Felder sind leer."
  ok empty-fields.md

  # Titel + Untertitel aus dem Front Matter, mehrere Kapitel, Fußzeile ohne Kunde.
  text="$(render yaml-title.md)"
  expect yaml-title.md "${text}" "Kick-off: Relaunch" "Workshop" "Ziele" "Unterpunkt" "Aufgaben" \
    "Kick-off: Relaunch · Workshop"
  reject yaml-title.md "${text}" "$(date +%d.%m.%Y)"
  ok yaml-title.md

  # Kunde, deutsches Datum, Autorenliste, Fußzeile "Kunde · Titel"; leerer
  # Untertitel und ungültige logo-height (50 %) werden ignoriert.
  text="$(render client-meta.md)"
  expect_compact client-meta.md "${text}" "MUSTER GMBH"
  expect client-meta.md "${text}" "Kick-off" "12. Oktober 2026 · jcmx9, Ben Probe" \
    "Muster GmbH · Kick-off" "Seite 1 / 1"
  # PDF-Metadaten: Autor(en), Stichwörter mit Kunde und Markdown-Office-Version.
  if command -v pdfinfo >/dev/null 2>&1; then
    local info
    info="$(pdfinfo "${out_dir}/client-meta.pdf")"
    expect "client-meta.md Metadaten" "${info}" "jcmx9, Ben Probe" "Muster GmbH, Markdown Office ${version}"
    grep -q '^Subject: *Kick-off$' <<<"${info}" || die "client-meta.md: Thema ist nicht der Titel"
    # Ohne author: kein Autor, ohne title: kein Thema.
    info="$(pdfinfo "${out_dir}/edge-cases.pdf")"
    if grep -qE '^(Author|Subject):' <<<"${info}"; then die "edge-cases.md: Autor/Thema ohne YAML gesetzt"; fi
  fi
  ok client-meta.md

  # Englische Beschriftungen.
  text="$(render english.md)"
  expect_compact english.md "${text}" "EXAMPLE LTD"
  # shellcheck disable=SC1112
  expect english.md "${text}" "Example Ltd" "Kick-off" "Page 1 /" "NOTE" "English alert titles." \
    "Task" "Owner" "Due" "Status" "17 Oct" "Ben Probe" "October 17, 2026" \
    'He said “hello” – it’s fine… and ‘single’.'
  reject english.md "${text}" "[!NOTE]" "– jcmx9"
  reject english.md "${text}" "Seite"
  ok english.md

  # Ohne title: kein Titel – "#" bleibt ein Kapitel; PDF-Titel = Dateiname.
  text="$(render h1-chapter.md)"
  expect h1-chapter.md "${text}" "Kapitel ohne Titel" "Abschnitt" "h1-chapter.pdf"
  pdfinfo "${out_dir}/h1-chapter.pdf" | quiet_grep '^Title: *h1-chapter$' ||
    die "h1-chapter.md: PDF-Titel ist nicht der Dateiname"
  ok h1-chapter.md

  # toc: true + h1_break: false: kein Seitenumbruch nach dem Inhaltsverzeichnis,
  # der Text beginnt darunter – ohne den letzten Eintrag zu überlappen.
  text="$(render toc-no-break.md)"
  expect "toc-no-break.md Seite 1" "$(pdftotext -f 1 -l 1 "${out_dir}/toc-no-break.pdf" - 2>/dev/null || mutool draw -q -F txt "${out_dir}/toc-no-break.pdf" 1)" \
    "Inhalt" "Einleitung direkt unter dem Inhaltsverzeichnis." "Kurzer Text in Kapitel 1."
  if command -v pdftotext >/dev/null 2>&1; then
    local toc_last intro_top
    toc_last="$(pdftotext -f 1 -l 1 -bbox "${out_dir}/toc-no-break.pdf" - | grep -F '>Kapitel<' | sed -n 8p | sed -E 's/.*yMax="([0-9.]+)".*/\1/')"
    intro_top="$(pdftotext -f 1 -l 1 -bbox "${out_dir}/toc-no-break.pdf" - | grep -F '>Einleitung<' | sed -E 's/.*yMin="([0-9.]+)".*/\1/')"
    awk -v a="${toc_last}" -v b="${intro_top}" 'BEGIN { exit !(a != "" && b != "" && a + 5 < b) }' ||
      die "toc-no-break.md: Text überlappt das Inhaltsverzeichnis"
  fi
  ok toc-no-break.md

  # Hinweisboxen: GitHub- und deutsche Schlüsselwörter, deutsche Titel.
  text="$(render alerts.md)"
  expect alerts.md "${text}" "INFO" "TIPP" "WICHTIG" "HINWEIS" "ACHTUNG" "Ruhiges Orange." \
    "Deutsches Schlüsselwort mit Text in derselben Zeile." "Liste in der Box" \
    "Ein normales Zitat bleibt ein Zitat."
  reject alerts.md "${text}" "[!NOTE]" "[!HINWEIS]" "[!TIP]"
  ok alerts.md

  # Aufgabentabelle mit Wer/Bis; gemischte Liste bleibt Liste.
  text="$(render tasks.md)"
  expect tasks.md "${text}" "Aufgabe" "Wer" "Bis" "Status" "Sitemap-Entwurf erstellen" "jcmx9" \
    "Ben Probe" "15.10." "Anna Beispiel" "Offener Punkt ohne Zuständigkeit" \
    "Ein normaler Punkt" "Erledigte Aufgabe – bleibt Liste"
  reject tasks.md "${text}" "– jcmx9" ", bis 17.10." "[ ]" "[x]"
  ok tasks.md

  # Checkliste ohne Namen/Termine: nur Aufgabe + Status (lose Liste, kein Absturz).
  text="$(render checklist.md)"
  expect checklist.md "${text}" "Aufgabe" "Status" "Ohne Zuständigkeit bleibt es eine Checkliste" "Erledigt"
  reject checklist.md "${text}" "Wer" "Bis"
  ok checklist.md

  # Anführungszeichen wie getippt, Markierung, Datumszeilen, Seitenumbrüche;
  # Code bleibt unverändert.
  text="$(render text-features.md)"
  # shellcheck disable=SC1111,SC1112
  expect text-features.md "${text}" '„Deutsche Anführungszeichen“' '‚einfache‘' '»Guillemets«' \
    '„gerade“' '‚einfach gerade‘' 'geht’s' 'Seite 3–5' 'Gedanke—Strich' 'Moment…' \
    "Text mit markiert" "==kein Mark im Code==" "==bleibt Code==" '\newpage' \
    "1. Echte Liste" "Seite drei."
  # Code bleibt unverändert (Zeilenumbruch im Blocksatz -> ohne Leerraum prüfen)
  expect_compact text-features.md "${text}" 'echo "x" --flag ...'
  expect_line text-features.md "${text}" "18. Oktober 2026" "19. Okt. 2026" "1. Dez. 2026"
  # shellcheck disable=SC1111
  reject text-features.md "${text}" "==markiert==" "pagebreak" '"gerade"' '“gerade”' '3--5' 'Moment...'
  pdfinfo "${out_dir}/text-features.pdf" | quiet_grep '^Pages: *3$' ||
    die "text-features.md: Seitenumbrüche fehlen (erwartet 3 Seiten)"
  ok text-features.md

  # Zeilenumbrüche: Standard hart (auch ohne Eintrag), nur --soft-breaks bzw.
  # hard_breaks: false macht sie weich.
  text="$(render soft-breaks.md)"
  expect_line soft-breaks.md "${text}" "Zeile eins" "Zeile zwei"
  reject soft-breaks.md "${text}" "\\" "Zeile eins Zeile zwei"
  text="$(render soft-breaks.md --hard-breaks)"
  expect_line "soft-breaks.md --hard-breaks" "${text}" "Zeile eins" "Zeile zwei"
  text="$(render soft-breaks.md --soft-breaks)"
  expect "soft-breaks.md --soft-breaks" "${text}" "Zeile eins Zeile zwei"
  printf -- '---\nhard_breaks: false\n---\n\nZeile eins\nZeile zwei\n' >"${out_dir}/weich.md"
  (cd "${out_dir}" && bash "${build}" weich.md weich.pdf >/dev/null 2>&1) || die "weich.md: Export fehlgeschlagen"
  expect "hard_breaks: false" "$(pdf_text "${out_dir}/weich.pdf")" "Zeile eins Zeile zwei"
  ok "soft-breaks.md (Standard hart, --hard-breaks, --soft-breaks, hard_breaks: false)"

  # Notiz ohne Leerzeilen, harte Umbrüche per Front Matter.
  text="$(render no-blank-lines.md)"
  expect no-blank-lines.md "${text}" "Agenda" "Mitschrift" "Das ist zu tun" "Markierung" "Abschluss"
  expect_line no-blank-lines.md "${text}" "Letzte Zeile." "Noch eine Zeile." "18. Oktober 2026" \
    "Text direkt danach mit Markierung."
  reject no-blank-lines.md "${text}" "# Mitschrift" "==Markierung==" "\\"
  ok no-blank-lines.md

  # Tabellen: Spaltenbreiten nach Inhalt, Zahlen rechtsbündig, Kopf wiederholt.
  text="$(render tables.md)"
  expect tables.md "${text}" "Donaudampfschifffahrtsgesellschaftskapitänsmütze" "1.250,00 €" "17.10.2026"
  if command -v pdftotext >/dev/null 2>&1; then
    local pdf="${out_dir}/tables.pdf" edges
    # Beträge unterschiedlicher Länge enden an derselben Kante (rechtsbündig).
    edges="$(for w in 520,00 1.250,00 9,50; do xmax "${pdf}" "${w}"; done |
      awk 'NR == 1 { a = $1 } { d = $1 - a; if (d < 0) d = -d; if (d > 0.5) bad = 1 } END { print bad + 0 }')"
    [[ "${edges}" == 0 ]] || die "tables.md: Beträge nicht rechtsbündig"
    # Kleine Tabelle bleibt in Inhaltsbreite (Satzspiegel endet bei ~538 pt).
    awk '{ exit !($1 < 400) }' <<<"$(xmax "${pdf}" Verantwortlich)" ||
      die "tables.md: kleine Tabelle auf volle Breite gezogen"
    # Lange Tabelle: Kopfzeile wiederholt sich auf Seite 2.
    expect "tables.md Seite 2" "$(pdftotext -f 2 -l 2 -layout "${pdf}" -)" "Position" "Betrag"
  fi
  ok tables.md

  # Tabellen-Sammlung: Zahlen (auch negativ, mit Einheiten), Text, Mischformen,
  # Grenzfälle. Kein Wort wird in Zellen getrennt (keine Silbentrennung),
  # Zahlenspalten rechtsbündig, lange Tabelle mit wiederholtem Kopf.
  text="$(render tables-showcase.md)"
  expect tables-showcase.md "${text}" "4.736,08 €" "−4.074.980 €" "+27,9 %" "Besuche" "Anfragen" \
    "±0,5 mm" "Besprechungsraum 2" "Donaudampfschifffahrtsgesellschaftskapitänsmützenhalterung" \
    "Schreibtischunterlage" "20.271,90 €"
  reject tables-showcase.md "${text}" "Besu-" "Anfra-" "| --"
  if command -v pdftotext >/dev/null 2>&1; then
    local sc="${out_dir}/tables-showcase.pdf"
    edges="$(for w in 1.245.300 −987.200 258.100; do xmax "${sc}" "${w}"; done |
      awk 'NR == 1 { a = $1 } { d = $1 - a; if (d < 0) d = -d; if (d > 0.5) bad = 1 } END { print bad + 0 }')"
    [[ "${edges}" == 0 ]] || die "tables-showcase.md: Quartalszahlen nicht rechtsbündig"
    # 13 schmale Spalten: die erste Spalte darf nicht in die zweite laufen.
    awk -v a="$(xmax "${sc}" Besuche | head -n 1)" -v b="$(xmin "${sc}" 1.204)" 'BEGIN { exit !(a < b) }' ||
      die "tables-showcase.md: Monatstabelle – Spalten überlappen"
  fi
  # Aufgaben-Kapitel: Wer/Bis-Varianten, Termin ohne Namen (due/by), Checkliste,
  # lose Liste, Strich-Varianten, gemischte Liste bleibt Liste.
  expect tables-showcase.md "${text}" "Kick-off-Protokoll verschicken" "KW 44" "17 Oct" "Friday" \
    "Impressum aktualisieren" "Dritte Aufgabe" "Geviertstrich" "Ein Gedankenstrich – im Aufgabentext" \
    "Schriftwahl offen – Anna Beispiel, bis 09.11." "Aufgabe 12"
  reject tables-showcase.md "${text}" "due 17 Oct" "by Friday" ", bis 19.10." "— Ben Probe" "[ ]" "[x]"
  ok tables-showcase.md

  # Eine kurze Einleitung vor einer Tabelle steht nie allein unten auf der
  # Seite: passt die Tabelle nicht mehr, wandert die Einleitung mit.
  text="$(render table-intro.md)"
  expect table-intro.md "${text}" "Die folgende Übersicht zeigt alle Posten:" "Posten 15"
  if command -v pdftotext >/dev/null 2>&1; then
    local tpdf="${out_dir}/table-intro.pdf"
    if pdftotext -f 1 -l 1 "${tpdf}" - | quiet_grep "Übersicht zeigt"; then
      die "table-intro.md: Einleitung allein auf Seite 1"
    fi
    pdftotext -f 2 -l 2 "${tpdf}" - | quiet_grep "Übersicht zeigt" ||
      die "table-intro.md: Einleitung nicht bei der Tabelle auf Seite 2"
  fi
  ok table-intro.md

  # Bilder: Breite aus {width=…}, Remote-Bild übersprungen, Bildunterschrift.
  text="$(render images.md)"
  expect images.md "${text}" "Abbildung 1: Screenshot aus dem Termin" "Ende der Bilder."
  reject images.md "${text}" "{width" "Remote wird übersprungen"
  if command -v pdfimages >/dev/null 2>&1; then
    [[ "$(pdfimages -list "${out_dir}/images.pdf" | tail -n +3 | wc -l | tr -d ' ')" -ge 2 ]] ||
      die "images.md: Bilder nicht eingebettet"
  fi
  ok images.md

  # Absolute Pfade über Umgebungsvariablen ($VAR, ${VAR} fürs Logo); ein
  # fehlendes Bild hinterlässt einen Hinweis statt den Export abzubrechen.
  text="$(MDO_PIPELINE_ROOT="${mroot}" TEST_ASSETS="${fixtures}" render absolute-paths.md)"
  expect absolute-paths.md "${text}" "Abbildung 1: Absolut über Variable" \
    "[Bild fehlt: bilder/gibt-es-nicht.png]" "Text nach den Bildern."
  grep -q "Bild nicht gefunden: bilder/gibt-es-nicht.png" "${out_dir}/absolute-paths.md.err" ||
    die "absolute-paths.md: keine Warnung auf stderr"
  reject absolute-paths.md "${text}" "PIPELOGO"   # Notiz-Logo statt Pipeline-Logo
  ok absolute-paths.md

  # Logo nur mit logo: im Frontmatter; ohne Schlüssel nie, auch wenn im
  # Programmordner ein logo.svg liegt.
  text="$(MDO_PIPELINE_ROOT="${mroot}" render tasks.md)"
  reject tasks.md "${text}" "PIPELOGO"
  ok "ohne logo: kein Logo"

  # Suchreihenfolge für einen relativen logo:-Wert: Ordner der Notiz, dann
  # Benutzerordner, dann Vorlagen-Ordner, dann Pipeline-Ordner. Nicht
  # gefunden: ohne Logo, Exit 0.
  local ldir="${out_dir}/logo-suche" lhome="${out_dir}/logo-home" lvorl="${out_dir}/logo-vorlagen" lout
  mkdir -p "${ldir}" "${lhome}" "${lvorl}"
  svg_text() {
    printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60"><text x="5" y="40" font-family="SourceSans3VF" font-size="30">%s</text></svg>\n' "$1"
  }
  logo_build() {
    printf -- '---\nlogo: %s\n---\n\nText.\n' "$1" >"${ldir}/n.md"
    (cd "${ldir}" && HOME="${lhome}" MDO_TEMPLATES="${lvorl}" MDO_PIPELINE_ROOT="${mroot}" bash "${build}" n.md "${out_dir}/logo.pdf" \
      >/dev/null 2>"${out_dir}/logo.err") || die "logo: ${1}: Export fehlgeschlagen: $(cat "${out_dir}/logo.err")"
    pdf_text "${out_dir}/logo.pdf"
  }
  svg_text NOTIZLOGO >"${ldir}/mein-logo.svg"
  svg_text HOMELOGO >"${lhome}/mein-logo.svg"
  svg_text VORLAGENLOGO >"${lvorl}/mein-logo.svg"
  lout="$(logo_build mein-logo.svg)"
  expect "logo: Notizordner" "${lout}" "NOTIZLOGO"
  reject "logo: Notizordner" "${lout}" "HOMELOGO"
  rm "${ldir}/mein-logo.svg"
  lout="$(logo_build mein-logo.svg)"
  expect "logo: Benutzerordner" "${lout}" "HOMELOGO"
  reject "logo: Benutzerordner" "${lout}" "VORLAGENLOGO"
  # shellcheck disable=SC2088  # ~ soll wörtlich ins Frontmatter
  lout="$(logo_build '~/mein-logo.svg')"
  expect "logo: ~/" "${lout}" "HOMELOGO"
  rm "${lhome}/mein-logo.svg"
  lout="$(logo_build mein-logo.svg)"
  expect "logo: Vorlagen-Ordner" "${lout}" "VORLAGENLOGO"
  svg_text VORLAGENLOGO >"${lvorl}/logo.svg"
  lout="$(logo_build logo.svg)"
  expect "logo: Vorlagen vor Pipeline" "${lout}" "VORLAGENLOGO"
  reject "logo: Vorlagen vor Pipeline" "${lout}" "PIPELOGO"
  rm "${lvorl}/logo.svg"
  lout="$(logo_build logo.svg)"
  expect "logo: Pipeline-Ordner" "${lout}" "PIPELOGO"
  lout="$(logo_build fehlt.svg)"
  reject "logo: fehlt" "${lout}" "PIPELOGO" "HOMELOGO" "VORLAGENLOGO"
  grep -q "Logo nicht gefunden: fehlt.svg" "${out_dir}/logo.err" || die "logo: fehlt: kein Hinweis"
  lout="$(logo_build mein-logo.txt)"
  reject "logo: falsche Endung" "${lout}" "VORLAGENLOGO"
  grep -q "Logo muss .svg" "${out_dir}/logo.err" || die "logo: falsche Endung: kein Hinweis"
  ok "logo: Suchreihenfolge Notiz → Benutzer → Vorlagen → Pipeline"

  # Das ausgelieferte pipeline/logo.svg (ohne Text) lässt sich einbinden.
  printf -- '---\nlogo: logo.svg\n---\n\nText.\n' >"${ldir}/n.md"
  (cd "${ldir}" && HOME="${lhome}" bash "${build}" n.md "${out_dir}/logo.pdf" \
    >/dev/null 2>"${out_dir}/logo.err") || die "ausgeliefertes Logo: Export fehlgeschlagen: $(cat "${out_dir}/logo.err")"
  ! grep -q "Logo nicht gefunden" "${out_dir}/logo.err" || die "ausgeliefertes Logo: nicht gefunden"
  ok "ausgeliefertes logo.svg wird eingebunden"

  # Mermaid offline: Beschriftungen als Text im PDF, kein Quelltext.
  text="$(render mermaid.md)"
  expect mermaid.md "${text}" "Kick-off" "Konzept ok?" "Design" "Briefing" "Angebot" \
    "Text nach dem Diagramm."
  reject mermaid.md "${text}" "flowchart LR" "sequenceDiagram" "-->"
  ok mermaid.md

  # Lange Fußzeile (Kunde · Titel): auf eine Zeile mit „…“ gekürzt, Abstand zur
  # Seitenzahl bleibt.
  text="$(render long-footer.md)"
  expect long-footer.md "${text}" "Muster Beratungsgesellschaft mbH · Kick…" "Seite 1 / 1"
  if command -v pdftotext >/dev/null 2>&1; then
    awk -v a="$(xmax "${out_dir}/long-footer.pdf" Kick… | tail -n 1)" \
        -v b="$(xmin "${out_dir}/long-footer.pdf" Seite)" 'BEGIN { exit !(a != "" && b != "" && a + 15 < b) }' ||
      die "long-footer.md: Fußzeilentext läuft an die Seitenzahl heran"
  fi
  ok long-footer.md

  # Frontmatter: Inline-Kommentare, Quotes, Listen, auto und leere Bool-Werte –
  # ohne eine einzige Warnung.
  text="$(render frontmatter-parsing.md)"
  expect frontmatter-parsing.md "${text}" "Titel mit Kommentar" "Ohne Anführungszeichen" \
    "Anna Beispiel, Ben Probe" "Inhalt."
  expect_compact frontmatter-parsing.md "${text}" "EINFACHE ANFÜHRUNGSZEICHEN"
  reject frontmatter-parsing.md "${text}" "Kommentar gehört" "# auch" '"'
  if grep -q "Warnung" "${out_dir}/frontmatter-parsing.md.err"; then
    die "frontmatter-parsing.md: unerwartete Warnung: $(cat "${out_dir}/frontmatter-parsing.md.err")"
  fi
  ok frontmatter-parsing.md

  # Header-Vorlage des Sets memo (alle Schlüssel mit Standardwerten) baut ohne Warnung.
  cp "${MDO_SETS_DIR}/memo/memo.header.md" "${out_dir}/header.md"
  (cd "${out_dir}" && bash "${build}" header.md "${out_dir}/header.pdf" >/dev/null 2>"${out_dir}/header.err") ||
    die "memo.header.md: Export fehlgeschlagen: $(cat "${out_dir}/header.err")"
  if grep -q "Warnung" "${out_dir}/header.err"; then
    die "memo.header.md: unerwartete Warnung: $(cat "${out_dir}/header.err")"
  fi
  ok memo.header.md
}

test_interface() {
  local err code text

  # Ausdrücklich angegebene Ausgabe: exakt dieser Pfad, kein ISO-Präfix.
  (cd "${fixtures}" && bash "${build}" client-meta.md "${out_dir}/exakt.pdf" >/dev/null 2>&1)
  [[ -s "${out_dir}/exakt.pdf" ]] || die "Ausgabe nicht exakt geschrieben"
  [[ ! -e "${out_dir}/2026-10-12_exakt.pdf" && ! -e "${fixtures}/2026-10-12_client-meta.pdf" ]] ||
    die "ISO-Präfix trotz ausdrücklicher Ausgabe"
  ok "Ausgabe exakt"

  # Ohne Ausgabe: neben der Quelle, deutsches Datum -> ISO-Präfix.
  cp "${fixtures}/client-meta.md" "${fixtures}/logo.png" "${out_dir}/"
  (cd "${out_dir}" && bash "${build}" client-meta.md >/dev/null 2>&1)
  [[ -s "${out_dir}/2026-10-12_client-meta.pdf" ]] || die "ISO-Präfix aus 12.10.2026 fehlt"
  ok "ISO-Präfix aus deutschem Datum"

  # Fehlende Quelle: Exit != 0, kurze Meldung auf stderr.
  code=0
  err="$(bash "${build}" "${out_dir}/gibt-es-nicht.md" "${out_dir}/x.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -ne 0 ]] || die "fehlende Quelle liefert Exit 0"
  grep -q "Quelle nicht gefunden" <<<"${err}" || die "fehlende Quelle: unklare Meldung: ${err}"
  ok "Exit-Code bei fehlender Quelle (${code})"

  # Unbekannte Option: Exit 2.
  code=0
  bash "${build}" --gibt-es-nicht >/dev/null 2>&1 || code=$?
  [[ "${code}" -eq 2 ]] || die "unbekannte Option liefert Exit ${code}"
  ok "Exit-Code bei unbekannter Option"

  # '--' beendet die Optionen: danach ist auch '-strich.md' eine Quelle (Parität zu convert.ps1).
  printf -- '# Strich\n\nText.\n' >"${out_dir}/-strich.md"
  code=0
  (cd "${out_dir}" && bash "${build}" --no-source -- -strich.md "${out_dir}/strich.pdf" >/dev/null 2>&1) || code=$?
  [[ "${code}" -eq 0 && -s "${out_dir}/strich.pdf" ]] || die "'--' als Ende der Optionen: Exit ${code}"
  ok "'--' beendet die Optionen"

  # Ohne Quelle: Hilfe, Exit 0, kein PDF – weder im Arbeitsordner noch im
  # Pipeline-Ordner (in der App das signierte Bundle).
  local noarg="${out_dir}/ohne argumente" before after
  mkdir -p "${noarg}"
  before="$(find -L "${MDO_PIPELINE_ROOT}" -name '*.pdf' | sort)"
  code=0
  text="$(cd "${noarg}" && bash "${build}" 2>&1)" || code=$?
  after="$(find -L "${MDO_PIPELINE_ROOT}" -name '*.pdf' | sort)"
  [[ "${code}" -eq 0 ]] || die "ohne Argumente: Exit ${code}"
  grep -q '^Usage:' <<<"${text}" || die "ohne Argumente: keine Hilfe: ${text}"
  [[ -z "$(find "${noarg}" -name '*.pdf')" && "${before}" == "${after}" ]] ||
    die "ohne Argumente: PDF erzeugt"
  ok "ohne Argumente: Hilfe, Exit 0, kein PDF"

  # Eingebettete Quelle: Standard an (nur Dateiname, kein lokaler Pfad),
  # aus per --no-source oder embed_source: false.
  if command -v mutool >/dev/null 2>&1; then
    [[ "$(attachments "${out_dir}/edge-cases.pdf")" == "edge-cases.md" ]] ||
      die "eingebettete Quelle fehlt oder trägt einen Pfad: $(attachments "${out_dir}/edge-cases.pdf")"
    render edge-cases.md --no-source >/dev/null
    [[ -z "$(attachments "${out_dir}/edge-cases.pdf")" ]] || die "--no-source bettet trotzdem ein"
    render no-source.md >/dev/null
    [[ -z "$(attachments "${out_dir}/no-source.pdf")" ]] || die "embed_source: false bettet trotzdem ein"
    ok "Quelle einbetten / --no-source / embed_source: false"
  else
    printf 'skip Einbettung (mutool fehlt)\n'
  fi

  # Absolute Pfade mit Leerzeichen (so rufen andere Programme auf), Aufruf aus
  # einem fremden Arbeitsverzeichnis: das PDF entsteht genau am Zielpfad.
  local in_dir="${out_dir}/Notiz Ordner" target_dir="${out_dir}/Aus gabe"
  mkdir -p "${in_dir}/bilder" "${target_dir}"
  cp "${fixtures}/edge-cases.md" "${in_dir}/meine notiz.md"
  cp "${fixtures}/bilder/screenshot.png" "${in_dir}/bilder/"
  (cd / && bash "${build}" --no-source --hard-breaks "${in_dir}/meine notiz.md" "${target_dir}/mein pdf.pdf" \
    >/dev/null 2>"${out_dir}/spaces.err") || die "Pfade mit Leerzeichen: Export fehlgeschlagen: $(cat "${out_dir}/spaces.err")"
  [[ -s "${target_dir}/mein pdf.pdf" ]] || die "Pfade mit Leerzeichen: PDF fehlt am Zielpfad"
  ok "absolute Pfade mit Leerzeichen"

  # Temporäre Kopie (Export ungespeicherter Änderungen): Bilder gelten über
  # MDO_BASE_DIR relativ zum Originalordner; Name in Fußzeile, PDF-Titel und
  # Anhang bleibt der der Notiz (die Kopie trägt denselben Dateinamen).
  local tmp_copy="${out_dir}/tmpkopie"
  mkdir -p "${tmp_copy}"
  cp "${fixtures}/edge-cases.md" "${tmp_copy}/edge-cases.md"
  (cd "${fixtures}" && MDO_BASE_DIR="${fixtures}" bash "${build}" "${tmp_copy}/edge-cases.md" \
    "${out_dir}/basis.pdf" >/dev/null 2>"${out_dir}/basis.err") ||
    die "MDO_BASE_DIR: Export fehlgeschlagen: $(cat "${out_dir}/basis.err")"
  text="$(pdf_text "${out_dir}/basis.pdf")"
  reject "MDO_BASE_DIR" "${text}" "Bild fehlt"
  expect "MDO_BASE_DIR" "${text}" "basis.pdf"
  pdfinfo "${out_dir}/basis.pdf" | quiet_grep '^Title: *edge-cases$' || die "MDO_BASE_DIR: PDF-Titel ist nicht der Notizname"
  if command -v mutool >/dev/null 2>&1; then
    [[ "$(attachments "${out_dir}/basis.pdf")" == "edge-cases.md" ]] || die "MDO_BASE_DIR: Anhangsname falsch"
  fi
  # Gegenprobe: ohne MDO_BASE_DIR fehlt das Bild neben der Kopie.
  (cd "${fixtures}" && bash "${build}" "${tmp_copy}/edge-cases.md" "${out_dir}/ohne-basis.pdf" >/dev/null 2>&1)
  expect "ohne MDO_BASE_DIR" "$(pdf_text "${out_dir}/ohne-basis.pdf")" "Bild fehlt: bilder/screenshot.png"
  # Ungültiger MDO_BASE_DIR: Warnung, Rückfall auf den Ordner der Quelle.
  MDO_BASE_DIR="${out_dir}/gibt-es-nicht" bash "${build}" "${fixtures}/edge-cases.md" "${out_dir}/x.pdf" \
    >/dev/null 2>"${out_dir}/basis2.err" || die "ungültiger MDO_BASE_DIR bricht den Export ab"
  grep -q "MDO_BASE_DIR ist kein Ordner" "${out_dir}/basis2.err" || die "ungültiger MDO_BASE_DIR ohne Warnung"
  ok "MDO_BASE_DIR (temporäre Kopie) + Dateiname"

  # Minimaler PATH wie bei einer GUI-App (Editor, Finder), ohne MDO_*-Variablen:
  # typst kommt aus bin/typst, Pipeline-Ordner und Sets aus dem Ort von build.sh.
  if [[ -x "${MDO_PIPELINE_ROOT}/bin/typst" ]]; then
    (cd "${fixtures}" && env -i HOME="${out_dir}/minpath-home" PATH=/usr/bin:/bin MDO_NO_OPEN=1 \
      bash "${build}" edge-cases.md "${out_dir}/minpath.pdf" >/dev/null 2>"${out_dir}/minpath.err") ||
      die "Build mit minimalem PATH fehlgeschlagen: $(cat "${out_dir}/minpath.err")"
    ok "minimaler PATH"
  else
    printf 'skip minimaler PATH (kein bin/typst im Pipeline-Ordner)\n'
  fi
}

test_templates() {
  local h name

  # Mitgelieferte Sets: jedes <name>/ in MDO_SETS_DIR hat <name>.typ und eine
  # <name>.header.md, die an ihr Set bindet.
  local dir
  for dir in "${MDO_SETS_DIR}"/*/; do
    name="$(basename "${dir}")"
    h="${dir}${name}.header.md"
    [[ -f "${dir}${name}.typ" ]] || die "Set ${name}: ${name}.typ fehlt"
    [[ -f "${h}" ]] || die "Set ${name}: ${name}.header.md fehlt"
    # template: <name>, optional mit Kommentar dahinter (wie jeder Frontmatter-Wert)
    grep -qE "^template: ${name}( +#.*)?$" "${h}" || die "Set ${name}: Header verweist nicht auf das Set"
  done
  [[ -f "${MDO_SETS_DIR}/memo/memo.typ" ]] || die "Set memo fehlt"
  ok "mitgelieferte Sets"

  local sets="${fixtures}/templates" note="${out_dir}/Set Ordner/set notiz.md" text code err
  mkdir -p "${out_dir}/Set Ordner"
  # Notiz ohne Bilder: ein Set ohne safe-image bräche bei fehlenden Bildern ab.
  printf -- '---\ntitle: "Set-Test"\ntemplate: "probe"   # Testset\n---\n\n# Kapitel\n\nText "zitiert".\n' >"${note}"

  # Eigenes Set aus MDO_TEMPLATES über den Frontmatter-Schlüssel (mit Quotes und Kommentar).
  (cd / && MDO_TEMPLATES="${sets}" bash "${build}" "${note}" "${out_dir}/probe.pdf" \
    >/dev/null 2>"${out_dir}/probe.err") || die "Set probe: Export fehlgeschlagen: $(cat "${out_dir}/probe.err")"
  strings "${out_dir}/probe.pdf" | quiet_grep 'part>3</pdfaid:part' || die "Set probe: kein PDF/A-3"
  text="$(pdf_text "${out_dir}/probe.pdf")"
  # shellcheck disable=SC1111
  expect "Set probe" "${text}" "SET-PROBE Set-Test" "Kapitel" "„zitiert“"
  ok "eigenes Set aus MDO_TEMPLATES (Bausteine über sys.inputs.mdo)"

  # Standard-Benutzerordner ~/Documents/Markdown Office/Vorlagen (ohne
  # MDO_TEMPLATES) – mit einem HOME im Testordner, nie im echten ~/Documents.
  local home="${out_dir}/home"
  mkdir -p "${home}/Documents/Markdown Office/Vorlagen"
  cp "${sets}/probe.typ" "${home}/Documents/Markdown Office/Vorlagen/"
  (env -u MDO_TEMPLATES HOME="${home}" bash "${build}" "${note}" "${out_dir}/home.pdf" >/dev/null 2>&1) ||
    die "Set aus ~/Documents/Markdown Office/Vorlagen nicht gefunden"
  expect "Benutzerordner" "$(pdf_text "${out_dir}/home.pdf")" "SET-PROBE"
  ok "Set aus ~/Documents/Markdown Office/Vorlagen"

  # Relatives MDO_TEMPLATES gilt ab dem Arbeitsordner des Aufrufers.
  mkdir -p "${out_dir}/rel/ordner"
  cp "${sets}/probe.typ" "${out_dir}/rel/ordner/"
  (cd "${out_dir}/rel" && MDO_TEMPLATES=ordner bash "${build}" "${note}" "${out_dir}/rel.pdf" >/dev/null 2>&1) ||
    die "relatives MDO_TEMPLATES: Export fehlgeschlagen"
  expect "relatives MDO_TEMPLATES" "$(pdf_text "${out_dir}/rel.pdf")" "SET-PROBE"
  ok "relatives MDO_TEMPLATES ab Arbeitsordner"

  # --template gewinnt über den Frontmatter-Schlüssel; beide Schreibweisen.
  MDO_TEMPLATES="${sets}" bash "${build}" --template memo "${note}" "${out_dir}/cli.pdf" >/dev/null 2>&1 ||
    die "--template memo: Export fehlgeschlagen"
  reject "--template memo" "$(pdf_text "${out_dir}/cli.pdf")" "SET-PROBE"
  printf -- '# Ohne Schlüssel\n' >"${out_dir}/Set Ordner/ohne.md"
  MDO_TEMPLATES="${sets}" bash "${build}" --template=probe "${out_dir}/Set Ordner/ohne.md" "${out_dir}/cli3.pdf" \
    >/dev/null 2>&1 || die "--template=probe: Export fehlgeschlagen"
  expect "--template=probe" "$(pdf_text "${out_dir}/cli3.pdf")" "SET-PROBE"
  ok "--template NAME / --template=NAME vor dem Frontmatter"

  # Gleicher Text mit und ohne ausdrückliches memo.
  [[ "$(render edge-cases.md)" == "$(render edge-cases.md --template memo)" ]] ||
    die "--template memo ändert die Ausgabe"
  ok "memo ausdrücklich = Standard"

  # Ein eigenes memo im Benutzerordner (Pfad mit Leerzeichen) überschattet das mitgelieferte.
  mkdir -p "${out_dir}/Eigene Vorlagen"
  cp "${sets}/probe.typ" "${out_dir}/Eigene Vorlagen/memo.typ"
  MDO_TEMPLATES="${out_dir}/Eigene Vorlagen" bash "${build}" "${out_dir}/Set Ordner/ohne.md" "${out_dir}/schatten.pdf" \
    >/dev/null 2>&1 || die "eigenes memo: Export fehlgeschlagen"
  expect "eigenes memo" "$(pdf_text "${out_dir}/schatten.pdf")" "SET-PROBE"
  ok "Benutzerordner vor mitgelieferten Sets"

  # Set-Ordner im Benutzerordner: <templates>/<name>/<name>.typ (geklontes Set-Repo).
  MDO_TEMPLATES="${sets}" bash "${build}" --template folderset "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/folder.pdf" >/dev/null 2>"${out_dir}/folder.err" ||
    die "Set-Ordner: Export fehlgeschlagen: $(cat "${out_dir}/folder.err")"
  expect "Set-Ordner" "$(pdf_text "${out_dir}/folder.pdf")" "SET-FOLDER"
  # Eine flache <name>.typ gewinnt über den Ordner gleichen Namens.
  mkdir -p "${out_dir}/Flach/probe"
  cp "${sets}/probe.typ" "${out_dir}/Flach/probe.typ"
  cp "${sets}/folderset/folderset.typ" "${out_dir}/Flach/probe/probe.typ"
  MDO_TEMPLATES="${out_dir}/Flach" bash "${build}" --template probe "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/flach.pdf" >/dev/null 2>&1 || die "flach vor Ordner: Export fehlgeschlagen"
  expect "flach vor Ordner" "$(pdf_text "${out_dir}/flach.pdf")" "SET-PROBE"
  ok "Set-Ordner <name>/<name>.typ im Benutzerordner"

  # frontmatter(): Listen, verschachtelte Werte und x-Schlüssel kommen im Set an; die
  # Shell-Parser lesen nur Schlüssel ganz links (eingerückte Zeilen ändern date/title nicht).
  local fmnote="${out_dir}/Set Ordner/fm.md"
  printf -- '---\ndate: 2026-10-18\nx-to:\n  - Sonnenschein Verlag GmbH\n  - Rosenstraße 5\nx-subject: "Ihre Anfrage"\nx-map:\n  inner: tief\n  title: falsch\n  date: 1999-01-01\n---\n\nText.\n' >"${fmnote}"
  MDO_TEMPLATES="${sets}" bash "${build}" --template fm "${fmnote}" "${out_dir}/fm.pdf" \
    >/dev/null 2>"${out_dir}/fm.err" || die "frontmatter(): Export fehlgeschlagen: $(cat "${out_dir}/fm.err")"
  text="$(pdf_text "${out_dir}/fm.pdf")"
  expect "frontmatter()" "${text}" "TO=Sonnenschein Verlag GmbH|Rosenstraße 5" "SUBJ=Ihre Anfrage" \
    "NESTED=tief" "DATEIN=2026-10-18" "EMPTY=0"
  reject "frontmatter()" "${text}" "falsch" "1999"
  [[ ! -s "${out_dir}/fm.err" ]] || die "frontmatter(): Warnungen: $(cat "${out_dir}/fm.err")"
  ok "frontmatter() im Set; eingerückte und x-Zeilen ändern die Pipeline-Werte nicht"

  # Einzelne .typ-Datei relativ zur Notiz (Leerzeichen im Namen), Aufruf aus fremdem cwd.
  cp "${sets}/probe.typ" "${out_dir}/Set Ordner/eigene vorlage.typ"
  printf -- '---\ntemplate: ./eigene vorlage.typ\n---\n\n# Pfad\n' >"${out_dir}/Set Ordner/pfad.md"
  (cd / && bash "${build}" "${out_dir}/Set Ordner/pfad.md" "${out_dir}/pfad.pdf" >/dev/null 2>"${out_dir}/pfad.err") ||
    die "Pfad-Vorlage: Export fehlgeschlagen: $(cat "${out_dir}/pfad.err")"
  expect "Pfad-Vorlage" "$(pdf_text "${out_dir}/pfad.pdf")" "SET-PROBE"
  # Mit MDO_BASE_DIR (temporäre Kopie) gilt der Pfad relativ zum Originalordner.
  mkdir -p "${out_dir}/kopie"
  cp "${out_dir}/Set Ordner/pfad.md" "${out_dir}/kopie/pfad.md"
  MDO_BASE_DIR="${out_dir}/Set Ordner" bash "${build}" "${out_dir}/kopie/pfad.md" "${out_dir}/pfad2.pdf" \
    >/dev/null 2>&1 || die "Pfad-Vorlage mit MDO_BASE_DIR nicht gefunden"
  ok "Vorlage als .typ-Datei relativ zur Notiz / zu MDO_BASE_DIR"

  # Fehler: unbekanntes Set und ungültiger Wert -> Exit 1; --template ohne Wert -> Exit 2.
  code=0
  err="$(MDO_TEMPLATES="${sets}" bash "${build}" --template gibt-es-nicht "${note}" "${out_dir}/set-fehler.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "unbekanntes Set liefert Exit ${code}"
  grep -q "Vorlage nicht gefunden: gibt-es-nicht" <<<"${err}" || die "unbekanntes Set: unklare Meldung: ${err}"
  [[ ! -e "${out_dir}/set-fehler.pdf" ]] || die "unbekanntes Set erzeugt trotzdem ein PDF"
  code=0
  err="$(bash "${build}" --template ../etwas "${note}" "${out_dir}/set-fehler.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "ungültige Vorlage liefert Exit ${code}"
  grep -q "ungültige Vorlage: ../etwas" <<<"${err}" || die "ungültige Vorlage: unklare Meldung: ${err}"
  code=0
  bash "${build}" --template >/dev/null 2>&1 || code=$?
  [[ "${code}" -eq 2 ]] || die "--template ohne Wert liefert Exit ${code}"
  bash "${build}" --help | quiet_grep -- '--template' || die "--help nennt --template nicht"
  bash "${build}" --help | quiet_grep -- 'markdown-office --app \[notiz.md' || die "--help nennt --app nicht"
  ok "Fehlerfälle und --help"
}

test_fixtures
test_interface
test_templates
printf 'Alle Tests bestanden.\n'
