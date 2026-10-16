#!/usr/bin/env bash
# Smoke test of a packaged app's pipeline CLI (CI after `npm run dist`, or by hand).
#
#   scripts/smoke-cli.sh <app binary> <resources>/pipeline/cli.js
#
# Runs cli.js under the app's own binary as Node (ELECTRON_RUN_AS_NODE=1), exactly like the
# installed `markdown-office` command: --version must print `markdown-office <version>` and
# `typst <pinned version>`, and a note in a folder with spaces must become a PDF with POSIX
# options passed through unchanged. Everything happens in a temp dir; no viewer is opened.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ $# -eq 2 ]] || fail "usage: $0 <app binary> <cli.js>"
exe="$1"
cli="$2"
[[ -x "${exe}" ]] || fail "app binary missing: ${exe}"
[[ -f "${cli}" ]] || fail "cli.js missing: ${cli}"
version="$(node -p "require('${root}/package.json').version")"
typst_version="$(node -p "require('${root}/scripts/pipeline-assets.json').typst.version")"

work="$(mktemp -d "${TMPDIR:-/tmp}/mdo-smoke.XXXXXX")"
cleanup() {
  rm -rf "${work}"
}
trap cleanup EXIT

run_cli() {
  ELECTRON_RUN_AS_NODE=1 MDO_NO_OPEN=1 "${exe}" "${cli}" "$@"
}

out="$(run_cli --version)"
echo "${out}"
[[ "$(head -n 1 <<<"${out}")" == "markdown-office ${version}" ]] ||
  fail "--version does not start with 'markdown-office ${version}'"
grep -q "^typst ${typst_version//./\\.} " <<<"${out}" || fail "--version lacks 'typst ${typst_version}'"

notes="${work}/Ordner mit Leerzeichen"
mkdir -p "${notes}"
printf -- '---\ntitle: Smoke\n---\n\n# Hallo\n\nText.\n' >"${notes}/Notiz mit Leerzeichen.md"
(cd "${notes}" && run_cli --no-source --template memo "Notiz mit Leerzeichen.md" "Ergebnis mit Leerzeichen.pdf")
pdf="${notes}/Ergebnis mit Leerzeichen.pdf"
[[ -f "${pdf}" ]] || fail "no PDF written: ${pdf}"
[[ "$(head -c 5 "${pdf}")" == "%PDF-" ]] || fail "not a PDF: ${pdf}"
echo "ok   packaged CLI: --version, PDF from a note in a folder with spaces"
