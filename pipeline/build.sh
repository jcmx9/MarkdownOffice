#!/usr/bin/env bash
# Baut aus einer Markdown-Datei ein PDF/A: Markdown -> Typst (cmarker) -> PDF/A-3b.
# Der Body wird vom Template selbst per cmarker aus der (vorverarbeiteten) Quelle
# erzeugt; Pandoc/pygments/Lua werden nicht benötigt.
#
# Usage: build.sh [OPTIONS] SOURCE.md [OUTPUT.pdf]
#        Ohne SOURCE.md: Hilfe ausgeben, Exit 0 (keine Standardquelle – in der
#        App liegt der Pipeline-Ordner im signierten Bundle, dort wird nie geschrieben).
#
# Layout (in der App wie in der Entwicklung gleich, siehe tests/dev-layout.sh):
#   MDO_PIPELINE_ROOT  Ordner mit build.sh, lib/, vendor/, fonts/ und bin/typst
#                      (Standard: der Ordner dieses Skripts; App: <resources>/pipeline,
#                      Entwicklung: build/pipeline-dev/pipeline)
#   MDO_SETS_DIR       mitgelieferte Vorlagen-Sets als <name>/<name>.typ
#                      (Standard: ${MDO_PIPELINE_ROOT}/../sets; App: <resources>/sets)
#   MDO_VERSION        Version für --version und die PDF-Stichwörter (Standard: dev)
#   MDO_MANIFEST       Manifest des Wrappers (markdown-office, src/cli/stage.ts): welche lokalen
#                      Dateien die Notiz ins PDF holen darf (Bilder, Logo, Profil). Ohne: kein Export.
#
# Staging-Ordner: Typst liest nur einen frischen Ordner pro Export (--root), der genau die Notiz,
# die Dateien aus dem Manifest, das Set und die Pipeline-Bausteine (lib/, vendor/cmarker, mitex,
# mmdr) als Kopien enthält. Warum: Notiztext kann Typst-Code ausführen (raw-typst in eigenen Sets,
# mitex-Durchreichungen wie \text{\label{#read(…)}}); mit --root / läse er jede lokale Datei ins
# PDF. Die Pakete (--package-*) und Fonts bleiben außerhalb, Typst liest sie nur über diese Pfade.
set -euo pipefail

# Aufruf-Verzeichnis: relative Quell-/Ziel-Pfade beziehen sich auf das
# Verzeichnis, aus dem der Nutzer das Skript (bzw. markdown-office) aufgerufen
# hat – nie auf den Pipeline-Ordner (in der App schreibgeschützt).
orig_pwd="$(pwd)"

# Ordner absolut machen; ein relativer Wert gilt ab dem Aufrufverzeichnis.
abs_dir() {
  case "$1" in
    /*) (cd "$1" 2>/dev/null && pwd) ;;
    *)  (cd "${orig_pwd}/$1" 2>/dev/null && pwd) ;;
  esac
}
pipeline_root="$(abs_dir "${MDO_PIPELINE_ROOT:-$(dirname "${BASH_SOURCE[0]}")}")" || {
  echo "Error: MDO_PIPELINE_ROOT ist kein Ordner: ${MDO_PIPELINE_ROOT:-}" >&2
  exit 1
}
sets_dir="${MDO_SETS_DIR:-${pipeline_root}/../sets}"
sets_dir="$(abs_dir "${sets_dir}")" || sets_dir="${MDO_SETS_DIR:-${pipeline_root}/../sets}"

# Relativen Pfad gegen das Aufruf-Verzeichnis zu einem absoluten machen.
resolve_from_pwd() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *)  printf '%s' "${orig_pwd}/$1" ;;
  esac
}

# Ein GUI-Start erbt nicht den Shell-PATH: das mitgelieferte typst-Binary
# (bin/typst im Pipeline-Ordner) bevorzugen, sonst typst aus dem PATH. So läuft
# build.sh auch mit minimalem PATH (/usr/bin:/bin).
if [[ -z "${TYPST:-}" && -x "${pipeline_root}/bin/typst" ]]; then TYPST="${pipeline_root}/bin/typst"; fi
# Typst-Binary überschreibbar (z. B. zum Testen einer bestimmten Version).
typst_bin="${TYPST:-typst}"

# ---------------------------------------------------------------------------
# CLI-Flags: --help / --version (vor dem Typst-Check, damit --help auch ohne
# installiertes typst funktioniert) und Build-Schalter. Flags dürfen vor den
# Positionsargumenten stehen; der Rest wird als [SOURCE.md] [OUTPUT.pdf] weitergereicht.
# ---------------------------------------------------------------------------
mdo_version="${MDO_VERSION:-dev}"

print_version() {
  printf 'markdown-office %s\n' "${mdo_version}"
  # Typst-Version mit ausgeben (Pflicht >= 0.15) – nur wenn auffindbar.
  if command -v "${typst_bin}" >/dev/null 2>&1; then
    "${typst_bin}" --version 2>/dev/null || true
  fi
}

print_help() {
  cat <<EOF
markdown-office ${mdo_version} — Markdown -> Corporate-PDF/A-3b (via Typst, kein Pandoc)

Usage:
  markdown-office [OPTIONS] SOURCE.md [OUTPUT.pdf]
  bash build.sh [OPTIONS] SOURCE.md [OUTPUT.pdf]
  markdown-office --app [notiz.md …]    Editor öffnen

Arguments:
  SOURCE.md    Zu rendernde Markdown-Quelle (ohne Angabe: diese Hilfe)
  OUTPUT.pdf   Ausgabepfad, wird exakt so geschrieben. Ohne Angabe: neben der
               Quelle; ein 'date:' im Frontmatter stellt das ISO-Datum voran,
               z. B. 2026-06-19_SOURCE.pdf – abschaltbar mit 'isodate_praefix: false'

Options:
  --hard-breaks   Jede Zeile bleibt eine Zeile, wie im Editor getippt (Standard;
                  Frontmatter: hard_breaks: true)
  --soft-breaks   Einzelne Zeilenumbrüche werden zu Leerzeichen (CommonMark, für
                  umbrochenen Fließtext; Frontmatter: hard_breaks: false)
  --no-source     Markdown-Quelle NICHT ins PDF einbetten (z. B. für Kunden-PDFs;
                  Frontmatter: embed_source: false)
  --template NAME|DATEI.typ
                  Vorlagen-Set (Name) oder einzelne .typ-Datei; gewinnt über
                  den Frontmatter-Schlüssel template: (Standard: memo)
  -V, --version   markdown-office- und Typst-Version ausgeben und beenden
  -h, --help      Diese Hilfe ausgeben und beenden

Optionale YAML-Frontmatter-Schlüssel:
  title, subtitle, toptitle, author, date, isodate_praefix, toc, h1_break,
  print_filename, lang, header, watermark, logo, logo-height, profile,
  embed_source, hard_breaks, template

Exit-Code 0 nur bei Erfolg; Fehler und Warnungen gehen auf stderr.

Environment:
  MDO_NO_OPEN=1           Das PDF nach dem Build nicht öffnen (Batch/Cron)
  MDO_BASE_DIR=ordner     Relative Bild-/Logopfade gelten relativ zu diesem Ordner
                          statt zum Ordner der Quelle (temporäre Kopie)
  MDO_TEMPLATES=ordner    Ordner mit eigenen Vorlagen-Sets, <name>.typ oder <name>/<name>.typ
                          (Standard: ~/Documents/Markdown Office/Vorlagen)
  MDO_PIPELINE_ROOT=ordner  Pipeline-Ordner mit lib/, vendor/, fonts/, bin/typst
                          (Standard: Ordner dieses Skripts)
  MDO_SETS_DIR=ordner     Mitgelieferte Vorlagen-Sets (Standard: ../sets)
  MDO_VERSION=version     Versionsangabe (Standard: dev)
  MDO_MANIFEST=datei      Export-Manifest; setzt markdown-office (ohne: kein Export)
  TYPST=/pfad             Bestimmtes typst-Binary verwenden (>= 0.15 erforderlich)
EOF
}

cli_embed=""
cli_breaks=""
cli_template=""
positional=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)    print_help; exit 0 ;;
    -V|--version) print_version; exit 0 ;;
    --no-source)  cli_embed="false"; shift ;;
    --hard-breaks) cli_breaks="true"; shift ;;
    --soft-breaks) cli_breaks="false"; shift ;;
    --template)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        printf 'Error: --template braucht einen Set-Namen oder eine .typ-Datei\n' >&2; exit 2
      fi
      cli_template="$2"; shift 2 ;;
    --template=*)
      cli_template="${1#--template=}"
      if [ -z "${cli_template}" ]; then
        printf 'Error: --template braucht einen Set-Namen oder eine .typ-Datei\n' >&2; exit 2
      fi
      shift ;;
    --)           shift; while [ $# -gt 0 ]; do positional+=("$1"); shift; done; break ;;
    -*)           printf 'Error: unbekannte Option %s\n' "$1" >&2
                  printf "Aufruf: markdown-office --help\n" >&2; exit 2 ;;
    *)            positional+=("$1"); shift ;;
  esac
done
# Positionsargumente wiederherstellen (set-u-sicher, auch für bash 3.2/macOS).
if [ "${#positional[@]}" -gt 0 ]; then set -- "${positional[@]}"; else set --; fi
# Ohne Quelle: Hilfe statt einer Standardquelle (nichts wird geschrieben).
if [ $# -eq 0 ]; then print_help; exit 0; fi

if ! command -v "${typst_bin}" >/dev/null 2>&1; then
  echo "Error: typst nicht gefunden (${typst_bin}); erwartet in ${pipeline_root}/bin/typst oder im PATH" >&2
  exit 1
fi
# Variable Fonts brauchen Typst >= 0.15.
ver="$("${typst_bin}" --version | awk '{print $2}')"
ver_major="${ver%%.*}"
ver_minor="${ver#*.}"; ver_minor="${ver_minor%%.*}"
if (( ver_major == 0 && ver_minor < 15 )); then
  echo "Error: Typst >= 0.15 nötig (Variable Fonts), gefunden ${ver}" >&2
  exit 1
fi

src="$(resolve_from_pwd "$1")"
if [[ ! -f "${src}" ]]; then
  echo "Error: Quelle nicht gefunden: ${src}" >&2
  exit 1
fi
base="$(basename "${src%.*}")"
standard="a-3b"

# Exportiert wird nur mit dem Manifest des Wrappers: nur er weiß (aus dem Markdown-Parser des
# Editors, nicht aus Typst), welche Dateien die Notiz sichtbar einbindet. Hilfe, Version,
# Aufruffehler und eine fehlende Quelle sind oben schon beantwortet (dort setzt der Wrapper
# kein Manifest).
if [[ -z "${MDO_MANIFEST:-}" || ! -f "${MDO_MANIFEST}" ]]; then
  echo "Error: kein Export-Manifest (MDO_MANIFEST) – bitte über markdown-office exportieren: markdown-office ${1}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Optionalen YAML-Frontmatter (führender ---...---) parsen, CRLF-tolerant.
# Bool-Schlüssel YAML-1.1 gelesen (siehe yaml_bool); ein erkannter Schlüssel mit
# ungültigem Wert warnt und behält den Default. Leere Werte ("" oder nichts)
# werden ignoriert, nie ein Fehler. Die Markdown-Vorverarbeitung selbst macht
# das Template (lib/markdown.typ), nicht dieses Skript.
# ---------------------------------------------------------------------------
# Einen YAML-Skalar zu "true"/"false" normalisieren (YAML-1.1-Boolean-Menge,
# Obsidian-kompatibel; Superset von YAML 1.2). Unbekannte Werte -> leer.
yaml_bool() {
  local v="$1"
  v="$(printf '%s' "${v}" | sed -e 's/[[:space:]]#.*$//' \
                                -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
                                -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//" \
                                -e 's/[[:space:]]*$//')"
  case "$(printf '%s' "${v}" | tr '[:upper:]' '[:lower:]')" in
    true|yes|on|y)  printf 'true'  ;;
    false|no|off|n) printf 'false' ;;
    *)              printf ''       ;;
  esac
}

# Einen YAML-String-Skalar säubern: Whitespace weg; in Anführungszeichen gilt
# der Inhalt bis zum schließenden Zeichen, sonst wird ein Inline-Kommentar
# (" # …") abgeschnitten. Eine Inline-Liste [a, "b"] wird zu "a, b" (Autoren).
yaml_str() {
  local v
  v="$(printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  case "${v}" in
    \"*) v="${v#\"}"; v="${v%%\"*}" ;;
    \'*) v="${v#\'}"; v="${v%%\'*}" ;;
    \[*)
      v="${v#\[}"; v="${v%%\]*}"
      v="$(printf '%s' "${v}" | sed -e 's/["'\'']//g' -e 's/[[:space:]]*,[[:space:]]*/, /g' \
                                  -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      ;;
    *) v="$(printf '%s' "${v}" | sed -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//')" ;;
  esac
  printf '%s' "${v}"
}

# Bool-Schlüssel auswerten: gibt true/false (bzw. auto, wenn erlaubt) aus.
# Leerer Wert -> ignorieren (Exit 1, keine Warnung); ungültiger Wert ->
# Warnung + Exit 1, der Default bleibt.
fm_bool() {
  local key="$1" raw="$2" allow_auto="${3:-}" v b
  v="$(yaml_str "${raw}")"
  [[ -n "${v}" ]] || return 1
  if [[ -n "${allow_auto}" && "$(printf '%s' "${v}" | tr '[:upper:]' '[:lower:]')" == "auto" ]]; then
    printf 'auto'
    return 0
  fi
  b="$(yaml_bool "${v}")"
  if [[ -n "${b}" ]]; then printf '%s' "${b}"; return 0; fi
  echo "Warnung: ungültiger Wert für '${key}' im Frontmatter: '${v}' – ignoriert (true/false${allow_auto:+/auto})." >&2
  return 1
}

# Umgebungsvariable lesen; USER<->USERNAME und HOME<->USERPROFILE als Rückfall
# (Notizen, die unter Windows geschrieben wurden, und umgekehrt).
env_lookup() {
  local v
  v="$(printenv "$1" 2>/dev/null || true)"
  if [[ -z "${v}" ]]; then
    case "$1" in
      USER)        v="${USERNAME:-}" ;;
      USERNAME)    v="${USER:-}" ;;
      HOME)        v="${USERPROFILE:-}" ;;
      USERPROFILE) v="${HOME:-}" ;;
    esac
  fi
  printf '%s' "${v}"
}

# Pfad aus einer Notiz aufbereiten: ~, ${VAR}, $VAR und %VAR% ersetzen,
# %XX-Kodierung (z. B. %20) auflösen, Backslashes -> '/'. Ohne eval: es wird
# nichts ausgeführt, nur Variablen eingesetzt.
# Ersetzt das erste Vorkommen von <muster> (wörtlich) in <text>. bash 3.2 (macOS)
# übernimmt Anführungszeichen im Ersatzteil von ${p/muster/"ersatz"} wörtlich,
# bash 5.2 deutet & im ungequoteten Ersatz; Präfix/Suffix-Abschnitte sind in
# beiden gleich.
replace_first() {
  local s="$1" pat="$2" rep="$3"
  case "${s}" in
    *"${pat}"*) printf '%s' "${s%%"${pat}"*}${rep}${s#*"${pat}"}" ;;
    *) printf '%s' "${s}" ;;
  esac
}

expand_path() {
  local p="$1" name hex guard=0
  # shellcheck disable=SC2088 # literales ~ am Pfadanfang erkennen, nicht expandieren
  case "${p}" in "~"|"~/"*|"~\\"*) p="$(env_lookup HOME)${p:1}" ;; esac
  # shellcheck disable=SC2016 # Regex für literale $-Variablen, keine Expansion gewollt
  local re_brace='\$\{([A-Za-z_][A-Za-z0-9_]*)\}' re_plain='\$([A-Za-z_][A-Za-z0-9_]*)'
  local re_win='%([A-Za-z_][A-Za-z0-9_]*)%' re_hex='%([0-9A-Fa-f]{2})'
  while [[ "${p}" =~ ${re_brace} ]] && (( guard++ < 20 )); do
    name="${BASH_REMATCH[1]}"; p="$(replace_first "${p}" "\${${name}}" "$(env_lookup "${name}")")"
  done
  while [[ "${p}" =~ ${re_plain} ]] && (( guard++ < 40 )); do
    name="${BASH_REMATCH[1]}"; p="$(replace_first "${p}" "\$${name}" "$(env_lookup "${name}")")"
  done
  while [[ "${p}" =~ ${re_win} ]] && (( guard++ < 60 )); do
    name="${BASH_REMATCH[1]}"; p="$(replace_first "${p}" "%${name}%" "$(env_lookup "${name}")")"
  done
  while [[ "${p}" =~ ${re_hex} ]] && (( guard++ < 200 )); do
    hex="${BASH_REMATCH[1]}"
    # shellcheck disable=SC2059 # \xHH aus geprüften Hex-Ziffern
    p="$(replace_first "${p}" "%${hex}" "$(printf "\\x${hex}")")"
  done
  printf '%s' "${p//\\//}"
}

# Frontmatter-Datum (ISO 2026-10-13 oder deutsch 13.10.2026) -> ISO; sonst leer.
iso_date() {
  local d="$1" re_iso='^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$' re_de='^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})$'
  if [[ "${d}" =~ ${re_iso} ]]; then
    printf '%s-%02d-%02d' "${BASH_REMATCH[1]}" "$((10#${BASH_REMATCH[2]}))" "$((10#${BASH_REMATCH[3]}))"
  elif [[ "${d}" =~ ${re_de} ]]; then
    printf '%s-%02d-%02d' "${BASH_REMATCH[3]}" "$((10#${BASH_REMATCH[2]}))" "$((10#${BASH_REMATCH[1]}))"
  fi
}

fm_date=""
fm_isodate_praefix=""
fm_toc="auto"
fm_break="auto"
fm_showname="true"
fm_lang="de"
fm_header=""
fm_watermark=""
fm_title=""
fm_subtitle=""
fm_toptitle=""
fm_author=""
fm_logo=""
fm_logo_height=""
fm_profile=""
fm_embed="true"
fm_breaks="true"
fm_template=""
if [[ "$(head -n 1 "${src}" | tr -d '\r')" == "---" ]]; then
  block="$(awk 'NR==1 { next } /^(---|\.\.\.)[[:space:]]*$/ { exit } { print }' "${src}" | tr -d '\r')"
  while IFS= read -r line; do
    case "${line}" in
      date:*)            fm_date="$(yaml_str "${line#date:}")" ;;
      isodate_praefix:*)
        if b="$(fm_bool isodate_praefix "${line#isodate_praefix:}")"; then fm_isodate_praefix="${b}"; fi
        ;;
      lang:*)
        v="$(yaml_str "${line#lang:}")"
        if [[ -n "${v}" ]]; then fm_lang="${v}"; fi
        ;;
      header:*)          fm_header="$(yaml_str "${line#header:}")" ;;
      watermark:*)       fm_watermark="$(yaml_str "${line#watermark:}")" ;;
      toc:*)
        if b="$(fm_bool toc "${line#toc:}" auto)"; then fm_toc="${b}"; fi
        ;;
      h1_break:*)
        if b="$(fm_bool h1_break "${line#h1_break:}" auto)"; then fm_break="${b}"; fi
        ;;
      title:*)           fm_title="$(yaml_str "${line#title:}")" ;;
      subtitle:*)        fm_subtitle="$(yaml_str "${line#subtitle:}")" ;;
      toptitle:*)        fm_toptitle="$(yaml_str "${line#toptitle:}")" ;;
      author:*)          fm_author="$(yaml_str "${line#author:}")" ;;
      logo:*)            fm_logo="$(yaml_str "${line#logo:}")" ;;
      logo-height:*)     fm_logo_height="$(yaml_str "${line#logo-height:}")" ;;
      profile:*)         fm_profile="$(yaml_str "${line#profile:}")" ;;
      print_filename:*)
        if b="$(fm_bool print_filename "${line#print_filename:}")"; then fm_showname="${b}"; fi
        ;;
      hard_breaks:*)
        if b="$(fm_bool hard_breaks "${line#hard_breaks:}")"; then fm_breaks="${b}"; fi
        ;;
      template:*)        fm_template="$(yaml_str "${line#template:}")" ;;
      embed_source:*)
        if b="$(fm_bool embed_source "${line#embed_source:}")"; then fm_embed="${b}"; fi
        ;;
    esac
  done <<< "${block}"
fi
# Die CLI-Optionen gewinnen über das Frontmatter.
if [[ -n "${cli_embed}" ]]; then fm_embed="${cli_embed}"; fi
if [[ -n "${cli_breaks}" ]]; then fm_breaks="${cli_breaks}"; fi

# ---------------------------------------------------------------------------
# Ausgabepfad: explizites zweites Argument gewinnt (relativ zum Aufruf-Verz.)
# und wird exakt so geschrieben. Sonst NEBEN der Quelle; bei erkennbarem Datum
# mit ISO-Präfix (sortierbar), außer 'isodate_praefix: false' schaltet das
# Präfix ab (Datum bleibt in der Fußzeile).
# ---------------------------------------------------------------------------
src_dir="$(cd "$(dirname "${src}")" && pwd)"
src_abs="${src_dir}/$(basename "${src}")"

# Basisordner für relative Bild- und Logopfade: MDO_BASE_DIR, falls gesetzt
# (Editoren übergeben bei ungespeicherten Änderungen eine temporäre Kopie der
# Notiz, die Bilder liegen aber neben dem Original), sonst der Ordner der Quelle.
# Ein relativer MDO_BASE_DIR gilt relativ zum Aufrufverzeichnis.
base_dir="${src_dir}"
if [[ -n "${MDO_BASE_DIR:-}" ]]; then
  case "${MDO_BASE_DIR}" in /*) cand="${MDO_BASE_DIR}" ;; *) cand="${orig_pwd}/${MDO_BASE_DIR}" ;; esac
  if [[ -d "${cand}" ]]; then
    base_dir="$(cd "${cand}" && pwd)"
  else
    echo "Warnung: MDO_BASE_DIR ist kein Ordner: ${MDO_BASE_DIR} – nutze den Ordner der Quelle." >&2
  fi
fi
date_iso="$(iso_date "${fm_date}")"
if [[ -n "${2:-}" ]]; then
  case "${2}" in
    /*) out="${2}" ;;
    *)  out="${orig_pwd}/${2}" ;;
  esac
elif [[ -n "${date_iso}" && "${fm_isodate_praefix}" != "false" ]]; then
  out="${src_dir}/${date_iso}_${base}.pdf"
else
  out="${src_dir}/${base}.pdf"
fi

# Vorlagen-Sets: <name>.typ oder <name>/<name>.typ im Benutzerordner (MDO_TEMPLATES, sonst
# ~/Documents/Markdown Office/Vorlagen) vor den mitgelieferten Sets
# (MDO_SETS_DIR/<name>/<name>.typ); der Ordner ist auch ein Logo-Suchort.
user_templates="${MDO_TEMPLATES:-${HOME:-}/Documents/Markdown Office/Vorlagen}"
# Ein relatives MDO_TEMPLATES gilt ab dem Arbeitsordner des Aufrufers (wie unter Windows).
case "${user_templates}" in /*) ;; *) user_templates="${orig_pwd}/${user_templates}" ;; esac

font_arg=()
[[ -d "${pipeline_root}/fonts" ]] && font_arg=(--font-path "${pipeline_root}/fonts" --ignore-system-fonts)

# resolve_template <wert> <basisordner>: gibt den absoluten Pfad der .typ aus.
# Leer -> memo. Ein Name (a-z, 0-9, _ und -) ist ein Set (<name>.typ oder Ordner
# <name>/<name>.typ im Benutzerordner, dann mitgeliefert); ein Wert auf .typ
# eine einzelne Datei (relativ zum Basisordner; ~ und $VAR wie bei Bildern).
# Sonst oder nicht gefunden: Meldung auf stderr, Exit 1.
resolve_template() {
  local v="${1:-memo}" base="$2" p
  if [[ "${v}" =~ ^[a-z0-9_-]+$ ]]; then
    # Benutzerordner zuerst: <name>.typ, dann ein Set-Ordner <name>/<name>.typ (geklontes
    # oder aus dem Katalog installiertes Set-Repo), danach die mitgelieferten Sets.
    for p in "${user_templates}/${v}.typ" "${user_templates}/${v}/${v}.typ" "${sets_dir}/${v}/${v}.typ"; do
      if [[ -f "${p}" ]]; then printf '%s' "${p}"; return 0; fi
    done
    echo "Error: Vorlage nicht gefunden: ${v} (gesucht in ${user_templates} und ${sets_dir})" >&2
    return 1
  fi
  case "$(printf '%s' "${v}" | tr '[:upper:]' '[:lower:]')" in
    *.typ)
      p="$(expand_path "${v}")"
      case "${p}" in /*) ;; *) p="${base}/${p}" ;; esac
      if [[ -f "${p}" ]]; then printf '%s' "${p}"; return 0; fi
      echo "Error: Vorlage nicht gefunden: ${v}" >&2
      return 1
      ;;
  esac
  echo "Error: ungültige Vorlage: ${v} (erlaubt: Set-Name aus a-z, 0-9, _ und - oder eine .typ-Datei)" >&2
  return 1
}
if [[ -n "${cli_template}" ]]; then
  template_value="${cli_template}"
  template_file="$(resolve_template "${cli_template}" "${orig_pwd}")" || exit 1
else
  template_value="${fm_template}"
  template_file="$(resolve_template "${fm_template}" "${base_dir}")" || exit 1
fi

# note_template_ok <datei>: eine .typ, die die Notiz selbst nennt (template: ./x.typ, ~, $VAR,
# absolut), läuft mit der Notiz im Staging-Ordner. Sie muss daher eine echte Datei sein (kein
# Symlink), auf .typ enden und aufgelöst unter dem Ordner der Notiz (bzw. MDO_BASE_DIR) oder dem
# Vorlagen-Ordner liegen, ohne Punkt-Ordner darunter. Warum: `template: ./evil.typ` als Link auf
# ~/.ssh/… oder ein verlinkter Ordner brächte jede lokale Datei ins PDF. Ebenso kein harter Link
# (Linkzahl > 1): ein zweiter Name derselben Datei kann eine fremde Datei sein. Die Entscheidung
# trifft der Wrapper (src/cli/stage.ts templateFile); dies prüft dieselbe Regel noch einmal.
note_template_ok() {
  local f="$1" dir real root rr rel links
  [[ -f "${f}" && ! -L "${f}" ]] || return 1
  # GNU (-c %h) zuerst, BSD (-f %l) als Rückfall (siehe SOURCE_DATE_EPOCH unten).
  links="$(stat -c %h "${f}" 2>/dev/null || stat -f %l "${f}" 2>/dev/null || echo 0)"
  [[ "${links}" == 1 ]] || return 1
  dir="$(cd -P "$(dirname "${f}")" 2>/dev/null && pwd -P)" || return 1
  real="${dir}/$(basename "${f}")"
  case "$(printf '%s' "${real##*.}" | tr '[:upper:]' '[:lower:]')" in typ) ;; *) return 1 ;; esac
  for root in "${src_dir}" "${base_dir}" "${user_templates}"; do
    rr="$(cd -P "${root}" 2>/dev/null && pwd -P)" || continue
    case "${real}" in "${rr}"/*) rel="${real#"${rr}"/}" ;; *) continue ;; esac
    case "/${rel}" in */.*) continue ;; esac
    return 0
  done
  return 1
}
# Nur ein über den Set-Namen gefundenes Set ist ein Set-Ordner (ganz geprüft und kopiert); eine
# .typ-Datei ist immer nur diese eine Datei, auch in der Form ./x/x.typ.
template_by_name=""
if [[ -z "${template_value}" || "${template_value}" =~ ^[a-z0-9_-]+$ ]]; then template_by_name=1; fi
if [[ -z "${template_by_name}" && -z "${cli_template}" ]] && ! note_template_ok "${template_file}"; then
  echo "Error: Vorlage muss eine .typ-Datei im Ordner der Notiz oder im Vorlagen-Ordner sein: ${fm_template}" >&2
  exit 1
fi

# Offline-Paketablage: Typst-Pakete im Cache-Layout (preview/<name>/<version>), damit
# #import "@preview/…" ohne Netz funktioniert (auch Importe zwischen Paketen: cades
# importiert jogs). --package-path zeigt auf einen Ordner, der nicht mitgeliefert wird,
# damit nie lokale Pakete des Rechners (@local) einfließen.
pkg_arg=(--package-cache-path "${pipeline_root}/vendor/packages" --package-path "${pipeline_root}/vendor/local-packages")

# Kein Netz, nie (1/2): jeder @preview-Import, der nicht in der Ablage liegt, würde Typst
# einen Download in die Ablage versuchen lassen. Abbruch mit Meldung, bevor Typst läuft.
# Fail closed: JEDES Vorkommen von @preview/ bis zum Anführungszeichen oder Leerraum zählt,
# auch in Kommentaren, und alles, was kein vorhandener Ablage-Ordner <name>/<version> ist
# (auch ungültige Angaben mit Großbuchstaben oder _), wird abgewiesen. Geprüft wird die
# Vorlage; ist sie ein Set-Ordner <name>/<name>.typ, jede .typ darin (auch Unterordner),
# weil ein Set Hilfsdateien einbinden kann. Bei einer einzelnen .typ nur diese, weil ihre
# Nachbarn andere Sets sein können (bindet sie eine Nachbardatei ein, die nach einem fremden
# Paket greift, stoppt das der Proxy unten). Steht hinter der Vorlagen-Auflösung (endgültige Datei).
# find -H folgt einem verlinkten Set-Ordner (z. B. ein geklontes Set-Repo, als Symlink im
# Vorlagen-Ordner); die Vorlage selbst steht immer in der Liste, was find auch liefert.
# Fail closed: scheitert find oder grep (z. B. unlesbare Datei), wird die Vorlage abgewiesen.
template_dir="$(dirname "${template_file}")"
scan_files=("${template_file}")
# Set-Ordner <name>/<name>.typ: geprüft und in den Staging-Ordner kopiert wird der ganze Ordner;
# bei einer einzelnen .typ nur diese Datei (ihre Nachbarn können andere Sets sein).
template_is_set=""
if [[ -n "${template_by_name}" && "$(basename "${template_dir}")" == "$(basename "${template_file}" .typ)" ]]; then
  template_is_set=1
  if ! found="$(find -H "${template_dir}" -type f -name '*.typ')"; then
    echo "Error: Vorlage nicht prüfbar (Set-Ordner nicht lesbar): ${template_dir}" >&2
    exit 1
  fi
  while IFS= read -r f; do
    if [[ -n "${f}" ]]; then scan_files+=("${f}"); fi
  done <<<"${found}"
fi
scan_rc=0
specs="$(grep -ohE '@preview/[^"[:space:]]*' -- "${scan_files[@]}")" || scan_rc=$?
if (( scan_rc > 1 )); then
  echo "Error: Vorlage nicht prüfbar (Datei nicht lesbar): ${template_file}" >&2
  exit 1
fi
while IFS= read -r spec; do
  [[ -n "${spec}" ]] || continue
  pkg_name="${spec%%:*}"; pkg_ver="${spec#*:}"
  if [[ ! "${spec}" =~ ^[a-z0-9-]+:[0-9]+\.[0-9]+\.[0-9]+$ ||
        ! -d "${pipeline_root}/vendor/packages/preview/${pkg_name}/${pkg_ver}" ]]; then
    echo "Error: Paket nicht mitgeliefert: @preview/${spec} (Vorlage ${template_file})" >&2
    exit 1
  fi
done < <(printf '%s\n' "${specs}" | sed 's#^@preview/##' | sort -u)

# Kein Netz, nie (2/2): was kein Textscan sieht (z. B. eine per Verkettung gebaute
# Paketangabe), stoppt ein unerreichbarer Proxy für alle Typst-Aufrufe; ein Download
# scheitert, bevor etwas in die Ablage geschrieben wird. NO_PROXY leer: keine Ausnahmen.
# Ohne jede TYPST_*-Variable (Wurzel, Paket- und Font-Pfade, Zertifikat von außen), wie die
# Formelvorschau der App (src/main/math.ts mathEnv).
no_net=(env)
while IFS= read -r var; do
  case "${var}" in TYPST_*) no_net+=(-u "${var}") ;; esac
done < <(compgen -e)
no_net+=(HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9
  https_proxy=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 all_proxy=http://127.0.0.1:9
  NO_PROXY= no_proxy=)

# ---------------------------------------------------------------------------
# Manifest lesen (JSON, vom Wrapper geschrieben und geprüft). Typst liest es (kein jq nötig),
# mit dem Ordner des Manifests als Wurzel; heraus kommt eine Zeile je Wert mit einem
# Kennbuchstaben davor: I/P Bild (Schreibweise in der Notiz / absoluter Pfad), L Logo,
# Y Profil-YAML, F Datei neben dem Profil. Werte mit Steuerzeichen (Zeilenumbruch) entfallen;
# ein solches Bild fehlt dann nur. Logo und Profil kommen NUR von hier: eigene Suchen nach
# Pfaden aus der Notiz würden wieder beliebige Dateien in den Staging-Ordner holen.
# ---------------------------------------------------------------------------
# JSON-String-Literal aus typst eval in Klartextzeilen zerlegen (\n, \t, \",
# \\ und \/ werden aufgelöst; \uXXXX kommt in Pfaden praktisch nicht vor).
json_string_lines() {
  awk '{
    s = $0; sub(/^[ \t]*"/, "", s); sub(/"[ \t]*$/, "", s)
    out = ""; n = length(s); i = 1
    while (i <= n) {
      c = substr(s, i, 1)
      if (c == "\\") {
        d = substr(s, i + 1, 1)
        if (d == "n") out = out "\n"
        else if (d == "t") out = out "\t"
        else if (d == "u") { out = out "?"; i += 4 }
        else out = out d
        i += 2
      } else { out = out c; i++ }
    }
    printf "%s", out
  }'
}

manifest_name="$(basename "${MDO_MANIFEST}")"
# Der Dateiname steht im Ausdruck selbst (keine Typst-Eingabe: Sets bekommen ihn nie zu sehen);
# daher nur ein schlichter Name (der Wrapper schreibt manifest.json).
if [[ ! "${manifest_name}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Error: Export-Manifest mit ungültigem Namen: ${MDO_MANIFEST}" >&2
  exit 1
fi
manifest_expr='{
  let m = json("/'"${manifest_name}"'")
  let plain(v) = type(v) == str and v != "" and v.match(regex("[\u{0}-\u{1f}\u{7f}]")) == none
  let abs(v) = plain(v) and v.starts-with("/")
  let out = ()
  let imgs = m.at("images", default: ())
  for i in if type(imgs) == array { imgs } else { () } {
    if type(i) == dictionary and plain(i.at("ref", default: none)) and abs(i.at("path", default: none)) {
      out.push("I" + i.ref)
      out.push("P" + i.path)
    }
  }
  let logo = m.at("logo", default: none)
  if abs(logo) { out.push("L" + logo) }
  let prof = m.at("profile", default: none)
  if type(prof) == dictionary and abs(prof.at("yaml", default: none)) {
    out.push("Y" + prof.yaml)
    let files = prof.at("files", default: ())
    for f in if type(files) == array { files } else { () } {
      if abs(f) { out.push("F" + f) }
    }
  }
  out.map(l => l + "\n").sum(default: "")
}'
manifest_dir="$(cd "$(dirname "${MDO_MANIFEST}")" && pwd)"
# stderr nicht in die Ausgabe mischen: jede Zeile dort wäre sonst ein Wert.
if ! manifest_out="$("${no_net[@]}" "${typst_bin}" eval --root "${manifest_dir}" "${manifest_expr}" 2>/dev/null)"; then
  echo "Error: Export-Manifest nicht lesbar: ${MDO_MANIFEST}" >&2
  exit 1
fi
m_refs=()
m_paths=()
m_logo=""
m_profile=""
m_profile_files=()
while IFS= read -r line; do
  case "${line}" in
    I*) m_refs+=("${line#I}") ;;
    P*) m_paths+=("${line#P}") ;;
    L*) m_logo="${line#L}" ;;
    Y*) m_profile="${line#Y}" ;;
    F*) m_profile_files+=("${line#F}") ;;
  esac
done < <(printf '%s' "${manifest_out}" | json_string_lines)

# ---------------------------------------------------------------------------
# Staging-Ordner: frisch und privat (700) im Temp-Ordner, nie neben der Notiz; die Marke
# .mdo-stage lässt den Wrapper einen Ordner wegräumen, den ein hartes Beenden (SIGKILL)
# zurückließ. Entfernt bei jedem abfangbaren Ende (Erfolg, Fehler, Signal).
# Aufbau (Pfade in Typst ab der Wurzel):
#   /note/<name>.md   die Notiz (Quelle und PDF/A-3-Anhang; der Name bleibt der Anhangsname)
#   /img/<n>-<name>   die Bilder aus dem Manifest (n: kollisionsfrei, die Endung bleibt)
#   /logo/<name>      das Logo
#   /profile/<name>   das Profil und die Bilder daneben, die es nennt (das Set liest sie dort)
#   /set/…            das Set: Set-Ordner ohne .git und profiles/; bei einer einzelnen, über den
#                     Namen gefundenen .typ ihr Ordner (gefiltert, siehe stage_folder); bei einer
#                     .typ-Datei als Pfad nur diese
#   /mdo/lib, /mdo/vendor/{cmarker,mitex,mmdr}   Pipeline-Bausteine (sys.inputs.mdo = /mdo)
#   /images.json      Zuordnung Bildquelle -> Pfad im Staging-Ordner
# Dateien werden als Inhalt kopiert (ein Symlink auf eine Datei wird aufgelöst, das Manifest hat
# sein Ziel geprüft). Set und Pipeline-Bausteine sind vertrauenswürdig: ihre Symlinks werden wie
# bisher verfolgt (cp -RL; ein Set-Repo als Symlink im Vorlagen-Ordner).
# ---------------------------------------------------------------------------
tmp_base="${TMPDIR:-/tmp}"
stage="$(mktemp -d "${tmp_base%/}/mdo-stage-XXXXXX")" || {
  echo "Error: Staging-Ordner nicht anlegbar in ${tmp_base}" >&2
  exit 1
}
cleanup() { rm -rf "${stage}"; }
trap cleanup EXIT
# Nach einem Signal endet das Skript; der EXIT-Trap räumt auf.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
chmod 700 "${stage}"
: >"${stage}/.mdo-stage"
mkdir "${stage}/note" "${stage}/img" "${stage}/logo" "${stage}/profile" "${stage}/set" "${stage}/mdo" \
  "${stage}/mdo/vendor"

# Die Notiz selbst (ihr Dateiname bleibt: Anhangsname im PDF).
note_name="$(basename "${src_abs}")"
cp -- "${src_abs}" "${stage}/note/${note_name}"
staged_note="/note/${note_name}"
attach=""
if [[ "${fm_embed}" != "false" ]]; then attach="${staged_note}"; fi

# Set und Pipeline-Bausteine. Ein Set-Ordner ohne .git (ein geklontes Set-Repo braucht seine
# Historie nicht im PDF-Lauf) und ohne profiles/: ein Set im Vorlagen-Ordner (<Vorlagen>/<set>/)
# hält dort die Profile aller Absender, und jede Notiz könnte sie lesen. Profile kommen nur über
# das Manifest nach /profile/. Eine von der Notiz genannte .typ (geprüft, kein Symlink) wird
# mit cp -P kopiert, nie über einen Link. Scheitert eine Kopie, bricht der Export ab.
copy_failed() {
  echo "Error: nicht in den Staging-Ordner kopierbar: $1" >&2
  exit 1
}
# real_path <pfad>: Pfad mit allen Symlinks aufgelöst (ohne realpath/readlink -f, die ältere
# macOS nicht kennen); Exit 1 bei einer Schleife oder einem fehlenden Ordner.
real_path() {
  local p="$1" t d n=0
  while [[ -L "${p}" ]]; do
    (( n++ < 40 )) || return 1
    t="$(readlink "${p}")" || return 1
    case "${t}" in /*) p="${t}" ;; *) p="$(dirname "${p}")/${t}" ;; esac
  done
  d="$(cd -P "$(dirname "${p}")" 2>/dev/null && pwd -P)" || return 1
  printf '%s/%s' "${d}" "$(basename "${p}")"
}

# stage_folder <ordner> <ziel>: der Ordner einer einzelnen, über den Set-Namen gefundenen .typ
# (<Vorlagen>/meinset.typ), damit sie Nachbardateien einbinden kann (Entscheidung des Besitzers,
# 2026-10-24). Der Ordner ist meist der Vorlagen-Ordner selbst; daher bleiben draußen: jeder
# Ordner namens profiles (in jeder Tiefe; dort liegen die Profile aller Absender), jeder Eintrag,
# dessen Name mit . beginnt, und jeder Symlink, dessen Ziel den Ordner verlässt. Ein Symlink auf
# eine Datei im Ordner wird als Inhalt kopiert, einer auf einen Ordner nie verfolgt.
stage_folder() {
  local src="$1" dest="$2" rsrc e rel r
  rsrc="$(cd -P "${src}" && pwd -P)" || return 1
  while IFS= read -r -d '' e; do
    rel="${e#./}"
    if [[ -L "${src}/${rel}" ]]; then
      r="$(real_path "${src}/${rel}")" || continue
      case "${r}" in "${rsrc}"/*) ;; *) continue ;; esac
      case "/${r#"${rsrc}"/}/" in */.*|*/profiles/*) continue ;; esac
      [[ -f "${r}" ]] || continue
      cp -- "${r}" "${dest}/${rel}" || return 1
    elif [[ -d "${src}/${rel}" ]]; then
      mkdir -p "${dest}/${rel}" || return 1
    elif [[ -f "${src}/${rel}" ]]; then
      cp -P -- "${src}/${rel}" "${dest}/${rel}" || return 1
    fi
  done < <(cd "${src}" && find . -mindepth 1 \( -name '.*' -o \( -type d -name profiles \) \) -prune -o -print0)
}

# Je Ziel ein cp-Aufruf (ein Export soll kaum langsamer werden als ohne Staging-Ordner).
if [[ -n "${template_is_set}" ]]; then
  set_entries=()
  shopt -s dotglob nullglob
  for entry in "${template_dir}"/*; do
    case "${entry##*/}" in .git|profiles) ;; *) set_entries+=("${entry}") ;; esac
  done
  shopt -u dotglob nullglob
  cp -RL -- "${set_entries[@]}" "${stage}/set/" || copy_failed "${template_dir}"
elif [[ -n "${template_by_name}" ]]; then
  stage_folder "${template_dir}" "${stage}/set" || copy_failed "${template_dir}"
  # Die Vorlage selbst immer als Inhalt: sie ist die Datei des Nutzers, auch als Symlink aus dem
  # Vorlagen-Ordner heraus (z. B. auf ein eigenes Repo), den stage_folder überspringt.
  cp -- "${template_file}" "${stage}/set/" || copy_failed "${template_file}"
elif [[ -z "${cli_template}" ]]; then
  cp -P -- "${template_file}" "${stage}/set/" || copy_failed "${template_file}"
else
  cp -- "${template_file}" "${stage}/set/" || copy_failed "${template_file}"
fi
staged_template="${stage}/set/$(basename "${template_file}")"
cp -RL -- "${pipeline_root}/lib" "${stage}/mdo/" || copy_failed "${pipeline_root}/lib"
vendor_parts=()
for part in cmarker mitex mmdr; do
  if [[ -d "${pipeline_root}/vendor/${part}" ]]; then vendor_parts+=("${pipeline_root}/vendor/${part}"); fi
done
if [[ "${#vendor_parts[@]}" -gt 0 ]]; then
  cp -RL -- "${vendor_parts[@]}" "${stage}/mdo/vendor/" || copy_failed "${pipeline_root}/vendor"
fi

# Bilder aus dem Manifest: /img/<n>-<name>. Verschwindet eine Datei seit dem Manifest, fehlt
# nur dieses Bild (Platzhalter im PDF), wie ein nicht gefundenes.
staged_refs=()
staged_paths=()
n=0
while (( n < ${#m_refs[@]} && n < ${#m_paths[@]} )); do
  dest="/img/$((n + 1))-${m_paths[n]##*/}"
  if cp -- "${m_paths[n]}" "${stage}${dest}" 2>/dev/null; then
    staged_refs+=("${m_refs[n]}")
    staged_paths+=("${dest}")
  fi
  n=$((n + 1))
done

# Logo (logo: im Frontmatter; gesucht hat der Wrapper: Ordner der Notiz bzw. MDO_BASE_DIR,
# Benutzerordner, Vorlagen-Ordner, Pipeline-Ordner). Ohne Logo nur ein Hinweis, nie ein Fehler.
logo=""
if [[ -n "${m_logo}" ]] && cp -- "${m_logo}" "${stage}/logo/${m_logo##*/}" 2>/dev/null; then
  logo="/logo/${m_logo##*/}"
fi
if [[ -n "${fm_logo}" && -z "${logo}" ]]; then
  case "${fm_logo}" in
    http://*|https://*|//*|data:*)
      echo "Hinweis: Remote-Logo wird nicht geladen (kein Netzzugriff): ${fm_logo}" >&2 ;;
    *)
      case "$(printf '%s' "${fm_logo##*.}" | tr '[:upper:]' '[:lower:]')" in
        svg|png|jpg|jpeg) echo "Hinweis: Logo nicht gefunden: ${fm_logo} – baue ohne Logo." >&2 ;;
        *) echo "Hinweis: Logo muss .svg, .png, .jpg oder .jpeg sein: ${fm_logo} – baue ohne Logo." >&2 ;;
      esac
      ;;
  esac
fi

# Absender-Profil (profile:): gesucht und geprüft hat der Wrapper (profiles/ neben der Notiz,
# <Vorlagen>/<set>/profiles, <Vorlagen>/profiles, Ordner des Sets; ein Pfad nur unter Notiz-
# oder Vorlagen-Ordner) und bei einem Fehler schon abgebrochen. Das Set liest die YAML-Datei und
# Dateien daneben (z. B. die Unterschrift): beide liegen in /profile/. Fehlt das Profil trotz
# profile: im Frontmatter, Exit 1: ein Brief ohne Absender wäre schlimmer als keiner.
profile=""
if [[ -n "${m_profile}" ]]; then
  cp -- "${m_profile}" "${stage}/profile/${m_profile##*/}" || copy_failed "${m_profile}"
  profile="/profile/${m_profile##*/}"
  for f in ${m_profile_files[@]+"${m_profile_files[@]}"}; do
    # Nur schlichte Namen neben der YAML-Datei: nie ".", ".." oder ihr eigener Name.
    case "${f##*/}" in
      ""|.|..|"${m_profile##*/}")
        echo "Error: ungültige Datei neben dem Profil: ${f}" >&2
        exit 1 ;;
    esac
    cp -- "${f}" "${stage}/profile/${f##*/}" || copy_failed "${f}"
  done
elif [[ -n "${fm_profile}" ]]; then
  echo "Error: Profil nicht gefunden: ${fm_profile}" >&2
  exit 1
fi

# Laufzeit-Eingaben fürs Template. --root <Staging-Ordner>: Typst behandelt absolute Pfade
# wurzelrelativ und sperrt Lesezugriffe außerhalb; alle Pfade zeigen daher in den
# Staging-Ordner (/note/…, /logo/…, /profile/…, mdo=/mdo).
# title = Rückfall-Metadatentitel (.md-Basisname); doctitle = Frontmatter title:.
typst_inputs=(
  --input "filename=$(basename "${out}")"
  --input "title=${base}"
  --input "doctitle=${fm_title}"
  --input "subtitle=${fm_subtitle}"
  --input "toptitle=${fm_toptitle}"
  --input "author=${fm_author}"
  --input "logo=${logo}"
  --input "logo_height=${fm_logo_height}"
  --input "profile=${profile}"
  --input "source=${staged_note}"
  --input "attach=${attach}"
  --input "docdir=/note"
  --input "date=${fm_date}"
  --input "toc=${fm_toc}"
  --input "h1_break=${fm_break}"
  --input "showname=${fm_showname}"
  --input "lang=${fm_lang}"
  --input "header=${fm_header}"
  --input "watermark=${fm_watermark}"
  --input "hard_breaks=${fm_breaks}"
  --input "mdo=/mdo"
  --input "version=${mdo_version}"
)
# Seitenumbruch als Element mdo-pagebreak nur für Sets, die das Element kennen (raw-typst aus); alle
# anderen bekommen wie bisher die raw-typst-Form (lib/markdown.typ pagebreaks). Ein Set-Ordner:
# jede seiner Dateien im Staging-Ordner (die html:-Zuordnung kann in einer Hilfsdatei stehen).
# Eine einzelne .typ: nur sie – ihr mitkopierter Ordner enthält oft andere Sets (din5008a/), die
# das Element kennen, und dann verschwänden die Seitenumbrüche dieser Vorlage still.
pagebreak_scan=("${staged_template}")
if [[ -n "${template_is_set}" ]]; then pagebreak_scan=("${stage}/set"); fi
if grep -rqs -- 'mdo-pagebreak' "${pagebreak_scan[@]}"; then typst_inputs+=(--input "pagebreak=html"); fi

# Reproduzierbarer Metadaten-Zeitstempel: ohne Frontmatter-date: nutzt das Template
# date: auto -> Typst schriebe sonst den *Build-Zeitpunkt* in CreateDate/ModifyDate.
# SOURCE_DATE_EPOCH (Quell-mtime) macht das deterministisch = letzte Änderungszeit
# der Quelle statt "jetzt"; Typst respektiert die Variable für date: auto. Ist ein
# date: gesetzt, pinnt das Template direkt und ignoriert dies. Ein vom Aufrufer
# gesetzter Wert gewinnt. stat unterscheidet sich zwischen GNU und BSD, und die
# Flags kollidieren: GNU 'stat -f' bedeutet *Dateisystem-Status* (liefert für eine
# gültige Datei einen mehrzeiligen Blob mit Exit 0!), BSD 'stat -f %m' die mtime.
# Daher GNU (-c %Y) ZUERST versuchen (schlägt auf BSD sauber fehl -> Fallback auf
# BSD -f %m); Ergebnis defensiv auf reine Ziffern prüfen, sonst 0.
if [[ -z "${SOURCE_DATE_EPOCH:-}" ]]; then
  src_epoch="$(stat -c %Y "${src}" 2>/dev/null || stat -f %m "${src}" 2>/dev/null || echo 0)"
  [[ "${src_epoch}" =~ ^[0-9]+$ ]] || src_epoch=0
  SOURCE_DATE_EPOCH="${src_epoch}"
fi
export SOURCE_DATE_EPOCH

# ---------------------------------------------------------------------------
# Bilder (Probe-Durchlauf). Typst kann nicht prüfen, ob eine Datei existiert – ein
# fehlendes Bild bräche den Build ab. Daher fragt `typst eval` das Template im
# Probe-Modus (lädt keine Bilder) nach allen Bildquellen (+ Zahl der Remote-Bilder).
# Die Probe läuft auf Notiztext und kann beliebige Quellen nennen; sie entscheidet daher
# NICHT, was ins PDF kommt: die Zuordnung (JSON) bildet jede Bildquelle des Manifests auf
# ihre Kopie im Staging-Ordner ab, jede andere Quelle der Probe auf "" (fehlt). Fehlende
# Bilder erscheinen im PDF als „[Bild fehlt: pfad]".
# ---------------------------------------------------------------------------
json_escape() {
  local v="$1"
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  v="${v//$'\t'/\\t}"
  printf '"%s"' "${v}"
}

# is_staged <quelle>: Exit 0, wenn die Bildquelle im Staging-Ordner liegt (bash 3.2 kennt keine
# assoziativen Arrays, daher linear).
is_staged() {
  local i=0
  while (( i < ${#staged_refs[@]} )); do
    if [[ "${staged_refs[i]}" == "$1" ]]; then return 0; fi
    i=$((i + 1))
  done
  return 1
}

probe_expr='str(query(<mdo-remote-skip>).len()) + "\n" + query(<mdo-image>).map(m => m.value + "\n").dedup().sum(default: "")'
probe="$("${no_net[@]}" "${typst_bin}" eval --in "${staged_template}" "${probe_expr}" \
  "${font_arg[@]}" "${pkg_arg[@]}" --root "${stage}" "${typst_inputs[@]}" --input probe=true 2>/dev/null || true)"
stripped=0
image_entries=""
i=0
while (( i < ${#staged_refs[@]} )); do
  image_entries="${image_entries:+${image_entries},}$(json_escape "${staged_refs[i]}"): $(json_escape "${staged_paths[i]}")"
  i=$((i + 1))
done
first=1
while IFS= read -r raw; do
  if (( first )); then stripped="${raw:-0}"; first=0; continue; fi
  [[ -n "${raw}" ]] || continue
  if ! is_staged "${raw}"; then
    echo "Warnung: Bild nicht gefunden: ${raw}" >&2
    image_entries="${image_entries:+${image_entries},}$(json_escape "${raw}"): \"\""
  fi
done < <(printf '%s' "${probe}" | json_string_lines)
[[ "${stripped}" =~ ^[0-9]+$ ]] || stripped=0
printf '{%s}\n' "${image_entries}" > "${stage}/images.json"
typst_inputs+=(--input "images=/images.json")

# Markdown -> PDF/A-3b (Template ruft cmarker auf der vorverarbeiteten Quelle). Die Meldungen
# von Typst gehen unverändert auf stderr. Ein Hinweis folgt nur, wenn eine als Pfad genannte .typ
# (allein kopiert) eine Nachbardatei einbindet, die im Originalordner liegt – nie für die Vorlage
# selbst und nie für absichtlich ausgelassene Einträge (profiles/, Punkt-Einträge).
compile_rc=0
"${no_net[@]}" "${typst_bin}" compile "${staged_template}" "${out}" \
  "${font_arg[@]}" \
  "${pkg_arg[@]}" \
  --root "${stage}" \
  --pdf-standard "${standard}" \
  "${typst_inputs[@]}" 2>"${stage}/typst.err" || compile_rc=$?
cat "${stage}/typst.err" >&2
if (( compile_rc != 0 )); then
  if [[ -z "${template_by_name}" ]]; then
    missing="$(sed -n 's|.*file not found (searched at .*/mdo-stage-[^/]*/set/\(.*\))$|\1|p' "${stage}/typst.err" | head -n 1)"
    case "/${missing}/" in
      //|*/.*|*/profiles/*) ;;
      *)
        if [[ "${missing}" != "$(basename "${template_file}")" && -e "${template_dir}/${missing}" ]]; then
          echo "Hinweis: Vorlagen mit mehreren Dateien brauchen einen Set-Ordner <name>/<name>.typ." >&2
        fi
        ;;
    esac
  fi
  exit "${compile_rc}"
fi

echo "✓ ${out} erzeugt (PDF/A-3b)"
# Remote-Bilder zählt der Probe-Durchlauf oben (<mdo-remote-skip>); die Zeile
# ist ein Parse-Vertrag für aufrufende Programme – nicht umformulieren.
if [[ "${stripped:-0}" -gt 0 ]]; then
  echo "Hinweis: ${stripped} Remote-Bild(er) übersprungen (kein Netzzugriff in Typst)."
fi

# Erzeugte PDF automatisch öffnen (immer). Opt-out über MDO_NO_OPEN=1 (z. B. für
# Batch-/Cron-Läufe). Im Hintergrund gestartet, damit das Skript sofort endet.
if [[ -z "${MDO_NO_OPEN:-}" ]]; then
  case "$(uname -s)" in
    Darwin) opener="open" ;;
    *)      opener="xdg-open" ;;
  esac
  if command -v "${opener}" >/dev/null 2>&1; then
    "${opener}" "${out}" >/dev/null 2>&1 &
  fi
fi
