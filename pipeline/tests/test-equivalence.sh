#!/usr/bin/env bash
# Äquivalenztest: das Set memo muss genauso rendern wie rf-doc aus
# rf-document 26.10.21 (Commit 8b5255d). Für jede Referenz in
# tests/equivalence/<fixture>.txt|.meta wird tests/fixtures/<fixture>.md mit
# build.sh gebaut und verglichen:
#
#   <fixture>.txt   pdftotext -layout (Seitentext inkl. Kopf- und Fußzeilen)
#   <fixture>.meta  pdfinfo Title, Author, Subject, CreationDate, ModDate, Pages,
#                   Page size (TZ=UTC), die Namen der eingebetteten Dateien und
#                   die Schriftnamen aus pdffonts (ohne Subset-Präfix ABCDEF+)
#
# Bewusst NICHT verglichen: Keywords (enthalten den Produktnamen und die
# Version) sowie Creator/Producer (Typst-Version der Umgebung).
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
#
# Layout wie in test-pdf.sh: MDO_PIPELINE_ROOT/MDO_SETS_DIR, sonst das
# Entwicklungs-Layout build/pipeline-dev/ (tests/dev-layout.sh).
#
# Usage: bash pipeline/tests/test-equivalence.sh
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
readonly build="${MDO_PIPELINE_ROOT}/build.sh"
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

count=0
failed=0
for ref in "${refs}"/*.txt; do
  [[ -e "${ref}" ]] || die "keine Referenzen in ${refs}"
  name="$(basename "${ref}" .txt)"
  [[ -f "${refs}/${name}.meta" ]] || die "${name}: ${name}.meta fehlt"
  pdf="${out_dir}/${name}.pdf"
  (cd "${fixtures}" && bash "${build}" "${name}.md" "${pdf}" >/dev/null 2>"${out_dir}/${name}.err") ||
    die "${name}: Export fehlgeschlagen: $(cat "${out_dir}/${name}.err")"
  extract "${pdf}" "${out_dir}/${name}"
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
printf 'Alle %s Fixtures gleich (ohne Keywords).\n' "${count}"
