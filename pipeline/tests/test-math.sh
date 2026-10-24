#!/usr/bin/env bash
# Parity test for the preview's formulas against the PDF, over fixtures/math.md:
#
# 1. Delimiters: the editor's parser (src/renderer/editor/math-syntax.ts on
#    src/core/math-delims.ts) must find exactly the formulas the vendored cmarker hands the set
#    (math.typ in `note` mode), same TeX, same inline/display decision.
# 2. Toolchain: src/main/math.ts MathRenderer (the app's batch program in its sandbox) must set
#    each formula exactly as Typst with the PDF's toolchain does (math.typ in `formulas` mode:
#    mitex from the pipeline root, build.sh's font flags), and as fixtures/math.sha256 records,
#    so a drift of flags, fonts or the mitex/Typst version fails.
# 3. The PDF: the note built with set memo uses New Computer Modern Math (Typst's built-in math
#    font, what the preview's renders draw), checked with pdffonts when poppler is installed.
#
# Typst comes from the dev layout build/pipeline-dev (tests/dev-layout.sh, needs
# build/pipeline-assets from `npm run assets`), or from MDO_PIPELINE_ROOT/bin/typst.
#
# Usage: bash pipeline/tests/test-math.sh [--update]
#   --update  rewrite fixtures/math.sha256 (after a mitex, Typst or font change)
set -euo pipefail

test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly test_dir
readonly note="${test_dir}/fixtures/math.md"
readonly refs="${test_dir}/fixtures/math.sha256"
update=()
case "${1:-}" in
  "") ;;
  --update) update=(--update) ;;
  *)
    printf 'Usage: bash pipeline/tests/test-math.sh [--update]\n' >&2
    exit 2
    ;;
esac
if [[ -z "${MDO_PIPELINE_ROOT:-}" ]]; then
  dev="$(bash "${test_dir}/dev-layout.sh")"
  MDO_PIPELINE_ROOT="${dev}/pipeline"
  MDO_SETS_DIR="${dev}/sets"
fi
MDO_SETS_DIR="${MDO_SETS_DIR:-${MDO_PIPELINE_ROOT}/../sets}"
export MDO_PIPELINE_ROOT MDO_SETS_DIR
readonly typst="${MDO_PIPELINE_ROOT}/bin/typst"
for f in "${typst}" "${MDO_PIPELINE_ROOT}/vendor/mitex/lib.typ" "${MDO_PIPELINE_ROOT}/vendor/cmarker/lib.typ"; do
  if [[ ! -e "${f}" ]]; then
    printf 'FEHLER: %s fehlt (npm run assets)\n' "${f}" >&2
    exit 1
  fi
done

out_dir="$(mktemp -d)"
cleanup() { rm -rf "${out_dir}"; }
trap cleanup EXIT

# Root /: math.typ imports cmarker and mitex by absolute path from the pipeline root (only the export
# itself runs in a staging root).
"${typst}" eval 'query(metadata).map(m => m.value)' --in "${test_dir}/math.typ" --root / \
  --input "mdo=${MDO_PIPELINE_ROOT}" --input "note=${note}" >"${out_dir}/typst.json"
# build.sh's font flags (`--font-path <root>/fonts --ignore-system-fonts`).
"${typst}" compile "${test_dir}/math.typ" "${out_dir}/direct-{0p}.svg" --format svg --root / \
  --font-path "${MDO_PIPELINE_ROOT}/fonts" --ignore-system-fonts \
  --input "mdo=${MDO_PIPELINE_ROOT}" --input "formulas=${out_dir}/typst.json"

# Node runs the app's TypeScript by type stripping, as in test-typography.sh (floor Node 22.12);
# ts-resolve.mjs adds the `.ts` the extensionless imports in src/ leave out.
node_flags=(--disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import "${test_dir}/ts-resolve.mjs")
node_major="$(node -p 'process.versions.node.split(".")[0]')"
node_minor="$(node -p 'process.versions.node.split(".")[1]')"
if (( node_major < 22 || (node_major == 22 && node_minor < 12) )); then
  printf 'FEHLER: Node %s ist zu alt (mindestens 22.12)\n' "$(node --version)" >&2
  exit 1
fi
if [[ "$(node -p 'Boolean(process.features.typescript)')" != "true" ]]; then
  node_flags+=(--experimental-strip-types)
fi
node "${node_flags[@]}" "${test_dir}/math-core.mts" "${MDO_PIPELINE_ROOT}" "${note}" \
  "${out_dir}/typst.json" "${out_dir}" "${refs}" "${update[@]+"${update[@]}"}"

# The PDF itself: set memo must leave formulas in Typst's math font. Built from a copy, so
# nothing is written next to the fixture; no user sets (MDO_TEMPLATES is an empty dir).
if command -v pdffonts >/dev/null 2>&1; then
  mkdir -p "${out_dir}/templates"
  cp "${note}" "${out_dir}/math.md"
  # Through markdown-office like a user (cli.js writes the manifest build.sh needs).
  MDO_NO_OPEN=1 MDO_TEMPLATES="${out_dir}/templates" \
    node "${MDO_PIPELINE_ROOT}/cli.js" "${out_dir}/math.md" "${out_dir}/math.pdf" >/dev/null
  fonts="$(pdffonts "${out_dir}/math.pdf")"
  if ! grep -q 'NewCMMath' <<<"${fonts}"; then
    printf 'FEHLER: das PDF setzt Formeln nicht in New Computer Modern Math:\n%s\n' "${fonts}" >&2
    exit 1
  fi
  printf 'math pdf: set memo sets formulas in New Computer Modern Math\n'
else
  printf 'Hinweis: pdffonts (poppler) fehlt, Schriftprüfung des PDFs übersprungen\n'
fi
