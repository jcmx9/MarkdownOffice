#!/usr/bin/env bash
# Released CHANGELOG sections are history: "## [<version>]" must read exactly as it did at
# the tag v<version>. New entries belong under "## [Unreleased]". A section without a tag
# (a release on its way into main) is not checked.
#
#   scripts/check-changelog.sh [changelog]
#
# Needs the v* tags (CI fetches them before running this).
set -euo pipefail

readonly EXIT_CHANGED=1

changelog="${1:-CHANGELOG.md}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
notes="${root}/scripts/release-notes.sh"
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

failed=0
checked=0
while IFS= read -r version; do
  git -C "${root}" rev-parse -q --verify "refs/tags/v${version}" >/dev/null || continue
  git -C "${root}" show "v${version}:CHANGELOG.md" >"${tmp}" 2>/dev/null || continue
  checked=$((checked + 1))
  if [[ "$("${notes}" "${version}" "${changelog}")" != "$("${notes}" "${version}" "${tmp}")" ]]; then
    echo "Fehler: CHANGELOG-Abschnitt [${version}] weicht vom Release v${version} ab; neue Einträge gehören unter [Unreleased]." >&2
    failed=1
  fi
done < <(sed -n 's/^## \[\([0-9][0-9.]*\)\].*/\1/p' "${changelog}")

[[ "${failed}" -eq 0 ]] || exit "${EXIT_CHANGED}"
echo "CHANGELOG: veröffentlichte Abschnitte unverändert (geprüft: ${checked})."
