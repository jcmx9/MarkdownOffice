#!/usr/bin/env bash
# Parity test: src/core/typography.ts (the preview's typographic characters) against
# lib/markdown.typ's smart-typography (what the PDF prints). Both run over
# fixtures/typography.txt in German and English; any line that differs fails the test.
#
# Typst comes from the dev layout build/pipeline-dev (tests/dev-layout.sh, needs
# build/pipeline-assets from `npm run assets`), or from MDO_PIPELINE_ROOT/bin/typst.
#
# Usage: bash pipeline/tests/test-typography.sh
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

# Root pipeline/: typography.typ imports ../lib/markdown.typ from the checkout itself.
"${typst}" eval 'query(<out>).first().value' --in "${test_dir}/typography.typ" \
  --root "${test_dir}/.." >"${out_dir}/typst.json"
# The core file is plain TypeScript run by type stripping; the package has no "type": "module".
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "${test_dir}/typography-core.mts" "${test_dir}/fixtures/typography.txt" "${out_dir}/typst.json"
