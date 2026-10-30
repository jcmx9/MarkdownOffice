#!/usr/bin/env bash
# End-to-End-Test: baut die Testnotizen aus pipeline/tests/fixtures/ wie ein
# Nutzer über markdown-office (cli.js, unter Node; schreibt das Manifest
# MDO_MANIFEST und ruft build.sh) und prüft den Text der erzeugten PDFs
# (pdftotext oder mutool) sowie die Schnittstelle (Ausgabepfad, Exit-Codes,
# eingebettete Quelle, minimaler PATH) und den Staging-Ordner (eine Notiz liest
# nur sich selbst und die Dateien, die sie sichtbar einbindet).
#
# Layout: getestet werden cli.js und build.sh im Pipeline-Ordner MDO_PIPELINE_ROOT
# mit den Sets in MDO_SETS_DIR. Ohne MDO_PIPELINE_ROOT baut der Test das
# Entwicklungs-Layout build/pipeline-dev/ (tests/dev-layout.sh, braucht
# build/pipeline-assets aus `npm run assets`), das dem gepackten Layout der App
# entspricht. Alles, was der Test schreibt, liegt in einem mktemp-Ordner; eigene
# Vorlagen liest er nur aus MDO_TEMPLATES (dort), nie aus ~/Documents.
#
# Usage: bash pipeline/tests/test-pdf.sh
#        MDO_DIN5008A_DIR=~/GitHub/MarkdownOffice-set-din5008a bash pipeline/tests/test-pdf.sh
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
# Aufruf wie markdown-office: cli.js schreibt das Manifest, ohne das build.sh nicht exportiert.
# Node mit absolutem Pfad, damit auch der Test mit minimalem PATH (env -i) ihn findet.
[[ -f "${MDO_PIPELINE_ROOT}/cli.js" ]] || {
  printf 'FEHLER: %s fehlt (npm run build:cli)\n' "${MDO_PIPELINE_ROOT}/cli.js" >&2
  exit 1
}
mdo=("$(command -v node)" "${MDO_PIPELINE_ROOT}/cli.js")

out_dir="$(mktemp -d)"
cleanup() { rm -rf "${out_dir}"; }
trap cleanup EXIT
# Eigener Temp-Ordner: Staging-Ordner (mdo-stage-*) des Wrappers und von build.sh landen hier;
# test_sandbox prüft, dass keiner zurückbleibt.
export TMPDIR="${out_dir}/tmp"
mkdir -p "${TMPDIR}"
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
  (cd "${fixtures}" && "${mdo[@]}" "$@" "${name}" "${pdf}" >/dev/null 2>"${out_dir}/${name}.err") ||
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

  # Titel + Untertitel aus dem Front Matter, mehrere Kapitel, Fußzeile ohne Toptitel.
  text="$(render yaml-title.md)"
  expect yaml-title.md "${text}" "Kick-off: Relaunch" "Workshop" "Ziele" "Unterpunkt" "Aufgaben" \
    "Kick-off: Relaunch · Workshop"
  reject yaml-title.md "${text}" "$(date +%d.%m.%Y)"
  ok yaml-title.md

  # Toptitel, deutsches Datum, Autorenliste, Fußzeile "Toptitel · Titel"; leerer
  # Untertitel und ungültige logo-height (50 %) werden ignoriert.
  text="$(render toptitle-meta.md)"
  expect_compact toptitle-meta.md "${text}" "MUSTER GMBH"
  expect toptitle-meta.md "${text}" "Kick-off" "12. Oktober 2026 · jcmx9, Ben Probe" \
    "Muster GmbH · Kick-off" "Seite 1 / 1"
  # PDF-Metadaten: Autor(en), Stichwörter mit Toptitel und Markdown-Office-Version.
  if command -v pdfinfo >/dev/null 2>&1; then
    local info
    info="$(pdfinfo "${out_dir}/toptitle-meta.pdf")"
    expect "toptitle-meta.md Metadaten" "${info}" "jcmx9, Ben Probe" "Muster GmbH, Markdown Office ${version}"
    grep -q '^Subject: *Kick-off$' <<<"${info}" || die "toptitle-meta.md: Thema ist nicht der Titel"
    # Ohne author: kein Autor, ohne title: kein Thema.
    info="$(pdfinfo "${out_dir}/edge-cases.pdf")"
    if grep -qE '^(Author|Subject):' <<<"${info}"; then die "edge-cases.md: Autor/Thema ohne YAML gesetzt"; fi
  fi
  ok toptitle-meta.md

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
  (cd "${out_dir}" && "${mdo[@]}" weich.md weich.pdf >/dev/null 2>&1) || die "weich.md: Export fehlgeschlagen"
  expect "hard_breaks: false" "$(pdf_text "${out_dir}/weich.pdf")" "Zeile eins Zeile zwei"
  ok "soft-breaks.md (Standard hart, --hard-breaks, --soft-breaks, hard_breaks: false)"

  # Bildtitel und Linkdefinitionen: die Typografie ließ "Titel" zu „Titel“ werden (kein
  # Titel mehr: das Bild kam als Quelltext ins PDF), und der harte Umbruch hängte an jede
  # Definition ein "\" (Fließtext statt Definition, der Verweis blieb Quelltext).
  mkdir -p "${out_dir}/refs"
  cp "${fixtures}/logo.svg" "${out_dir}/refs/bild.svg"
  printf -- '%s\n' '# Verweise' '' '![Mit Titel](bild.svg "Ein Titel")' '' \
    'Siehe [eins][a] und [zwei][b] und [drei][c].' '' '[a]: https://example.com/a' \
    '[b]: https://example.com/b "B-Titel"' '[c]: <https://example.com/c>' '' 'Ende.' >"${out_dir}/refs/refs.md"
  (cd "${out_dir}/refs" && "${mdo[@]}" refs.md refs.pdf >/dev/null 2>"${out_dir}/refs.err") ||
    die "refs.md: Export fehlgeschlagen: $(cat "${out_dir}/refs.err")"
  text="$(pdf_text "${out_dir}/refs/refs.pdf")"
  expect refs.md "${text}" "Abbildung 1: Mit Titel"
  reject refs.md "${text}" "](bild.svg" "[zwei]" "[drei]" "[b]:" "[c]:"
  ok "refs.md (Bild mit Titel, Linkdefinitionen hintereinander)"

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
  # Der Fülltext ist auf die Zeilenhöhe von memo 26.10.3 (Zell-Inset y 5 pt)
  # abgestimmt: ohne Tabelle passte die Einleitung noch auf Seite 1, Kopf- und
  # erste Tabellenzeile aber nicht mehr (sticky bindet nur an den Tabellenanfang).
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

  # Absolute Pfade über Umgebungsvariablen ($VAR) für ein Bild im Notizordner; ein
  # fehlendes Bild hinterlässt einen Hinweis statt den Export abzubrechen. Das Logo
  # mit ${VAR} bleibt draußen: logo: nimmt nur relative Pfade.
  text="$(MDO_PIPELINE_ROOT="${mroot}" TEST_ASSETS="${fixtures}" render absolute-paths.md)"
  expect absolute-paths.md "${text}" "Abbildung 1: Absolut über Variable" \
    "[Bild fehlt: bilder/gibt-es-nicht.png]" "Text nach den Bildern."
  grep -q "Bild nicht gefunden: bilder/gibt-es-nicht.png" "${out_dir}/absolute-paths.md.err" ||
    die "absolute-paths.md: keine Warnung auf stderr"
  reject absolute-paths.md "${text}" "PIPELOGO"
  grep -q 'Logo muss ein relativer Pfad zur Notiz, zum Profil oder zur Vorlage sein' \
    "${out_dir}/absolute-paths.md.err" || die "absolute-paths.md: kein Hinweis zum absoluten Logo"
  ok absolute-paths.md

  # Logo nur mit logo: im Frontmatter; ohne Schlüssel nie, auch wenn im
  # Programmordner ein logo.svg liegt.
  text="$(MDO_PIPELINE_ROOT="${mroot}" render tasks.md)"
  reject tasks.md "${text}" "PIPELOGO"
  ok "ohne logo: kein Logo"

  # Suchreihenfolge für logo: (nur relative Pfade): Ordner der Notiz, dann Ordner
  # des Profils, dann Ordner der Vorlage. Benutzer-, Vorlagen- und Pipeline-Ordner
  # werden nicht durchsucht. Nicht gefunden: ohne Logo, Exit 0.
  local ldir="${out_dir}/logo-suche" lhome="${out_dir}/logo-home" lvorl="${out_dir}/logo-vorlagen" lout
  mkdir -p "${ldir}" "${lhome}" "${lvorl}/lset/profiles"
  # Ein Benutzer-Set „lset“ (das memo-Set unter anderem Namen) mit einem Profil p.
  cp "${MDO_SETS_DIR}/memo/memo.typ" "${lvorl}/lset/lset.typ"
  printf 'name: P\n' >"${lvorl}/lset/profiles/p.yaml"
  svg_text() {
    printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60"><text x="5" y="40" font-family="SourceSans3VF" font-size="30">%s</text></svg>\n' "$1"
  }
  logo_build() {
    printf -- '---\ntemplate: lset\nprofile: p\nlogo: %s\n---\n\nText.\n' "$1" >"${ldir}/n.md"
    (cd "${ldir}" && HOME="${lhome}" MDO_TEMPLATES="${lvorl}" MDO_PIPELINE_ROOT="${mroot}" "${mdo[@]}" n.md "${out_dir}/logo.pdf" \
      >/dev/null 2>"${out_dir}/logo.err") || die "logo: ${1}: Export fehlgeschlagen: $(cat "${out_dir}/logo.err")"
    pdf_text "${out_dir}/logo.pdf"
  }
  svg_text NOTIZLOGO >"${ldir}/mein-logo.svg"
  svg_text PROFILLOGO >"${lvorl}/lset/profiles/mein-logo.svg"
  svg_text VORLAGENLOGO >"${lvorl}/lset/mein-logo.svg"
  svg_text HOMELOGO >"${lhome}/mein-logo.svg"
  svg_text WURZELLOGO >"${lvorl}/mein-logo.svg"
  lout="$(logo_build mein-logo.svg)"
  expect "logo: Notizordner" "${lout}" "NOTIZLOGO"
  reject "logo: Notizordner" "${lout}" "PROFILLOGO"
  rm "${ldir}/mein-logo.svg"
  lout="$(logo_build mein-logo.svg)"
  expect "logo: Profilordner" "${lout}" "PROFILLOGO"
  reject "logo: Profilordner" "${lout}" "VORLAGENLOGO"
  rm "${lvorl}/lset/profiles/mein-logo.svg"
  lout="$(logo_build mein-logo.svg)"
  expect "logo: Vorlagenordner" "${lout}" "VORLAGENLOGO"
  rm "${lvorl}/lset/mein-logo.svg"
  lout="$(logo_build mein-logo.svg)"
  reject "logo: nicht mehr gesucht" "${lout}" "HOMELOGO" "WURZELLOGO" "PIPELOGO"
  # shellcheck disable=SC2088  # ~ soll wörtlich ins Frontmatter
  lout="$(logo_build '~/mein-logo.svg')"
  reject "logo: ~/" "${lout}" "HOMELOGO"
  grep -q "Logo muss ein relativer Pfad" "${out_dir}/logo.err" || die "logo: ~/: kein Hinweis"
  lout="$(logo_build "${lhome}/mein-logo.svg")"
  reject "logo: absolut" "${lout}" "HOMELOGO"
  grep -q "Logo muss ein relativer Pfad" "${out_dir}/logo.err" || die "logo: absolut: kein Hinweis"
  lout="$(logo_build ../logo-home/mein-logo.svg)"
  reject "logo: ../" "${lout}" "HOMELOGO"
  grep -q "Logo liegt außerhalb" "${out_dir}/logo.err" || die "logo: ../: kein Hinweis"
  lout="$(logo_build fehlt.svg)"
  grep -q "Logo nicht gefunden: fehlt.svg" "${out_dir}/logo.err" || die "logo: fehlt: kein Hinweis"
  lout="$(logo_build mein-logo.txt)"
  grep -q "Logo muss .svg" "${out_dir}/logo.err" || die "logo: falsche Endung: kein Hinweis"
  ok "logo: Suchreihenfolge Notiz → Profil → Vorlage, nur relative Pfade"

  # Das ausgelieferte pipeline/logo.svg (ohne Text) lässt sich einbinden (neben der Notiz).
  cp "${MDO_PIPELINE_ROOT}/logo.svg" "${ldir}/logo.svg"
  printf -- '---\nlogo: logo.svg\n---\n\nText.\n' >"${ldir}/n.md"
  (cd "${ldir}" && HOME="${lhome}" "${mdo[@]}" n.md "${out_dir}/logo.pdf" \
    >/dev/null 2>"${out_dir}/logo.err") || die "ausgeliefertes Logo: Export fehlgeschlagen: $(cat "${out_dir}/logo.err")"
  ! grep -q "Logo nicht gefunden" "${out_dir}/logo.err" || die "ausgeliefertes Logo: nicht gefunden"
  ok "ausgeliefertes logo.svg wird eingebunden"

  # Mermaid offline: Beschriftungen als Text im PDF, kein Quelltext.
  text="$(render mermaid.md)"
  expect mermaid.md "${text}" "Kick-off" "Konzept ok?" "Design" "Briefing" "Angebot" \
    "Text nach dem Diagramm."
  reject mermaid.md "${text}" "flowchart LR" "sequenceDiagram" "-->"
  ok mermaid.md

  # Lange Fußzeile (Toptitel · Titel): auf eine Zeile mit „…“ gekürzt, Abstand zur
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
  (cd "${out_dir}" && "${mdo[@]}" header.md "${out_dir}/header.pdf" >/dev/null 2>"${out_dir}/header.err") ||
    die "memo.header.md: Export fehlgeschlagen: $(cat "${out_dir}/header.err")"
  if grep -q "Warnung" "${out_dir}/header.err"; then
    die "memo.header.md: unerwartete Warnung: $(cat "${out_dir}/header.err")"
  fi
  ok memo.header.md

  # header: Text ist feste Kopfzeile; schlichtes false nimmt sie weg, "false" bleibt Text.
  local kapitel=$'# Kapitel\n\nText.\n'
  printf -- '---\nheader: "Feste Kopfzeile"\n---\n%s' "${kapitel}" >"${out_dir}/kopf-text.md"
  printf -- '---\nheader: false\n---\n%s' "${kapitel}" >"${out_dir}/kopf-aus.md"
  printf -- '---\nheader: "false"\n---\n%s' "${kapitel}" >"${out_dir}/kopf-wort.md"
  local name pages
  for name in kopf-text kopf-aus kopf-wort; do
    (cd "${out_dir}" && "${mdo[@]}" "${name}.md" "${out_dir}/${name}.pdf" >/dev/null 2>&1) ||
      die "${name}: Export fehlgeschlagen"
  done
  pdf_text "${out_dir}/kopf-text.pdf" | quiet_grep "Feste Kopfzeile" || die "header: Text fehlt im PDF"
  pdf_text "${out_dir}/kopf-wort.pdf" | quiet_grep "false" || die 'header: "false" ist kein Text'
  if pdf_text "${out_dir}/kopf-aus.pdf" | quiet_grep "false"; then die "header: false steht als Text im PDF"; fi
  ok "header: Text, false und \"false\""
}

test_interface() {
  local err code text

  # Ausdrücklich angegebene Ausgabe: exakt dieser Pfad, kein ISO-Präfix.
  (cd "${fixtures}" && "${mdo[@]}" toptitle-meta.md "${out_dir}/exakt.pdf" >/dev/null 2>&1)
  [[ -s "${out_dir}/exakt.pdf" ]] || die "Ausgabe nicht exakt geschrieben"
  [[ ! -e "${out_dir}/2026-10-12_exakt.pdf" && ! -e "${fixtures}/2026-10-12_toptitle-meta.pdf" ]] ||
    die "ISO-Präfix trotz ausdrücklicher Ausgabe"
  ok "Ausgabe exakt"

  # Ohne Ausgabe: neben der Quelle, deutsches Datum -> ISO-Präfix.
  cp "${fixtures}/toptitle-meta.md" "${fixtures}/logo.png" "${out_dir}/"
  (cd "${out_dir}" && "${mdo[@]}" toptitle-meta.md >/dev/null 2>&1)
  [[ -s "${out_dir}/2026-10-12_toptitle-meta.pdf" ]] || die "ISO-Präfix aus 12.10.2026 fehlt"
  ok "ISO-Präfix aus deutschem Datum"

  # Fehlende Quelle: Exit != 0, kurze Meldung auf stderr.
  code=0
  err="$("${mdo[@]}" "${out_dir}/gibt-es-nicht.md" "${out_dir}/x.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -ne 0 ]] || die "fehlende Quelle liefert Exit 0"
  grep -q "Quelle nicht gefunden" <<<"${err}" || die "fehlende Quelle: unklare Meldung: ${err}"
  ok "Exit-Code bei fehlender Quelle (${code})"

  # Unbekannte Option: Exit 2.
  code=0
  "${mdo[@]}" --gibt-es-nicht >/dev/null 2>&1 || code=$?
  [[ "${code}" -eq 2 ]] || die "unbekannte Option liefert Exit ${code}"
  ok "Exit-Code bei unbekannter Option"

  # '--' beendet die Optionen: danach ist auch '-strich.md' eine Quelle (Parität zu convert.ps1).
  printf -- '# Strich\n\nText.\n' >"${out_dir}/-strich.md"
  code=0
  (cd "${out_dir}" && "${mdo[@]}" --no-source -- -strich.md "${out_dir}/strich.pdf" >/dev/null 2>&1) || code=$?
  [[ "${code}" -eq 0 && -s "${out_dir}/strich.pdf" ]] || die "'--' als Ende der Optionen: Exit ${code}"
  ok "'--' beendet die Optionen"

  # Ohne Quelle: Hilfe, Exit 0, kein PDF – weder im Arbeitsordner noch im
  # Pipeline-Ordner (in der App das signierte Bundle).
  local noarg="${out_dir}/ohne argumente" before after
  mkdir -p "${noarg}"
  before="$(find -L "${MDO_PIPELINE_ROOT}" -name '*.pdf' | sort)"
  code=0
  text="$(cd "${noarg}" && "${mdo[@]}" 2>&1)" || code=$?
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
  (cd / && "${mdo[@]}" --no-source --hard-breaks "${in_dir}/meine notiz.md" "${target_dir}/mein pdf.pdf" \
    >/dev/null 2>"${out_dir}/spaces.err") || die "Pfade mit Leerzeichen: Export fehlgeschlagen: $(cat "${out_dir}/spaces.err")"
  [[ -s "${target_dir}/mein pdf.pdf" ]] || die "Pfade mit Leerzeichen: PDF fehlt am Zielpfad"
  ok "absolute Pfade mit Leerzeichen"

  # Temporäre Kopie (Export ungespeicherter Änderungen): Bilder gelten über
  # MDO_BASE_DIR relativ zum Originalordner; Name in Fußzeile, PDF-Titel und
  # Anhang bleibt der der Notiz (die Kopie trägt denselben Dateinamen).
  local tmp_copy="${out_dir}/tmpkopie"
  mkdir -p "${tmp_copy}"
  cp "${fixtures}/edge-cases.md" "${tmp_copy}/edge-cases.md"
  (cd "${fixtures}" && MDO_BASE_DIR="${fixtures}" "${mdo[@]}" "${tmp_copy}/edge-cases.md" \
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
  (cd "${fixtures}" && "${mdo[@]}" "${tmp_copy}/edge-cases.md" "${out_dir}/ohne-basis.pdf" >/dev/null 2>&1)
  expect "ohne MDO_BASE_DIR" "$(pdf_text "${out_dir}/ohne-basis.pdf")" "Bild fehlt: bilder/screenshot.png"
  # Ungültiger MDO_BASE_DIR: Warnung, Rückfall auf den Ordner der Quelle.
  MDO_BASE_DIR="${out_dir}/gibt-es-nicht" "${mdo[@]}" "${fixtures}/edge-cases.md" "${out_dir}/x.pdf" \
    >/dev/null 2>"${out_dir}/basis2.err" || die "ungültiger MDO_BASE_DIR bricht den Export ab"
  grep -q "MDO_BASE_DIR ist kein Ordner" "${out_dir}/basis2.err" || die "ungültiger MDO_BASE_DIR ohne Warnung"
  ok "MDO_BASE_DIR (temporäre Kopie) + Dateiname"

  # Minimaler PATH wie bei einer GUI-App (Editor, Finder), ohne MDO_*-Variablen:
  # typst kommt aus bin/typst, Pipeline-Ordner und Sets aus dem Ort von build.sh.
  if [[ -x "${MDO_PIPELINE_ROOT}/bin/typst" ]]; then
    (cd "${fixtures}" && env -i HOME="${out_dir}/minpath-home" PATH=/usr/bin:/bin MDO_NO_OPEN=1 \
      "${mdo[@]}" edge-cases.md "${out_dir}/minpath.pdf" >/dev/null 2>"${out_dir}/minpath.err") ||
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
  (cd / && MDO_TEMPLATES="${sets}" "${mdo[@]}" "${note}" "${out_dir}/probe.pdf" \
    >/dev/null 2>"${out_dir}/probe.err") || die "Set probe: Export fehlgeschlagen: $(cat "${out_dir}/probe.err")"
  strings "${out_dir}/probe.pdf" | quiet_grep 'part>3</pdfaid:part' || die "Set probe: kein PDF/A-3"
  text="$(pdf_text "${out_dir}/probe.pdf")"
  # shellcheck disable=SC1111
  expect "Set probe" "${text}" "SET-PROBE Set-Test" "Kapitel" "„zitiert“"
  ok "eigenes Set aus MDO_TEMPLATES (Bausteine über sys.inputs.mdo)"

  # Standard-Benutzerordner ~/Markdown Office/Vorlagen (ohne MDO_TEMPLATES) – mit einem HOME
  # im Testordner, nie im echten Home.
  local home="${out_dir}/home"
  mkdir -p "${home}/Markdown Office/Vorlagen"
  cp "${sets}/probe.typ" "${home}/Markdown Office/Vorlagen/"
  (env -u MDO_TEMPLATES HOME="${home}" "${mdo[@]}" "${note}" "${out_dir}/home.pdf" >/dev/null 2>&1) ||
    die "Set aus ~/Markdown Office/Vorlagen nicht gefunden"
  expect "Benutzerordner" "$(pdf_text "${out_dir}/home.pdf")" "SET-PROBE"
  ok "Set aus ~/Markdown Office/Vorlagen"

  # Ein vorhandenes ~/Documents/Markdown Office (Standard bis 26.10.5) gilt weiter, solange es
  # ~/Markdown Office nicht gibt.
  local legacy="${out_dir}/legacy-home"
  mkdir -p "${legacy}/Documents/Markdown Office/Vorlagen"
  cp "${sets}/probe.typ" "${legacy}/Documents/Markdown Office/Vorlagen/"
  (env -u MDO_TEMPLATES HOME="${legacy}" "${mdo[@]}" "${note}" "${out_dir}/legacy.pdf" >/dev/null 2>&1) ||
    die "Set aus ~/Documents/Markdown Office/Vorlagen (alter Ordner) nicht gefunden"
  expect "alter Benutzerordner" "$(pdf_text "${out_dir}/legacy.pdf")" "SET-PROBE"
  ok "Set aus einem vorhandenen ~/Documents/Markdown Office/Vorlagen"

  # Relatives MDO_TEMPLATES gilt ab dem Arbeitsordner des Aufrufers.
  mkdir -p "${out_dir}/rel/ordner"
  cp "${sets}/probe.typ" "${out_dir}/rel/ordner/"
  (cd "${out_dir}/rel" && MDO_TEMPLATES=ordner "${mdo[@]}" "${note}" "${out_dir}/rel.pdf" >/dev/null 2>&1) ||
    die "relatives MDO_TEMPLATES: Export fehlgeschlagen"
  expect "relatives MDO_TEMPLATES" "$(pdf_text "${out_dir}/rel.pdf")" "SET-PROBE"
  ok "relatives MDO_TEMPLATES ab Arbeitsordner"

  # --template gewinnt über den Frontmatter-Schlüssel; beide Schreibweisen.
  MDO_TEMPLATES="${sets}" "${mdo[@]}" --template memo "${note}" "${out_dir}/cli.pdf" >/dev/null 2>&1 ||
    die "--template memo: Export fehlgeschlagen"
  reject "--template memo" "$(pdf_text "${out_dir}/cli.pdf")" "SET-PROBE"
  printf -- '# Ohne Schlüssel\n' >"${out_dir}/Set Ordner/ohne.md"
  MDO_TEMPLATES="${sets}" "${mdo[@]}" --template=probe "${out_dir}/Set Ordner/ohne.md" "${out_dir}/cli3.pdf" \
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
  MDO_TEMPLATES="${out_dir}/Eigene Vorlagen" "${mdo[@]}" "${out_dir}/Set Ordner/ohne.md" "${out_dir}/schatten.pdf" \
    >/dev/null 2>&1 || die "eigenes memo: Export fehlgeschlagen"
  expect "eigenes memo" "$(pdf_text "${out_dir}/schatten.pdf")" "SET-PROBE"
  ok "Benutzerordner vor mitgelieferten Sets"

  # Set-Ordner im Benutzerordner: <templates>/<name>/<name>.typ (geklontes Set-Repo).
  MDO_TEMPLATES="${sets}" "${mdo[@]}" --template folderset "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/folder.pdf" >/dev/null 2>"${out_dir}/folder.err" ||
    die "Set-Ordner: Export fehlgeschlagen: $(cat "${out_dir}/folder.err")"
  expect "Set-Ordner" "$(pdf_text "${out_dir}/folder.pdf")" "SET-FOLDER"
  # Eine flache <name>.typ gewinnt über den Ordner gleichen Namens.
  mkdir -p "${out_dir}/Flach/probe"
  cp "${sets}/probe.typ" "${out_dir}/Flach/probe.typ"
  cp "${sets}/folderset/folderset.typ" "${out_dir}/Flach/probe/probe.typ"
  MDO_TEMPLATES="${out_dir}/Flach" "${mdo[@]}" --template probe "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/flach.pdf" >/dev/null 2>&1 || die "flach vor Ordner: Export fehlgeschlagen"
  expect "flach vor Ordner" "$(pdf_text "${out_dir}/flach.pdf")" "SET-PROBE"
  ok "Set-Ordner <name>/<name>.typ im Benutzerordner"

  # frontmatter(): Listen, verschachtelte Werte und x-Schlüssel kommen im Set an; die
  # Shell-Parser lesen nur Schlüssel ganz links (eingerückte Zeilen ändern date/title nicht).
  local fmnote="${out_dir}/Set Ordner/fm.md"
  printf -- '---\ndate: 2026-10-18\nx-to:\n  - Sonnenschein Verlag GmbH\n  - Rosenstraße 5\nx-subject: "Ihre Anfrage"\nx-map:\n  inner: tief\n  title: falsch\n  date: 1999-01-01\n---\n\nText.\n' >"${fmnote}"
  MDO_TEMPLATES="${sets}" "${mdo[@]}" --template fm "${fmnote}" "${out_dir}/fm.pdf" \
    >/dev/null 2>"${out_dir}/fm.err" || die "frontmatter(): Export fehlgeschlagen: $(cat "${out_dir}/fm.err")"
  text="$(pdf_text "${out_dir}/fm.pdf")"
  expect "frontmatter()" "${text}" "TO=Sonnenschein Verlag GmbH|Rosenstraße 5" "SUBJ=Ihre Anfrage" \
    "NESTED=tief" "DATEIN=2026-10-18" "EMPTY=0"
  reject "frontmatter()" "${text}" "falsch" "1999"
  [[ ! -s "${out_dir}/fm.err" ]] || die "frontmatter(): Warnungen: $(cat "${out_dir}/fm.err")"
  ok "frontmatter() im Set; eingerückte und x-Zeilen ändern die Pipeline-Werte nicht"

  # Offline-Paketablage: @preview/cades (mit jogs) aus vendor/packages, ohne Netz.
  MDO_TEMPLATES="${sets}" "${mdo[@]}" --template qr "${out_dir}/Set Ordner/ohne.md" "${out_dir}/qr.pdf" \
    >/dev/null 2>"${out_dir}/qr.err" || die "QR-Paket: Export fehlgeschlagen: $(cat "${out_dir}/qr.err")"
  expect "QR-Paket" "$(pdf_text "${out_dir}/qr.pdf")" "QR-OK"
  # Nicht mitgeliefertes Paket: Abbruch vor Typst, Exit 1, klare Meldung.
  code=0
  err="$(MDO_TEMPLATES="${sets}" "${mdo[@]}" --template netimport "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/net.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "fremdes Paket liefert Exit ${code}"
  grep -q "Paket nicht mitgeliefert: @preview/gibtsnicht:1.0.0" <<<"${err}" || die "fremdes Paket: unklare Meldung: ${err}"
  # Fail closed: auch eine ungültige Angabe (Großbuchstaben, Unterstrich) ist ein Paket-Import.
  code=0
  err="$(MDO_TEMPLATES="${sets}" "${mdo[@]}" --template netupper "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/net.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "ungültige Paketangabe liefert Exit ${code}"
  grep -q "Paket nicht mitgeliefert: @preview/Gibts_Nicht:1.0.0" <<<"${err}" || die "ungültige Paketangabe: unklare Meldung: ${err}"
  # Ein Set-Ordner wird ganz geprüft: der Import steht in einer Hilfsdatei des Sets.
  code=0
  err="$(MDO_TEMPLATES="${sets}" "${mdo[@]}" --template nethelper "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/net.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "Import in Hilfsdatei liefert Exit ${code}"
  grep -q "Paket nicht mitgeliefert: @preview/gibtsnicht:2.0.0" <<<"${err}" || die "Import in Hilfsdatei: unklare Meldung: ${err}"
  # Verlinkter Set-Ordner (geklontes Set-Repo als Symlink im Vorlagen-Ordner): find folgt
  # dem Link; die Vorlage selbst wird immer geprüft, auch der Import in einer Hilfsdatei.
  local links="${out_dir}/Verlinkt"
  mkdir -p "${links}" "${out_dir}/Repo/linkmain"
  printf '#import "@preview/gibtsnicht:3.0.0": nichts\nText\n' >"${out_dir}/Repo/linkmain/linkmain.typ"
  ln -s "${out_dir}/Repo/linkmain" "${links}/linkmain"
  ln -s "${sets}/nethelper" "${links}/nethelper"
  code=0
  err="$(MDO_TEMPLATES="${links}" "${mdo[@]}" --template linkmain "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/net.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "verlinkter Set-Ordner liefert Exit ${code}"
  grep -q "Paket nicht mitgeliefert: @preview/gibtsnicht:3.0.0" <<<"${err}" || die "verlinkter Set-Ordner: unklare Meldung: ${err}"
  code=0
  err="$(MDO_TEMPLATES="${links}" "${mdo[@]}" --template nethelper "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/net.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "verlinkter Set-Ordner mit Hilfsdatei liefert Exit ${code}"
  grep -q "Paket nicht mitgeliefert: @preview/gibtsnicht:2.0.0" <<<"${err}" || die "verlinkter Set-Ordner mit Hilfsdatei: unklare Meldung: ${err}"
  # Fail closed: eine unlesbare Datei im Set-Ordner (Scan scheitert) ist eine Abweisung.
  mkdir -p "${out_dir}/Unlesbar/unlesbar"
  printf 'Text\n' >"${out_dir}/Unlesbar/unlesbar/unlesbar.typ"
  printf 'x\n' >"${out_dir}/Unlesbar/unlesbar/helper.typ"
  chmod 000 "${out_dir}/Unlesbar/unlesbar/helper.typ"
  code=0
  err="$(MDO_TEMPLATES="${out_dir}/Unlesbar" "${mdo[@]}" --template unlesbar "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/net.pdf" 2>&1 >/dev/null)" || code=$?
  chmod 644 "${out_dir}/Unlesbar/unlesbar/helper.typ"
  [[ "${code}" -eq 1 ]] || die "unlesbare Set-Datei liefert Exit ${code}"
  grep -q "Vorlage nicht prüfbar" <<<"${err}" || die "unlesbare Set-Datei: unklare Meldung: ${err}"
  # Was kein Textscan sieht (Angabe per Verkettung): Typst läuft hinter einem unerreichbaren
  # Proxy, der Download scheitert, und in der Paketablage entsteht nichts.
  local store_before
  store_before="$(ls -R "${MDO_PIPELINE_ROOT}/vendor/packages/")"
  code=0
  MDO_TEMPLATES="${sets}" "${mdo[@]}" --template netconcat "${out_dir}/Set Ordner/ohne.md" \
    "${out_dir}/concat.pdf" >/dev/null 2>"${out_dir}/concat.err" || code=$?
  [[ "${code}" -ne 0 ]] || die "verkettete Paketangabe: Build ohne Fehler (Download nicht gesperrt?)"
  [[ ! -e "${out_dir}/concat.pdf" ]] || die "verkettete Paketangabe erzeugt trotzdem ein PDF"
  [[ "$(ls -R "${MDO_PIPELINE_ROOT}/vendor/packages/")" == "${store_before}" ]] ||
    die "verkettete Paketangabe: Paketablage verändert"
  ok "Offline-Paketablage; nicht mitgelieferte Pakete werden abgewiesen (Scan + gesperrter Proxy)"

  # Einzelne .typ-Datei relativ zur Notiz (Leerzeichen im Namen), Aufruf aus fremdem cwd.
  cp "${sets}/probe.typ" "${out_dir}/Set Ordner/eigene vorlage.typ"
  printf -- '---\ntemplate: ./eigene vorlage.typ\n---\n\n# Pfad\n' >"${out_dir}/Set Ordner/pfad.md"
  (cd / && "${mdo[@]}" "${out_dir}/Set Ordner/pfad.md" "${out_dir}/pfad.pdf" >/dev/null 2>"${out_dir}/pfad.err") ||
    die "Pfad-Vorlage: Export fehlgeschlagen: $(cat "${out_dir}/pfad.err")"
  expect "Pfad-Vorlage" "$(pdf_text "${out_dir}/pfad.pdf")" "SET-PROBE"
  # Mit MDO_BASE_DIR (temporäre Kopie) gilt der Pfad relativ zum Originalordner.
  mkdir -p "${out_dir}/kopie"
  cp "${out_dir}/Set Ordner/pfad.md" "${out_dir}/kopie/pfad.md"
  MDO_BASE_DIR="${out_dir}/Set Ordner" "${mdo[@]}" "${out_dir}/kopie/pfad.md" "${out_dir}/pfad2.pdf" \
    >/dev/null 2>&1 || die "Pfad-Vorlage mit MDO_BASE_DIR nicht gefunden"
  ok "Vorlage als .typ-Datei relativ zur Notiz / zu MDO_BASE_DIR"

  # Fehler: unbekanntes Set und ungültiger Wert -> Exit 1; --template ohne Wert -> Exit 2.
  code=0
  err="$(MDO_TEMPLATES="${sets}" "${mdo[@]}" --template gibt-es-nicht "${note}" "${out_dir}/set-fehler.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "unbekanntes Set liefert Exit ${code}"
  grep -q "Vorlage nicht gefunden: gibt-es-nicht" <<<"${err}" || die "unbekanntes Set: unklare Meldung: ${err}"
  [[ ! -e "${out_dir}/set-fehler.pdf" ]] || die "unbekanntes Set erzeugt trotzdem ein PDF"
  code=0
  err="$("${mdo[@]}" --template ../etwas "${note}" "${out_dir}/set-fehler.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "ungültige Vorlage liefert Exit ${code}"
  grep -q "ungültige Vorlage: ../etwas" <<<"${err}" || die "ungültige Vorlage: unklare Meldung: ${err}"
  code=0
  "${mdo[@]}" --template >/dev/null 2>&1 || code=$?
  [[ "${code}" -eq 2 ]] || die "--template ohne Wert liefert Exit ${code}"
  "${mdo[@]}" --help | quiet_grep -- '--template' || die "--help nennt --template nicht"
  "${mdo[@]}" --help | quiet_grep -- 'markdown-office --app \[notiz.md' || die "--help nennt --app nicht"
  ok "Fehlerfälle und --help"
}

test_profiles() {
  local sets="${fixtures}/templates" pdir="${out_dir}/Profil Notiz" vorl="${out_dir}/Profil Vorlagen" text err code
  mkdir -p "${pdir}/profiles" "${vorl}/profiles"
  # Nur im Vorlagen-Ordner: gefunden über <templates>/profiles/<name>.yaml.
  cp "${fixtures}/profiles/testprofil.yaml" "${fixtures}/profiles/sig.svg" "${vorl}/profiles/"
  cp "${sets}/profile.typ" "${vorl}/"
  printf -- '---\ntemplate: profile\nprofile: testprofil\n---\n\nText.\n' >"${pdir}/brief.md"
  MDO_TEMPLATES="${vorl}" "${mdo[@]}" "${pdir}/brief.md" "${out_dir}/p1.pdf" >/dev/null 2>"${out_dir}/p1.err" ||
    die "profile: Vorlagen-Ordner: $(cat "${out_dir}/p1.err")"
  text="$(pdf_text "${out_dir}/p1.pdf")"
  expect "profile: Vorlagen-Ordner" "${text}" "NAME=PROFIL-NAME" "SIG-OK"

  # profiles/ neben der Notiz gewinnt.
  sed 's/PROFIL-NAME/NOTIZ-PROFIL/' "${fixtures}/profiles/testprofil.yaml" >"${pdir}/profiles/testprofil.yaml"
  cp "${fixtures}/profiles/sig.svg" "${pdir}/profiles/"
  MDO_TEMPLATES="${vorl}" "${mdo[@]}" "${pdir}/brief.md" "${out_dir}/p2.pdf" >/dev/null 2>&1 ||
    die "profile: Notizordner: Export fehlgeschlagen"
  expect "profile: Notizordner" "$(pdf_text "${out_dir}/p2.pdf")" "NAME=NOTIZ-PROFIL"

  # Als Pfad (relativ zur Notiz, mit ~ und $VAR) statt als Name.
  printf -- '---\ntemplate: profile\nprofile: profiles/testprofil.yaml\n---\n\nText.\n' >"${pdir}/pfad.md"
  MDO_TEMPLATES="${vorl}" "${mdo[@]}" "${pdir}/pfad.md" "${out_dir}/p3.pdf" >/dev/null 2>&1 ||
    die "profile: Pfad: Export fehlgeschlagen"
  expect "profile: Pfad" "$(pdf_text "${out_dir}/p3.pdf")" "NAME=NOTIZ-PROFIL"

  # Ohne profile: leere Eingabe.
  printf -- '---\ntemplate: profile\n---\n\nText.\n' >"${pdir}/ohne.md"
  MDO_TEMPLATES="${vorl}" "${mdo[@]}" "${pdir}/ohne.md" "${out_dir}/p4.pdf" >/dev/null 2>&1 ||
    die "profile: ohne: Export fehlgeschlagen"
  expect "profile: ohne" "$(pdf_text "${out_dir}/p4.pdf")" "KEIN-PROFIL"

  # Tippfehler: Exit 1, klare Meldung mit den gesuchten Ordnern, kein PDF.
  printf -- '---\ntemplate: profile\nprofile: testprofli\n---\n\nText.\n' >"${pdir}/falsch.md"
  code=0
  err="$(MDO_TEMPLATES="${vorl}" "${mdo[@]}" "${pdir}/falsch.md" "${out_dir}/p5.pdf" 2>&1 >/dev/null)" || code=$?
  [[ "${code}" -eq 1 ]] || die "profile: Tippfehler liefert Exit ${code}"
  grep -q "Profil nicht gefunden: testprofli" <<<"${err}" || die "profile: unklare Meldung: ${err}"
  grep -q "${vorl}/profiles" <<<"${err}" || die "profile: Meldung nennt den Vorlagen-Ordner nicht: ${err}"
  [[ ! -e "${out_dir}/p5.pdf" ]] || die "profile: Tippfehler erzeugt trotzdem ein PDF"
  ok "profile: Notizordner → Vorlagen-Ordner → Set-Ordner, Pfad, Fehler bei Tippfehler"

  # Profile eines Sets im Vorlagen-Ordner (<Vorlagen>/<set>/profiles) gewinnen über das
  # gemeinsame <Vorlagen>/profiles und über die Beispielprofile des mitgelieferten Sets. Der
  # Ordner <Vorlagen>/profset hat keine profset.typ und verdeckt das mitgelieferte Set nicht.
  local bsets="${out_dir}/Profil Sets" svorl="${out_dir}/Set Vorlagen" sdir="${out_dir}/Set Notiz" name
  mkdir -p "${bsets}/profset/profiles" "${svorl}/profset/profiles" "${svorl}/profiles" "${sdir}"
  cp "${sets}/profile.typ" "${bsets}/profset/profset.typ"
  for pair in "${bsets}/profset/profiles|SET-BEISPIEL" "${svorl}/profiles|GEMEINSAM" "${svorl}/profset/profiles|SET-PROFIL"; do
    sed "s/PROFIL-NAME/${pair#*|}/" "${fixtures}/profiles/testprofil.yaml" >"${pair%%|*}/testprofil.yaml"
    cp "${fixtures}/profiles/sig.svg" "${pair%%|*}/"
  done
  printf -- '---\ntemplate: profset\nprofile: testprofil\n---\n\nText.\n' >"${sdir}/brief.md"
  for name in SET-PROFIL GEMEINSAM SET-BEISPIEL; do
    MDO_SETS_DIR="${bsets}" MDO_TEMPLATES="${svorl}" "${mdo[@]}" "${sdir}/brief.md" "${out_dir}/ps.pdf" \
      >/dev/null 2>"${out_dir}/ps.err" || die "profile: Set-Profile (${name}): $(cat "${out_dir}/ps.err")"
    expect "profile: Set-Profile (${name})" "$(pdf_text "${out_dir}/ps.pdf")" "NAME=${name}"
    # Nächster Durchlauf: den Ordner, der eben gewann, leeren.
    case "${name}" in
      SET-PROFIL) rm "${svorl}/profset/profiles/testprofil.yaml" ;;
      GEMEINSAM) rm "${svorl}/profiles/testprofil.yaml" ;;
    esac
  done

  # Nicht gefunden: die Meldung nennt auch <Vorlagen>/<set>/profiles.
  printf -- '---\ntemplate: profset\nprofile: fehlt\n---\n\nText.\n' >"${sdir}/fehlt.md"
  err="$(MDO_SETS_DIR="${bsets}" MDO_TEMPLATES="${svorl}" "${mdo[@]}" "${sdir}/fehlt.md" "${out_dir}/pf.pdf" 2>&1 >/dev/null)" || true
  grep -qF "${svorl}/profset/profiles" <<<"${err}" || die "profile: Meldung nennt die Set-Profile nicht: ${err}"
  ok "profile: <Vorlagen>/<set>/profiles → <Vorlagen>/profiles → Beispiel des Sets"
}

# Set din5008a: Musterbrief und harte Abbrüche. Das Set kommt aus MDO_DIN5008A_DIR
# (lokaler Klon, als <tmp>/vorlagen/din5008a verlinkt), sonst aus <sets>/din5008a;
# ohne Set wird übersprungen.
test_din5008a() {
  local vorl="${MDO_TEMPLATES}" text ddir code err
  if [[ -n "${MDO_DIN5008A_DIR:-}" ]]; then
    [[ -f "${MDO_DIN5008A_DIR}/din5008a.typ" ]] ||
      die "MDO_DIN5008A_DIR enthält keine din5008a.typ: ${MDO_DIN5008A_DIR}"
    vorl="${out_dir}/vorlagen"
    mkdir -p "${vorl}"
    ln -s "$(cd "${MDO_DIN5008A_DIR}" && pwd)" "${vorl}/din5008a"
  elif [[ ! -f "${MDO_SETS_DIR}/din5008a/din5008a.typ" ]]; then
    printf 'skip din5008a (kein Set din5008a; MDO_DIN5008A_DIR setzen)\n'
    return 0
  fi

  text="$(MDO_TEMPLATES="${vorl}" render din5008a-qr.md --template din5008a)"
  expect din5008a-qr.md "${text}" "Sonnenschein Verlag GmbH" "Seite 1 von 2" \
    "Manuskript 'Die Abenteuer der kleinen Eule' – Einreichung" "5. April 2026" "Mit herzlichen Grüßen"
  # Name unter der Unterschrift als eigene Zeile (Kopf und Fuß haben ihn nur in längeren Zeilen).
  expect_line din5008a-qr.md "${text}" "Dr. Anna Weber"
  ok "din5008a: Musterbrief (Anschrift, Betreff, Datum, Seitenzahl, Name)"

  # Harte Abbrüche: Exit 1, klare Meldung, kein PDF (ein falsch adressierter Brief ist
  # schlimmer als keiner).
  ddir="${out_dir}/din"
  mkdir -p "${ddir}/profiles"
  cp "${fixtures}/profiles/din-ohne-qr.yaml" "${ddir}/profiles/"
  printf -- '---\nx-to:\n  - A\n---\n\nText.\n' >"${ddir}/ohne-profil.md"
  printf -- '---\nprofile: din-ohne-qr\nx-to:\n  - 1\n  - 2\n  - 3\n  - 4\n  - 5\n  - 6\n  - 7\n---\n\nText.\n' \
    >"${ddir}/sieben.md"
  printf -- '---\nprofile: din-ohne-qr\nx-to: []\n---\n\nText.\n' >"${ddir}/leer.md"
  local case_ name msg
  for case_ in "ohne-profil|profile: fehlt" "sieben|höchstens 6 Zeilen" "leer|x-to: fehlt"; do
    name="${case_%%|*}"
    msg="${case_#*|}"
    code=0
    err="$(MDO_TEMPLATES="${vorl}" "${mdo[@]}" --template din5008a "${ddir}/${name}.md" \
      "${out_dir}/din-${name}.pdf" 2>&1 >/dev/null)" || code=$?
    [[ "${code}" -eq 1 ]] || die "din5008a: ${name} liefert Exit ${code}: ${err}"
    grep -qF -- "${msg}" <<<"${err}" || die "din5008a: ${name}: Meldung ohne \"${msg}\": ${err}"
    [[ ! -e "${out_dir}/din-${name}.pdf" ]] || die "din5008a: ${name} erzeugt trotzdem ein PDF"
  done
  ok "din5008a: ohne profile:, x-to mit 7 Zeilen und leeres x-to brechen ab"
}

# Staging-Ordner: Typst sieht nur die Notiz, die Bilder, die sie sichtbar einbindet, ihr Logo und
# Profil (mit den Bildern, die das Profil nennt), das Set und die Pipeline-Bausteine. Feindliche
# Notizen versuchen, eine Datei außerhalb zu lesen (raw-typst, mitex-Durchreichungen, ein Link
# auf eine Nicht-Bilddatei, gefälschte Probe-Metadaten für ein nicht verlinktes Bild): der Export
# scheitert dann an Typst oder das PDF enthält nichts davon (Text, Bilder, Anhänge).
test_sandbox() {
  local sb="${out_dir}/sandbox" geheim="${out_dir}/geheim" text code pdf
  mkdir -p "${sb}/notiz" "${sb}/bilder" "${geheim}"
  printf 'CANARY-GEHEIM\n' >"${geheim}/canary.txt"
  cp "${fixtures}/logo.png" "${geheim}/canary.png"
  # Liegt neben der Notiz, ist aber nicht verlinkt: nur gefälschte Probe-Metadaten nennen es.
  cp "${fixtures}/logo.png" "${sb}/notiz/canary.png"

  # image_count <pdf>: Zahl der eingebetteten Bilder (pdfimages), leer ohne poppler.
  image_count() {
    if command -v pdfimages >/dev/null 2>&1; then pdfimages -list "$1" | tail -n +3 | wc -l | tr -d ' '; fi
  }
  # Typst-Fehler eines Zugriffs außerhalb des Staging-Ordners (der Pfad zählt ab dessen Wurzel).
  local not_found='error: file not found'
  # expect_fail <name> <code> <pdf> <fehler-regex>: der Export scheiterte genau mit diesem Fehler
  # (nicht irgendeinem) und hinterließ kein PDF.
  expect_fail() {
    [[ "$2" -ne 0 ]] || die "sandbox $1: Export gelang, erwartet: $4"
    [[ ! -e "$3" ]] || die "sandbox $1: gescheiterter Export hinterlässt ein PDF"
    grep -qE -- "$4" "${out_dir}/sb-$1.err" || die "sandbox $1: unerwarteter Fehler: $(cat "${out_dir}/sb-$1.err")"
  }
  # hostile <name> <zeile> <fehler-regex> [optionen…]: Notiz mit der Zeile exportieren. Mit
  # Fehler-Regex muss der Export genau damit scheitern; mit "" muss er gelingen, und das PDF
  # darf keinen Kanarienvogel enthalten.
  hostile() {
    local name="$1" line="$2" want="$3"
    shift 3
    pdf="${out_dir}/sb-${name}.pdf"
    printf '# Feind\n\n%s\n\nENDE.\n' "${line}" >"${sb}/notiz/${name}.md"
    code=0
    (cd "${sb}/notiz" && "${mdo[@]}" "$@" "${name}.md" "${pdf}" >/dev/null 2>"${out_dir}/sb-${name}.err") || code=$?
    if [[ -n "${want}" ]]; then
      expect_fail "${name}" "${code}" "${pdf}" "${want}"
      return 0
    fi
    [[ "${code}" -eq 0 ]] || die "sandbox ${name}: Export fehlgeschlagen: $(cat "${out_dir}/sb-${name}.err")"
    text="$(pdf_text "${pdf}")"
    reject "sandbox ${name}" "${text}" "CANARY-GEHEIM"
    [[ "$(image_count "${pdf}")" != [1-9]* ]] || die "sandbox ${name}: fremdes Bild im PDF"
    if command -v mutool >/dev/null 2>&1; then
      [[ "$(attachments "${pdf}")" == "${name}.md" ]] ||
        die "sandbox ${name}: fremder Anhang: $(attachments "${pdf}")"
    fi
  }
  local forge_meta forge_use
  forge_meta='$\text{\label{#metadata("canary.png")<mdo-image>}}$'
  forge_use='$\text{\label{#(sys.inputs.at("images", default: none),).filter(f => f != none).map(f => image(json(f).at("canary.png"))).join()}}$'
  # Einstellung des Sets: memo hat raw-typst aus, der Kommentar bleibt ein Kommentar (Export gelingt).
  hostile memo-raw-aus "<!--raw-typst #read(\"${geheim}/canary.txt\") -->" ""
  # Ein eigenes Set mit raw-typst an (probe): die Notiz läuft als Typst-Code, sieht aber nur
  # den Staging-Ordner.
  MDO_TEMPLATES="${fixtures}/templates" hostile raw-probe "<!--raw-typst #read(\"${geheim}/canary.txt\") -->" \
    "${not_found}" --template probe
  MDO_TEMPLATES="${fixtures}/templates" hostile raw-probe-bild \
    "<!--raw-typst #image(\"${geheim}/canary.png\") -->" "${not_found}" --template probe
  hostile label "\$\\text{\\label{#read(\"${geheim}/canary.txt\")}}\$" "${not_found}"
  hostile graphics "\$\\includegraphics{${geheim}/canary.png}\$" "${not_found}"
  # Die gefälschte Quelle steht in der Zuordnung als "" (fehlt): image("") scheitert.
  hostile forged "${forge_meta} ${forge_use}" 'error: (file not found|failed to load file)'
  # Ein Link auf eine Nicht-Bilddatei kommt nicht in den Staging-Ordner: Platzhalter statt Abbruch.
  hostile textlink '![](../../geheim/canary.txt)' ""
  expect "sandbox textlink" "${text}" "[Bild fehlt: ../../geheim/canary.txt]"
  ok "sandbox: raw-typst, mitex (\\label, \\includegraphics), Nicht-Bild-Link, gefälschte Probe lesen nichts"

  # Eine von der Notiz genannte Vorlage: nur eine echte .typ-Datei unter Notiz- oder
  # Vorlagen-Ordner, und nur diese eine Datei kommt in den Staging-Ordner.
  ln -s "${geheim}/canary.txt" "${sb}/notiz/evil.typ"
  mkdir -p "${geheim}/evil" "${sb}/notiz/eigen/daten"
  printf '#read("canary.txt")\n' >"${geheim}/evil/evil.typ"
  cp "${geheim}/canary.txt" "${geheim}/evil/"
  ln -s "${geheim}/evil" "${sb}/notiz/evil"
  ln "${geheim}/canary.txt" "${sb}/notiz/hart.typ"
  local tval refused='Vorlage muss eine .typ-Datei im Ordner der Notiz oder im Vorlagen-Ordner sein'
  for tval in ./evil.typ ./evil/evil.typ ./hart.typ; do
    printf -- '---\ntemplate: %s\n---\n\nText.\n' "${tval}" >"${sb}/notiz/tpl.md"
    code=0
    (cd "${sb}/notiz" && "${mdo[@]}" tpl.md "${out_dir}/sb-tpl.pdf" >/dev/null 2>"${out_dir}/sb-tpl.err") || code=$?
    expect_fail tpl "${code}" "${out_dir}/sb-tpl.pdf" "${refused}: ${tval}"
  done
  # Ordnerform ./eigen/eigen.typ im Notizordner mit einem verlinkten Unterordner: nur die .typ
  # kommt mit (kein Set-Ordner), der Link nie; dazu der Hinweis auf Set-Ordner.
  cp "${geheim}/canary.txt" "${geheim}/daten-canary.txt"
  rm -rf "${sb}/notiz/eigen/daten"
  ln -s "${geheim}" "${sb}/notiz/eigen/daten"
  printf '#read("daten/canary.txt")\n' >"${sb}/notiz/eigen/eigen.typ"
  printf -- '---\ntemplate: ./eigen/eigen.typ\n---\n\nText.\n' >"${sb}/notiz/tpl.md"
  code=0
  (cd "${sb}/notiz" && "${mdo[@]}" tpl.md "${out_dir}/sb-tpl.pdf" >/dev/null 2>"${out_dir}/sb-tpl.err") || code=$?
  expect_fail tpl "${code}" "${out_dir}/sb-tpl.pdf" "${not_found}"
  grep -q "Set-Ordner <name>/<name>.typ" "${out_dir}/sb-tpl.err" || die "sandbox tpl: Hinweis auf Set-Ordner fehlt"
  ok "sandbox: Vorlage aus der Notiz nur als echte .typ-Datei, allein kopiert (Symlink, verlinkter Ordner)"

  # Eine einzelne .typ im Vorlagen-Ordner, über den Namen gewählt (meinset): ihr Ordner kommt mit,
  # damit sie Nachbardateien einbinden kann, aber ohne profiles/ (jede Tiefe), ohne Punkt-Einträge
  # und ohne Symlinks, die den Ordner verlassen.
  local mv="${out_dir}/sb-meinset"
  mkdir -p "${mv}/profiles" "${mv}/x/profiles"
  printf '#import "helper.typ": h\n#import sys.inputs.mdo + "/lib/markdown.typ": preprocess\n#import sys.inputs.mdo + "/vendor/cmarker/lib.typ" as cmarker\n#import sys.inputs.mdo + "/vendor/mitex/lib.typ": mitex\n#set text(font: ("SourceSans3VF",))\n#let a = sys.inputs.at("attach", default: "")\n#if a != "" { pdf.attach("/" + a.split("/").last(), read(a, encoding: none), relationship: "source", mime-type: "text/markdown", description: "Markdown source") }\n#h\n\n#cmarker.render(preprocess(read(sys.inputs.source)), math: mitex)\n' \
    >"${mv}/meinset.typ"
  printf '#let h = [MEINSET-HELPER]\n' >"${mv}/helper.typ"
  printf 'INNEN-MARKE\n' >"${mv}/innen.txt"
  ln -s innen.txt "${mv}/innen-link.txt"
  printf 'OTHER-MARKE\n' >"${mv}/profiles/other.yaml"
  printf 'Y-MARKE\n' >"${mv}/x/profiles/y.yaml"
  printf 'DOT-MARKE\n' >"${mv}/.hidden.txt"
  ln -s "${geheim}/canary.txt" "${mv}/aussen.txt"
  MDO_TEMPLATES="${mv}" hostile meinset '$\text{\label{#read("/set/innen-link.txt")}}$' "" --template meinset
  expect "sandbox meinset" "${text}" "MEINSET-HELPER" "INNEN-MARKE"
  local mf
  for mf in profiles/other.yaml x/profiles/y.yaml .hidden.txt aussen.txt; do
    MDO_TEMPLATES="${mv}" hostile meinset-fremd "\$\\text{\\label{#read(\"/set/${mf}\")}}\$" "${not_found}" \
      --template meinset
    # Absichtlich ausgelassen: kein Hinweis auf Set-Ordner.
    if grep -q "Set-Ordner" "${out_dir}/sb-meinset-fremd.err"; then die "sandbox meinset ${mf}: falscher Hinweis"; fi
  done
  # Ein anderes Set im selben Ordner kennt mdo-pagebreak: meinset bekommt trotzdem die
  # raw-typst-Form, der Seitenumbruch bleibt.
  mkdir -p "${mv}/din5008a"
  printf '// html: (mdo-pagebreak: …)\n' >"${mv}/din5008a/din5008a.typ"
  printf '# Eins\n\n<!-- pagebreak -->\n\n# Zwei\n' >"${sb}/notiz/mumbruch.md"
  (cd "${sb}/notiz" && MDO_TEMPLATES="${mv}" "${mdo[@]}" --template meinset mumbruch.md \
    "${out_dir}/sb-mumbruch.pdf" >/dev/null 2>"${out_dir}/sb-mumbruch.err") ||
    die "sandbox meinset umbruch: Export fehlgeschlagen: $(cat "${out_dir}/sb-mumbruch.err")"
  pdfinfo "${out_dir}/sb-mumbruch.pdf" | quiet_grep '^Pages: *2$' ||
    die "sandbox meinset umbruch: Seitenumbruch verschwunden (Nachbar-Set kennt mdo-pagebreak)"
  # Die Vorlage selbst als Symlink aus dem Vorlagen-Ordner heraus (eigenes Repo): wird kopiert.
  mkdir -p "${out_dir}/sb-repo"
  sed 's/#h/MEINSET2-MARKE/' "${mv}/meinset.typ" >"${out_dir}/sb-repo/meinset2.typ"
  cp "${mv}/helper.typ" "${out_dir}/sb-repo/"
  ln -s "${out_dir}/sb-repo/meinset2.typ" "${mv}/meinset2.typ"
  MDO_TEMPLATES="${mv}" hostile meinset2 'Text.' "" --template meinset2
  expect "sandbox meinset2" "${text}" "MEINSET2-MARKE"
  # Ein Vorlagen-Ordner, der wie das Set heißt (…/meinset mit meinset.typ): kein Set-Ordner (das
  # entscheidet der Suchort <Vorlagen>/<name>/<name>.typ, nicht der Ordnername), also derselbe
  # Filter wie oben, kein ungefiltertes Kopieren.
  local gleich="${out_dir}/sb-gleich/meinset"
  mkdir -p "${gleich}/x/profiles"
  cp "${mv}/meinset.typ" "${mv}/helper.typ" "${gleich}/"
  printf 'DOT-MARKE\n' >"${gleich}/.hidden.txt"
  printf 'Y-MARKE\n' >"${gleich}/x/profiles/y.yaml"
  MDO_TEMPLATES="${gleich}" hostile gleich 'Text.' "" --template meinset
  for mf in .hidden.txt x/profiles/y.yaml; do
    MDO_TEMPLATES="${gleich}" hostile gleich-fremd "\$\\text{\\label{#read(\"/set/${mf}\")}}\$" "${not_found}" \
      --template meinset
  done
  ok "sandbox: einzelne .typ über den Namen: Nachbardateien ja, profiles/, Punkt-Einträge, Links nach außen nein"

  # Jede Schreibweise von profiles und .git bleibt draußen: macOS und Windows unterscheiden sie im
  # Dateisystem nicht, die Profilsuche des Wrappers findet Profiles/ als profiles/. Einzelne .typ
  # über den Namen (meinset; auch ein Link auf ein Profil darin) wie Set-Ordner (fset).
  local gross="${out_dir}/sb-gross"
  mkdir -p "${gross}/Profiles" "${gross}/x/PROFILES" "${gross}/fset/Profiles" "${gross}/fset/.GIT"
  cp "${mv}/meinset.typ" "${mv}/helper.typ" "${gross}/"
  cp "${mv}/meinset.typ" "${gross}/fset/fset.typ"
  cp "${mv}/helper.typ" "${gross}/fset/"
  printf 'OTHER-MARKE\n' >"${gross}/Profiles/other.yaml"
  printf 'Y-MARKE\n' >"${gross}/x/PROFILES/y.yaml"
  ln -s Profiles/other.yaml "${gross}/plink.yaml"
  printf 'OTHER-MARKE\n' >"${gross}/fset/Profiles/other.yaml"
  printf 'GIT-MARKE\n' >"${gross}/fset/.GIT/config"
  MDO_TEMPLATES="${gross}" hostile gross 'Text.' "" --template meinset
  MDO_TEMPLATES="${gross}" hostile gross-set 'Text.' "" --template fset
  for mf in Profiles/other.yaml x/PROFILES/y.yaml plink.yaml fset/Profiles/other.yaml; do
    MDO_TEMPLATES="${gross}" hostile gross-fremd "\$\\text{\\label{#read(\"/set/${mf}\")}}\$" "${not_found}" \
      --template meinset
  done
  for mf in Profiles/other.yaml .GIT/config; do
    MDO_TEMPLATES="${gross}" hostile gross-fremd "\$\\text{\\label{#read(\"/set/${mf}\")}}\$" "${not_found}" \
      --template fset
  done
  ok "sandbox: Profiles/, PROFILES/ und .GIT/ bleiben draußen wie profiles/ und .git/"

  # Bilder nur aus dem Notizordner und seinen Unterordnern: ein sichtbar verlinktes Bild außerhalb
  # fehlt im PDF (mit Hinweis), eines im Unterordner erscheint.
  cp "${fixtures}/bilder/screenshot.png" "${sb}/bilder/aussen.png"
  printf '# Außen\n\n![](../bilder/aussen.png)\n\nENDE.\n' >"${sb}/notiz/aussen.md"
  (cd "${sb}/notiz" && "${mdo[@]}" aussen.md "${out_dir}/sb-aussen.pdf" >/dev/null 2>"${out_dir}/sb-aussen.err") ||
    die "sandbox aussen: Export fehlgeschlagen: $(cat "${out_dir}/sb-aussen.err")"
  expect "sandbox aussen" "$(pdf_text "${out_dir}/sb-aussen.pdf")" "[Bild fehlt: ../bilder/aussen.png]" "ENDE."
  [[ "$(image_count "${out_dir}/sb-aussen.pdf")" == 0 ]] || die "sandbox aussen: Bild von außerhalb im PDF"
  grep -q "Bild liegt außerhalb des Notizordners, kommt nicht ins PDF: ../bilder/aussen.png" \
    "${out_dir}/sb-aussen.err" || die "sandbox aussen: kein Hinweis auf stderr"
  mkdir -p "${sb}/notiz/innen"
  cp "${fixtures}/bilder/screenshot.png" "${sb}/notiz/innen/bild.png"
  printf '# Innen\n\n![](innen/bild.png)\n\nENDE.\n' >"${sb}/notiz/innen.md"
  (cd "${sb}/notiz" && "${mdo[@]}" innen.md "${out_dir}/sb-innen.pdf" >/dev/null 2>"${out_dir}/sb-innen.err") ||
    die "sandbox innen: Export fehlgeschlagen: $(cat "${out_dir}/sb-innen.err")"
  reject "sandbox innen" "$(pdf_text "${out_dir}/sb-innen.pdf")" "Bild fehlt"
  [[ "$(image_count "${out_dir}/sb-innen.pdf")" != 0 ]] || die "sandbox innen: Bild fehlt im PDF"
  ok "sandbox: Bild außerhalb des Notizordners bleibt draußen, Bild im Unterordner erscheint"

  # Seitenumbruch alter Form: ein Set ohne mdo-pagebreak (probe, raw-typst an) bricht weiter um.
  printf '# Eins\n\n\\newpage\n\n# Zwei\n' >"${sb}/notiz/umbruch.md"
  (cd "${sb}/notiz" && MDO_TEMPLATES="${fixtures}/templates" "${mdo[@]}" --template probe umbruch.md \
    "${out_dir}/sb-umbruch.pdf" >/dev/null 2>"${out_dir}/sb-umbruch.err") ||
    die "sandbox umbruch: Export fehlgeschlagen: $(cat "${out_dir}/sb-umbruch.err")"
  pdfinfo "${out_dir}/sb-umbruch.pdf" | quiet_grep '^Pages: *2$' ||
    die "sandbox umbruch: Set ohne mdo-pagebreak verliert den Seitenumbruch"
  ok "sandbox: Seitenumbruch für ein Set ohne mdo-pagebreak (raw-typst-Form)"

  # build.sh allein (ohne Manifest des Wrappers) exportiert nicht.
  code=0
  text="$(cd "${sb}/notiz" && env -u MDO_MANIFEST bash "${build}" aussen.md "${out_dir}/sb-direkt.pdf" 2>&1 >/dev/null)" ||
    code=$?
  [[ "${code}" -eq 1 ]] || die "build.sh ohne Manifest: Exit ${code}"
  grep -q "markdown-office" <<<"${text}" || die "build.sh ohne Manifest: unklare Meldung: ${text}"
  [[ ! -e "${out_dir}/sb-direkt.pdf" ]] || die "build.sh ohne Manifest erzeugt ein PDF"
  ok "build.sh ohne MDO_MANIFEST: Exit 1 mit Hinweis auf markdown-office"

  # Das Manifest einer anderen Notiz (oder eines ohne Notiz) exportiert nicht; dieselbe Notiz über
  # einen verlinkten Ordner geschrieben schon (verglichen werden die echten Pfade).
  local mdir="${out_dir}/sb-manifest" mjson
  mkdir -p "${mdir}"
  ln -s "${sb}/notiz" "${sb}/notiz-link"
  for mjson in "{\"note\":\"${sb}/notiz/umbruch.md\",\"images\":[]}" '{"images":[]}'; do
    printf '%s\n' "${mjson}" >"${mdir}/manifest.json"
    code=0
    text="$(cd "${sb}/notiz" && MDO_MANIFEST="${mdir}/manifest.json" bash "${build}" aussen.md \
      "${out_dir}/sb-fremdmanifest.pdf" 2>&1 >/dev/null)" || code=$?
    [[ "${code}" -eq 1 ]] || die "build.sh mit fremdem Manifest (${mjson}): Exit ${code}"
    grep -q "Export-Manifest gehört zu einer anderen Notiz" <<<"${text}" ||
      die "build.sh mit fremdem Manifest: unklare Meldung: ${text}"
    [[ ! -e "${out_dir}/sb-fremdmanifest.pdf" ]] || die "build.sh mit fremdem Manifest erzeugt ein PDF"
  done
  printf '{"note":"%s","images":[]}\n' "${sb}/notiz-link/aussen.md" >"${mdir}/manifest.json"
  (cd "${sb}/notiz" && MDO_MANIFEST="${mdir}/manifest.json" bash "${build}" aussen.md \
    "${out_dir}/sb-eigenmanifest.pdf" >/dev/null 2>"${out_dir}/sb-eigenmanifest.err") ||
    die "build.sh mit Manifest über verlinkten Ordner: $(cat "${out_dir}/sb-eigenmanifest.err")"
  ok "build.sh: Manifest einer anderen Notiz abgewiesen, dieselbe Notiz über einen Link angenommen"

  # din5008a: Profil in einem gemeinsamen profiles/-Ordner neben einem anderen Profil. Nur das
  # eigene Profil und die Unterschrift, die es nennt, liegen im Staging-Ordner (/profile/…).
  local vorl="${MDO_TEMPLATES}"
  if [[ -n "${MDO_DIN5008A_DIR:-}" ]]; then
    vorl="${out_dir}/sb-vorlagen"
    mkdir -p "${vorl}"
    ln -s "$(cd "${MDO_DIN5008A_DIR}" && pwd)" "${vorl}/din5008a"
  elif [[ ! -f "${MDO_SETS_DIR}/din5008a/din5008a.typ" ]]; then
    printf 'skip sandbox din5008a (kein Set din5008a; MDO_DIN5008A_DIR setzen)\n'
    vorl=""
  fi
  if [[ -n "${vorl}" ]]; then
    local user="${sb}/user"
    mkdir -p "${user}/profiles"
    { printf '# KANZLEI-MARKE\n'; cat "${fixtures}/profiles/din-ohne-qr.yaml"; printf 'signature: kanzlei-sig.svg\n'; } \
      >"${user}/profiles/kanzlei.yaml"
    cp "${fixtures}/profiles/din-unterschrift.svg" "${user}/profiles/kanzlei-sig.svg"
    printf '# OTHER-MARKE\nname: Other\nsignature: other-sig.svg\n' >"${user}/profiles/other.yaml"
    printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>OTHER-SIG</text></svg>\n' \
      >"${user}/profiles/other-sig.svg"
    din_note() {
      printf -- '---\ntemplate: din5008a\nprofile: kanzlei\nx-to:\n  - Empfänger\n---\n\nText %s\n' "$2" \
        >"${user}/$1.md"
      code=0
      (cd "${user}" && MDO_TEMPLATES="${vorl}" "${mdo[@]}" "$1.md" "${out_dir}/sb-$1.pdf" \
        >/dev/null 2>"${out_dir}/sb-$1.err") || code=$?
    }
    # Gegenprobe: das eigene Profil liegt unter /profile/ und ist lesbar.
    din_note eigen '$\text{\label{#read("/profile/kanzlei.yaml")}}$'
    [[ "${code}" -eq 0 ]] || die "sandbox din5008a: Export fehlgeschlagen: $(cat "${out_dir}/sb-eigen.err")"
    expect "sandbox din5008a eigen" "$(pdf_text "${out_dir}/sb-eigen.pdf")" "KANZLEI-MARKE" "Thomas Kirchner"
    local f
    for f in other.yaml other-sig.svg; do
      din_note fremd "\$\\text{\\label{#read(\"/profile/${f}\")}}\$"
      expect_fail fremd "${code}" "${out_dir}/sb-fremd.pdf" "${not_found}"
    done
    ok "sandbox din5008a: nur das eigene Profil und seine Unterschrift aus profiles/"

    # Das Set als Ordner im Vorlagen-Ordner (<Vorlagen>/din5008a/profiles hält die Profile aller
    # Absender): profiles/ des Sets kommt nicht in den Staging-Ordner, nur das eigene Profil.
    local vset="${out_dir}/sb-vorlagen-set" dsrc="${MDO_SETS_DIR}/din5008a"
    if [[ -e "${vorl}/din5008a" ]]; then dsrc="${vorl}/din5008a"; fi
    mkdir -p "${vset}/din5008a"
    cp -RL "${dsrc}/." "${vset}/din5008a/"
    rm -rf "${vset}/din5008a/.git"
    mkdir -p "${vset}/din5008a/profiles"
    cp "${user}/profiles/kanzlei.yaml" "${user}/profiles/kanzlei-sig.svg" "${user}/profiles/other.yaml" \
      "${user}/profiles/other-sig.svg" "${vset}/din5008a/profiles/"
    rm -rf "${user}/profiles"
    vorl="${vset}"
    din_note eigen '$\text{\label{#read("/profile/kanzlei.yaml")}}$'
    [[ "${code}" -eq 0 ]] || die "sandbox din5008a im Set-Ordner: Export fehlgeschlagen: $(cat "${out_dir}/sb-eigen.err")"
    expect "sandbox din5008a im Set-Ordner" "$(pdf_text "${out_dir}/sb-eigen.pdf")" "KANZLEI-MARKE"
    for f in /set/profiles/other.yaml /set/profiles/kanzlei.yaml /profile/other.yaml; do
      din_note fremd "\$\\text{\\label{#read(\"${f}\")}}\$"
      expect_fail fremd "${code}" "${out_dir}/sb-fremd.pdf" "${not_found}"
    done
    ok "sandbox din5008a: Profile im Set-Ordner (<Vorlagen>/din5008a/profiles) bleiben draußen"

    # Das Set als Symlink im Vorlagen-Ordner (eigener Klon): sein Beispielprofil wird gefunden.
    local vlink="${out_dir}/sb-vorlagen-link"
    mkdir -p "${vlink}"
    ln -s "${vset}/din5008a" "${vlink}/din5008a"
    printf -- '---\ntemplate: din5008a\nprofile: kanzlei\nx-to:\n  - Empfänger\n---\n\nText.\n' >"${user}/link.md"
    (cd "${user}" && MDO_TEMPLATES="${vlink}" "${mdo[@]}" link.md "${out_dir}/sb-link.pdf" \
      >/dev/null 2>"${out_dir}/sb-link.err") ||
      die "sandbox din5008a verlinkt: Export fehlgeschlagen: $(cat "${out_dir}/sb-link.err")"
    expect "sandbox din5008a verlinkt" "$(pdf_text "${out_dir}/sb-link.pdf")" "Thomas Kirchner"
    ok "sandbox din5008a: Profil im verlinkten Set-Ordner"
  fi

  # Aufräumen fail closed: scheitert die Leerprüfung (find), bleibt die Marke im Staging-Ordner,
  # damit der Wrapper ihn später wegräumt. Ein find davor im PATH scheitert nur bei ihr.
  local fakebin="${out_dir}/fakebin" real_find stages
  real_find="$(command -v find)"
  mkdir -p "${fakebin}"
  printf '#!/usr/bin/env bash\ncase "$*" in *"-maxdepth 1 ! -name .mdo-stage -print") exit 1 ;; esac\nexec "%s" "$@"\n' \
    "${real_find}" >"${fakebin}/find"
  chmod +x "${fakebin}/find"
  (cd "${sb}/notiz" && PATH="${fakebin}:${PATH}" "${mdo[@]}" aussen.md "${out_dir}/sb-findfehler.pdf" \
    >/dev/null 2>"${out_dir}/sb-findfehler.err") ||
    die "sandbox findfehler: Export fehlgeschlagen: $(cat "${out_dir}/sb-findfehler.err")"
  stages="$(find "${TMPDIR}" -mindepth 1 -maxdepth 1 -name 'mdo-stage-*')"
  [[ -n "${stages}" && "$(wc -l <<<"${stages}" | tr -d ' ')" == 1 && -f "${stages}/.mdo-stage" ]] ||
    die "sandbox findfehler: Marke nicht stehen geblieben: ${stages:-kein Staging-Ordner}"
  rm -rf "${stages}"
  ok "sandbox: scheitert die Leerprüfung beim Aufräumen, bleibt die Marke"

  # Kein Staging-Ordner bleibt zurück, weder nach Erfolg noch nach gescheitertem Export.
  local left
  left="$(find "${TMPDIR}" -maxdepth 1 -name 'mdo-stage-*')"
  [[ -z "${left}" ]] || die "Staging-Ordner zurückgeblieben: ${left}"
  ok "sandbox: keine mdo-stage-* nach Erfolg und Fehlschlag"
}

test_sandbox
test_fixtures
test_interface
test_templates
test_profiles
test_din5008a
# Kein Export (Erfolg wie Fehlschlag) hinterlässt einen Staging-Ordner.
left="$(find "${TMPDIR}" -maxdepth 1 -name 'mdo-stage-*')"
[[ -z "${left}" ]] || die "Staging-Ordner zurückgeblieben: ${left}"
printf 'Alle Tests bestanden.\n'
