#!/usr/bin/env bash
# Parity test: src/core/highlight.ts (the editor's ==highlights==) against lib/markdown.typ's
# marks() (the <mark> the PDF prints). Both run over fixtures/marks.txt; any line that
# differs fails the test.
#
# Typst comes from the dev layout build/pipeline-dev (tests/dev-layout.sh, needs
# build/pipeline-assets from `npm run assets`), or from MDO_PIPELINE_ROOT/bin/typst.
#
# Usage: bash pipeline/tests/test-marks.sh
set -euo pipefail

test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly test_dir
if [[ -z "${MDO_PIPELINE_ROOT:-}" ]]; then
  dev="$(bash "${test_dir}/dev-layout.sh")"
  MDO_PIPELINE_ROOT="${dev}/pipeline"
fi
readonly typst="${MDO_PIPELINE_ROOT}/bin/typst"
if [[ ! -x "${typst}" ]]; then
  printf 'FEHLER: %s fehlt (npm run assets)\n' "${typst}" >&2
  exit 1
fi

out_dir="$(mktemp -d)"
cleanup() { rm -rf "${out_dir}"; }
trap cleanup EXIT

# Root pipeline/: marks.typ imports ../lib/markdown.typ from the checkout itself.
"${typst}" eval 'query(<out>).first().value' --in "${test_dir}/marks.typ" \
  --root "${test_dir}/.." >"${out_dir}/typst.json"
# The core file is plain TypeScript run by type stripping; the package has no "type": "module".
# Floor: Node 22.12 (the repo's engines). Type stripping is on by default from 22.18 / 23.6;
# older 22.x releases need the flag, which they accept (process.features.typescript is false).
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
node "${node_flags[@]}" "${test_dir}/marks-core.mts" "${test_dir}/fixtures/marks.txt" "${out_dir}/typst.json"
