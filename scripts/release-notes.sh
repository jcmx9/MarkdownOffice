#!/usr/bin/env bash
# Release notes for a version, from CHANGELOG.md (used by .github/workflows/release.yml
# instead of GitHub's generated notes, which list PR authors and contributors).
#
#   scripts/release-notes.sh <version> [changelog]
#
# A release prints the body of "## [<version>] ..."; a pre-release (-dev.N) the body of
# "## [Unreleased]". An empty or missing section prints "Release <version>".
set -euo pipefail

readonly EXIT_USAGE=2

version="${1:-}"
changelog="${2:-CHANGELOG.md}"
[[ -n "${version}" ]] || { echo "Verwendung: scripts/release-notes.sh <version> [changelog]" >&2; exit "${EXIT_USAGE}"; }

heading="${version}"
[[ "${version}" == *-dev.* ]] && heading="Unreleased"

body=""
if [[ -f "${changelog}" ]]; then
  body="$(awk -v want="## [${heading}]" '
    index($0, want) == 1 { inside = 1; next }
    inside && /^## \[/ { exit }
    inside { print }
  ' "${changelog}" | sed -e '/./,$!d')" # leading blank lines dropped; $(...) drops trailing ones
fi
if [[ -z "${body//[[:space:]]/}" ]]; then
  echo "Release ${version}"
else
  printf '%s\n' "${body}"
fi
