#!/usr/bin/env bash
# Äquivalenztest: das Set memo muss genauso rendern wie rf-doc aus
# rf-document 26.10.21 (Commit 8b5255d). Für jede Referenz in
# tests/equivalence/<fixture>.txt|.meta wird tests/fixtures/<fixture>.md wie von
# einem Nutzer über markdown-office (cli.js unter Node, mit Manifest und
# Staging-Ordner) gebaut und verglichen:
#
#   <fixture>.txt   pdftotext -layout (Seitentext inkl. Kopf- und Fußzeilen)
#   <fixture>.meta  pdfinfo Title, Author, Subject, CreationDate, ModDate, Pages,
#                   Page size (TZ=UTC), die Namen der eingebetteten Dateien und
#                   die Schriftnamen aus pdffonts (ohne Subset-Präfix ABCDEF+)
#
# Bewusst NICHT verglichen: Keywords (enthalten den Produktnamen und die
# Version) sowie Creator/Producer (Typst-Version der Umgebung).
#
# Fixtures din5008a-*: das Set din5008a muss genauso rendern wie das Original
# typst-DIN5008a 26.4.35 (Commit 729c381; template/main.typ, example-no-qr.typ
# und main.typ mit längerem Text). Die Referenzen wurden aus dem Original
# gebaut, nur mit den Schriftnamen auf die mitgelieferten variablen Fonts
# umgestellt (Source Sans 3 -> SourceSans3VF, Source Code Pro -> SourceCodeVF),
# mit typst --font-path <fonts> --ignore-system-fonts --package-cache-path
# <vendor/packages> und SOURCE_DATE_EPOCH=1. Gebaut wird mit --template din5008a.
# Aus den .meta entfernt und beim Vergleich ausgelassen, weil das Set es
# absichtlich anders macht:
#   Attachments            das Set bettet die Notiz ein, das Original nichts
#   CreationDate, ModDate  das Set nimmt wie memo das Briefdatum (date:) als
#                          Dokumentdatum; das Original kennt das Datum nur als
#                          Text und schreibt SOURCE_DATE_EPOCH
# Keywords fehlen ohnehin (Original: mit Repo-URL). Das Set kommt aus
# MDO_DIN5008A_DIR (lokaler Klon, als <tmp>/vorlagen/din5008a verlinkt), sonst
# aus <sets>/din5008a; gibt es keins, werden diese Fixtures übersprungen.
#
# Die Referenzen wurden einmalig mit dem alten Build erzeugt (gleiches
# typst-Binary, gleiche Fonts und Typst-Packages, SOURCE_DATE_EPOCH=1, leerer
# Vorlagen-Ordner) und mit `--extract` dieses Skripts ausgelesen; sie werden
# nicht neu erzeugt. Weicht ein Fixture ab, ist das ein Paritätsfehler der
# neuen Pipeline.
#
# Bewusste Abweichungen (nur die betroffenen Referenzen neu aus dem Set
# erzeugt, gleiche Umgebung, mit --extract):
#   2026-10-18, memo 26.10.2: externe Links tragen im PDF ein ↗ hinter dem
#     Linktext. Neu: tables-showcase.txt (zwei Links in Tabellenzellen).
#   2026-10-18, memo 26.10.3: Tabellenzeilen enger (Zell-Inset y 5 pt statt
#     7 pt). Nur Leerraum und Seitenumbrüche ändern sich, die Wortfolge bleibt
#     bis auf Fußzeilen-Seitenzahlen und wiederholte Tabellenköpfe gleich.
#     Neu: checklist, edge-cases, english, tasks (.txt), tables und
#     tables-showcase (.txt/.meta, je eine Seite weniger), table-intro (.txt;
#     zusätzlich mehr Fülltext im Fixture, siehe test-pdf.sh).
#   2026-10-18, memo 26.10.4: Frontmatter-Schlüssel client: heißt toptitle:.
#     Fixture client-meta umbenannt in toptitle-meta; in der .meta nur der
#     Anhangsname angepasst, der Seitentext bleibt gleich (nicht neu erzeugt).
#
# Layout wie in test-pdf.sh: MDO_PIPELINE_ROOT/MDO_SETS_DIR, sonst das
# Entwicklungs-Layout build/pipeline-dev/ (tests/dev-layout.sh).
#
# Usage: bash pipeline/tests/test-equivalence.sh
#        MDO_DIN5008A_DIR=~/GitHub/MarkdownOffice-set-din5008a bash pipeline/tests/test-equivalence.sh
#        bash pipeline/tests/test-equivalence.sh --extract PDF ZIELPRÄFIX
set -euo pipefail

test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly test_dir
readonly fixtures="${test_dir}/fixtures"
readonly refs="${test_dir}/equivalence"

die() {
  printf 'FEHLER: %s\n' "$*" >&2
  exit 1
}

# extract <pdf> <präfix>: schreibt <präfix>.txt und <präfix>.meta.
extract() {
  local pdf="$1" prefix="$2" key
  pdftotext -layout "${pdf}" "${prefix}.txt"
  {
    for key in Title Author Subject CreationDate ModDate Pages "Page size"; do
      TZ=UTC pdfinfo "${pdf}" | grep -E "^${key}:" || printf '%s: -\n' "${key}"
    done
    printf 'Attachments:'
    pdfdetach -list "${pdf}" | sed -n -E 's/^[0-9]+: (.*)$/ \1/p' | tr -d '\n'
    printf '\n'
    printf 'Fonts:\n'
    pdffonts "${pdf}" | tail -n +3 | awk '{ print $1 }' | sed -E 's/^[A-Z]{6}\+//' | LC_ALL=C sort -u
  } >"${prefix}.meta"
}

for tool in pdftotext pdfinfo pdfdetach pdffonts; do
  command -v "${tool}" >/dev/null 2>&1 || die "${tool} (poppler) wird benötigt"
done

if [[ "${1:-}" == "--extract" ]]; then
  [[ $# -eq 3 ]] || die "Aufruf: --extract PDF ZIELPRÄFIX"
  extract "$2" "$3"
  exit 0
fi

if [[ -z "${MDO_PIPELINE_ROOT:-}" ]]; then
  dev="$(bash "${test_dir}/dev-layout.sh")"
  export MDO_PIPELINE_ROOT="${dev}/pipeline"
  export MDO_SETS_DIR="${dev}/sets"
fi
# Aufruf wie markdown-office: cli.js schreibt das Manifest, ohne das build.sh nicht exportiert.
[[ -f "${MDO_PIPELINE_ROOT}/cli.js" ]] || die "${MDO_PIPELINE_ROOT}/cli.js fehlt (npm run build:cli)"
mdo=(node "${MDO_PIPELINE_ROOT}/cli.js")
export MDO_NO_OPEN=1
export SOURCE_DATE_EPOCH=1
# Bilder über Variable (absolute-paths.md) wie beim Erzeugen der Referenzen.
export TEST_ASSETS="${fixtures}"

out_dir="$(mktemp -d)"
cleanup() { rm -rf "${out_dir}"; }
trap cleanup EXIT
# Leerer Vorlagen-Ordner: ein eigenes memo in ~/Documents darf nicht greifen.
export MDO_TEMPLATES="${out_dir}/Keine Vorlagen"
mkdir -p "${MDO_TEMPLATES}"

# Vorlagen-Ordner für die din5008a-Fixtures (leer: überspringen).
din_templates=""
if [[ -n "${MDO_DIN5008A_DIR:-}" ]]; then
  [[ -f "${MDO_DIN5008A_DIR}/din5008a.typ" ]] ||
    die "MDO_DIN5008A_DIR enthält keine din5008a.typ: ${MDO_DIN5008A_DIR}"
  din_templates="${out_dir}/vorlagen"
  mkdir -p "${din_templates}"
  ln -s "$(cd "${MDO_DIN5008A_DIR}" && pwd)" "${din_templates}/din5008a"
elif [[ -f "${MDO_SETS_DIR:-${MDO_PIPELINE_ROOT}/../sets}/din5008a/din5008a.typ" ]]; then
  din_templates="${MDO_TEMPLATES}"
fi

count=0
failed=0
skipped=0
for ref in "${refs}"/*.txt; do
  [[ -e "${ref}" ]] || die "keine Referenzen in ${refs}"
  name="$(basename "${ref}" .txt)"
  [[ -f "${refs}/${name}.meta" ]] || die "${name}: ${name}.meta fehlt"
  pdf="${out_dir}/${name}.pdf"
  case "${name}" in
    din5008a-*)
      if [[ -z "${din_templates}" ]]; then
        printf 'skip %s (kein Set din5008a; MDO_DIN5008A_DIR setzen)\n' "${name}"
        skipped=$((skipped + 1))
        continue
      fi
      (cd "${fixtures}" && MDO_TEMPLATES="${din_templates}" "${mdo[@]}" --template din5008a \
        "${name}.md" "${pdf}" >/dev/null 2>"${out_dir}/${name}.err") ||
        die "${name}: Export fehlgeschlagen: $(cat "${out_dir}/${name}.err")"
      extract "${pdf}" "${out_dir}/${name}.raw"
      mv "${out_dir}/${name}.raw.txt" "${out_dir}/${name}.txt"
      # Absichtliche Abweichungen vom Original (siehe Kopfkommentar).
      grep -v -E '^(CreationDate|ModDate|Attachments):' "${out_dir}/${name}.raw.meta" >"${out_dir}/${name}.meta"
      ;;
    *)
      (cd "${fixtures}" && "${mdo[@]}" "${name}.md" "${pdf}" >/dev/null 2>"${out_dir}/${name}.err") ||
        die "${name}: Export fehlgeschlagen: $(cat "${out_dir}/${name}.err")"
      extract "${pdf}" "${out_dir}/${name}"
      ;;
  esac
  if diff -u "${ref}" "${out_dir}/${name}.txt" >"${out_dir}/${name}.diff" &&
    diff -u "${refs}/${name}.meta" "${out_dir}/${name}.meta" >>"${out_dir}/${name}.diff"; then
    printf 'ok   %s\n' "${name}"
  else
    printf 'FEHLER: %s weicht von der Referenz ab:\n' "${name}" >&2
    cat "${out_dir}/${name}.diff" >&2
    failed=$((failed + 1))
  fi
  count=$((count + 1))
done

if [[ "${failed}" -gt 0 ]]; then
  die "${failed} von ${count} Fixtures weichen ab"
fi
if [[ "${skipped}" -gt 0 ]]; then
  printf 'Alle %s Fixtures gleich (ohne Keywords), %s übersprungen.\n' "${count}" "${skipped}"
else
  printf 'Alle %s Fixtures gleich (ohne Keywords).\n' "${count}"
fi
