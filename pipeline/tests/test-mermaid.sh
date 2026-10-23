#!/usr/bin/env bash
# Parity test: src/core/mermaid.ts (the preview's Mermaid diagrams, drawn by the bundled mmdr
# plugin through src/core/typst-plugin.ts) against Typst running the same plugin with memo's
# arguments (mermaid.typ). Every fixtures/mermaid/*.mmd must give the same SVG byte for byte,
# and the committed references tests/fixtures/mermaid/*.svg (used by the e2e test) must match.
#
# Typst comes from the dev layout build/pipeline-dev (tests/dev-layout.sh, needs
# build/pipeline-assets from `npm run assets`), or from MDO_PIPELINE_ROOT/bin/typst.
#
# Usage: bash pipeline/tests/test-mermaid.sh [--update]
#   --update  rewrite tests/fixtures/mermaid/*.svg (after an mmdr or argument change)
set -euo pipefail

test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly test_dir
ref_dir="$(cd "${test_dir}/../.." && pwd)/tests/fixtures/mermaid"
readonly ref_dir
update=()
case "${1:-}" in
  "") ;;
  --update) update=(--update) ;;
  *)
    printf 'Usage: bash pipeline/tests/test-mermaid.sh [--update]\n' >&2
    exit 2
    ;;
esac
if [[ -z "${MDO_PIPELINE_ROOT:-}" ]]; then
  dev="$(bash "${test_dir}/dev-layout.sh")"
  MDO_PIPELINE_ROOT="${dev}/pipeline"
fi
readonly typst="${MDO_PIPELINE_ROOT}/bin/typst"
readonly wasm="${MDO_PIPELINE_ROOT}/vendor/mmdr/typst_mmdr.wasm"
for f in "${typst}" "${wasm}"; do
  if [[ ! -e "${f}" ]]; then
    printf 'FEHLER: %s fehlt (npm run assets)\n' "${f}" >&2
    exit 1
  fi
done

out_dir="$(mktemp -d)"
cleanup() { rm -rf "${out_dir}"; }
trap cleanup EXIT

names=()
for f in "${test_dir}"/fixtures/mermaid/*.mmd; do
  names+=("$(basename "${f}" .mmd)")
done
names_csv="$(IFS=,; printf '%s' "${names[*]}")"

# Root / like build.sh: mermaid.typ imports mmdr by absolute path from the pipeline root.
"${typst}" eval 'query(<out>).first().value' --in "${test_dir}/mermaid.typ" --root / \
  --input "mdo=${MDO_PIPELINE_ROOT}" --input "names=${names_csv}" >"${out_dir}/typst.json"
# Node runs the core files by type stripping, as in test-typography.sh (floor Node 22.12).
node_flags=(--disable-warning=MODULE_TYPELESS_PACKAGE_JSON)
node_major="$(node -p 'process.versions.node.split(".")[0]')"
node_minor="$(node -p 'process.versions.node.split(".")[1]')"
if (( node_major < 22 || (node_major == 22 && node_minor < 12) )); then
  printf 'FEHLER: Node %s ist zu alt (mindestens 22.12)\n' "$(node --version)" >&2
  exit 1
fi
if [[ "$(node -p 'Boolean(process.features.typescript)')" != "true" ]]; then
  node_flags+=(--experimental-strip-types)
fi
mkdir -p "${ref_dir}"
node "${node_flags[@]}" "${test_dir}/mermaid-core.mts" "${wasm}" "${test_dir}/fixtures/mermaid" \
  "${out_dir}/typst.json" "${ref_dir}" "${update[@]+"${update[@]}"}"
