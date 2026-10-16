#!/usr/bin/env bash
# Markdown Office release script (CalVer YY.M.MICRO, single source: package.json "version").
#
#   scripts/release.sh dev [--dry-run]
#   scripts/release.sh prod [--new-month] [--dry-run]
#   scripts/release.sh --print-next dev|prod [--new-month]
#
# dev   On `dev`: bump YY.M.MICRO-dev.N -> -dev.N+1, commit, tag v<version>, push
#       branch and tag atomically (the tag builds a GitHub pre-release).
# prod  From `dev`: release branch = one snapshot commit on top of main (tree = dev's tree
#       + version + CHANGELOG; main's changes must already be in dev) -> PR into `main`
#       (single commit, rebase-merge keeps main linear) -> wait for green checks ->
#       rebase-merge -> verify package.json on main -> tag on main -> push tag ->
#       back-merge PR into dev (merge of main into dev; only the version lines may
#       conflict), dev continues at the next MICRO as -dev.0.
#       --new-month switches to the current local YY.M with MICRO 0.
#
# Every prod step detects whether an earlier, aborted run already did it, so a rerun
# from `dev` continues where it stopped (see docs/github-release.md, "Recovery").
#
# --dry-run runs the local read-only checks as warnings (no network) and prints the steps.
# Test hooks: MDO_CURRENT_VERSION overrides the version read from package.json,
# MDO_NOW="YY.M" overrides the clock, MDO_TODAY="YYYY-MM-DD" the CHANGELOG date,
# MDO_REMOTE names the remote (default: origin), MDO_GH_REPO=owner/repo overrides the
# repository derived from the remote URL, MDO_POLL_INTERVAL / MDO_CHECKS_TIMEOUT (seconds)
# tune the wait for PR checks.
set -euo pipefail

readonly EXIT_USAGE=2
readonly EXIT_BRANCH=3
readonly EXIT_DIRTY=4
readonly EXIT_OUTDATED=5
readonly EXIT_TOOLING=6
readonly EXIT_TAG_EXISTS=7
readonly EXIT_VERSION=8
readonly EXIT_STEP=9
readonly EXIT_CONFLICT=10

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote="${MDO_REMOTE:-origin}"
poll_interval="${MDO_POLL_INTERVAL:-10}"
checks_timeout="${MDO_CHECKS_TIMEOUT:-900}"
gh_repo=""
version_files=()
readonly readme_files=(README.md README.en.md)
dry_run=0
new_month=0

die() {
  local code="$1"
  shift
  echo "Fehler: $*" >&2
  exit "${code}"
}

warn() {
  echo "Warnung: $*" >&2
}

# A failed check: fatal in a real run, a warning in a dry run.
check_fail() {
  local code="$1"
  shift
  if [[ "${dry_run}" -eq 1 ]]; then
    warn "$*"
  else
    die "${code}" "$*"
  fi
}

usage() {
  cat >&2 <<'USAGE'
Verwendung:
  scripts/release.sh dev [--dry-run]
  scripts/release.sh prod [--new-month] [--dry-run]
  scripts/release.sh --print-next dev|prod [--new-month]
USAGE
  exit "${EXIT_USAGE}"
}

# Run a mutating command, or only print it in dry-run mode.
run() {
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    "$@" || die "${EXIT_STEP}" "Schritt fehlgeschlagen: $*"
  fi
}

step() {
  echo "==> $*"
}

# "Already done" notices of a resumed run.
note() {
  echo "    $*"
}

g() {
  git -C "${root}" "$@"
}

# Commits made by this script: the repo's configured author and nothing else. No hooks or
# sign-off can add trailers (Signed-off-by, Co-authored-by); the only trailer the script
# writes is the technical Release-Source.
commit_plain() {
  git -C "${root}" -c core.hooksPath=/dev/null commit -q --no-verify --no-signoff "$@"
}

read_version_from_json() {
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

current_version() {
  if [[ -n "${MDO_CURRENT_VERSION:-}" ]]; then
    echo "${MDO_CURRENT_VERSION}"
    return
  fi
  local v
  v="$(read_version_from_json <"${root}/package.json")"
  [[ -n "${v}" ]] || die "${EXIT_VERSION}" "Keine Version in package.json gefunden."
  echo "${v}"
}

# package.json version at a git revision (empty if unreadable).
version_at() {
  g show "$1:package.json" 2>/dev/null | read_version_from_json || true
}

# Split "YY.M.MICRO[-dev.N]" into the globals v_year v_month v_micro v_dev.
parse_version() {
  local re='^([0-9]{2})\.([0-9]{1,2})\.([0-9]+)(-dev\.([0-9]+))?$'
  [[ "$1" =~ ${re} ]] || die "${EXIT_VERSION}" "Ungültige Version '$1' (erwartet YY.M.MICRO oder YY.M.MICRO-dev.N)."
  v_year="${BASH_REMATCH[1]}"
  v_month="${BASH_REMATCH[2]}"
  v_micro="${BASH_REMATCH[3]}"
  v_dev="${BASH_REMATCH[5]:-}"
}

today_month() {
  local now="${MDO_NOW:-$(date +%y.%-m)}"
  local re='^[0-9]{2}\.[0-9]{1,2}$'
  [[ "${now}" =~ ${re} ]] || die "${EXIT_VERSION}" "Ungültiges Datum '${now}' (erwartet YY.M)."
  echo "${now}"
}

# Next dev version: -dev.N -> -dev.N+1; a plain release continues at MICRO+1 -dev.0.
next_dev_version() {
  parse_version "$1"
  if [[ -n "${v_dev}" ]]; then
    echo "${v_year}.${v_month}.${v_micro}-dev.$((v_dev + 1))"
  else
    echo "${v_year}.${v_month}.$((v_micro + 1))-dev.0"
  fi
}

# Release version for a dev version; --new-month ($2 = 1) uses the current YY.M with MICRO 0.
next_prod_version() {
  parse_version "$1"
  [[ -n "${v_dev}" ]] || die "${EXIT_VERSION}" "Version '$1' ist bereits ein Release; prod startet von einer -dev.N-Version."
  if [[ "${2:-0}" -eq 1 ]]; then
    echo "$(today_month).0"
  else
    echo "${v_year}.${v_month}.${v_micro}"
  fi
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || check_fail "${EXIT_TOOLING}" "'$1' wurde nicht gefunden."
}

# Branch, clean tree and tools. Read-only; a dry run reports failures as warnings.
preconditions() {
  step "Prüfe Voraussetzungen"
  if ! g rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    check_fail "${EXIT_TOOLING}" "${root} ist kein Git-Checkout."
    return
  fi
  require_tool git
  require_tool npm
  local branch
  branch="$(g rev-parse --abbrev-ref HEAD)"
  [[ "${branch}" == "dev" ]] || check_fail "${EXIT_BRANCH}" "Release nur auf dem Branch 'dev' (aktuell: '${branch}')."
  [[ -z "$(g status --porcelain)" ]] || check_fail "${EXIT_DIRTY}" "Arbeitsverzeichnis ist nicht sauber; erst committen oder stashen."
}

fetch_remote() {
  if [[ "${dry_run}" -eq 1 ]]; then
    note "[dry-run] kein git fetch; Vergleich mit dem Stand des letzten fetch"
    return
  fi
  g fetch --quiet --tags "${remote}" || die "${EXIT_TOOLING}" "git fetch ${remote} fehlgeschlagen."
}

require_in_sync() {
  g rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  local local_sha remote_sha
  local_sha="$(g rev-parse HEAD)"
  if ! remote_sha="$(g rev-parse -q --verify "refs/remotes/${remote}/dev")"; then
    check_fail "${EXIT_OUTDATED}" "${remote}/dev existiert nicht."
    return
  fi
  [[ "${local_sha}" == "${remote_sha}" ]] || check_fail "${EXIT_OUTDATED}" "'dev' stimmt nicht mit ${remote}/dev überein; erst pullen bzw. pushen."
}

local_tag_exists() {
  g rev-parse -q --verify "refs/tags/$1" >/dev/null
}

# Peeled commit of a remote tag, empty when the tag does not exist there.
remote_tag_commit() {
  local out
  out="$(g ls-remote --tags "${remote}" "refs/tags/$1" "refs/tags/$1^{}")" || die "${EXIT_TOOLING}" "git ls-remote ${remote} fehlgeschlagen."
  [[ -n "${out}" ]] || return 0
  local peeled
  peeled="$(awk '$2 ~ /\^\{\}$/ { print $1 }' <<<"${out}")"
  [[ -n "${peeled}" ]] || peeled="$(awk 'NR == 1 { print $1 }' <<<"${out}")"
  echo "${peeled}"
}

require_tag_free() {
  local tag="$1"
  if local_tag_exists "${tag}"; then
    check_fail "${EXIT_TAG_EXISTS}" "Tag ${tag} existiert bereits lokal."
  fi
  [[ "${dry_run}" -eq 1 ]] && return
  if [[ -n "$(remote_tag_commit "${tag}")" ]]; then
    die "${EXIT_TAG_EXISTS}" "Tag ${tag} existiert bereits auf ${remote}."
  fi
}

remote_branch_exists() {
  local out
  out="$(g ls-remote --heads "${remote}" "refs/heads/$1")" || die "${EXIT_TOOLING}" "git ls-remote ${remote} fehlgeschlagen."
  [[ -n "${out}" ]]
}

fetch_branch() {
  g fetch --quiet "${remote}" "+refs/heads/$1:refs/remotes/${remote}/$1" || die "${EXIT_TOOLING}" "git fetch ${remote} $1 fehlgeschlagen."
}

# owner/repo for `gh -R`, so gh never depends on the caller's working directory.
resolve_gh_repo() {
  if [[ -n "${MDO_GH_REPO:-}" ]]; then
    gh_repo="${MDO_GH_REPO}"
    return
  fi
  local url re='github\.com[:/]([^/]+)/([^/]+)$'
  url="$(g remote get-url "${remote}" 2>/dev/null || true)"
  url="${url%/}"
  url="${url%.git}"
  if [[ "${url}" =~ ${re} ]]; then
    gh_repo="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    gh_repo="<owner/repo>"
    check_fail "${EXIT_TOOLING}" "GitHub-Repository lässt sich aus ${remote} ('${url}') nicht ableiten; MDO_GH_REPO=owner/repo setzen."
  fi
}

require_gh() {
  require_tool gh
  resolve_gh_repo
  if [[ "${dry_run}" -eq 1 ]]; then
    note "[dry-run] gh auth status übersprungen (Netzwerk)"
    return
  fi
  gh auth status >/dev/null 2>&1 || die "${EXIT_TOOLING}" "gh ist nicht angemeldet (gh auth login)."
}

# Warn when a release would carry last month's YY.M (prod without --new-month).
warn_old_month() {
  parse_version "$1"
  local now
  now="$(today_month)"
  if [[ "${v_year}.${v_month}" != "${now}" ]]; then
    warn "Release $1 trägt den Monat ${v_year}.${v_month}, heute ist ${now}. Für den aktuellen Monat: scripts/release.sh prod --new-month"
  fi
}

# npm updates package.json and package-lock.json together; the READMEs' "**Version:**"
# line follows.
bump_files() {
  run npm version "$1" --no-git-tag-version --allow-same-version
  version_files=(package.json)
  if [[ "${dry_run}" -eq 1 || -f "${root}/package-lock.json" ]]; then
    version_files+=(package-lock.json)
  fi
  local readme
  for readme in "${readme_files[@]}"; do
    [[ -f "${root}/${readme}" ]] || continue
    if [[ "${dry_run}" -eq 1 ]]; then
      echo "[dry-run] ${readme}: **Version:** $1"
      continue
    fi
    grep -q '^\*\*Version:\*\* ' "${root}/${readme}" || continue
    sed "s/^\*\*Version:\*\* [^ ]*/**Version:** $1/" "${root}/${readme}" >"${root}/${readme}.tmp"
    cat "${root}/${readme}.tmp" >"${root}/${readme}"
    rm -f "${root}/${readme}.tmp"
    version_files+=("${readme}")
  done
}

# Keep a Changelog: "## [Unreleased]" -> "## [Unreleased]" + "## [<version>] - <date>".
roll_changelog() {
  local version="$1" file="${root}/CHANGELOG.md"
  local date="${MDO_TODAY:-$(date +%Y-%m-%d)}"
  if [[ "${dry_run}" -eq 1 ]]; then
    echo "[dry-run] CHANGELOG.md: [Unreleased] -> ## [${version}] - ${date}"
    return
  fi
  [[ -f "${file}" ]] || return 0
  if grep -qF "## [${version}]" "${file}"; then
    note "CHANGELOG.md enthält ${version} bereits."
    return
  fi
  grep -qx '## \[Unreleased\]' "${file}" || die "${EXIT_STEP}" "CHANGELOG.md hat keinen Abschnitt '## [Unreleased]'."
  awk -v ver="${version}" -v date="${date}" '
    !done && $0 == "## [Unreleased]" { print; print ""; print "## [" ver "] - " date; done = 1; next }
    { print }
  ' "${file}" >"${file}.tmp"
  cat "${file}.tmp" >"${file}"
  rm -f "${file}.tmp"
  version_files+=(CHANGELOG.md)
}

# True when every conflicted file is package.json/package-lock.json or a README and every
# conflict hunk in them consists of version lines only.
only_version_conflicts() {
  local f
  for f in "$@"; do
    case "${f}" in
      package.json | package-lock.json | README.md | README.en.md) ;;
      *) return 1 ;;
    esac
    awk '
      /^<<<<<<< / { inside = 1; hunks++; next }
      /^\|\|\|\|\|\|\| / { bad = 1 }
      inside && /^=======\r?$/ { next }
      /^>>>>>>> / { inside = 0; next }
      inside && $0 !~ /^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"[^"]*",?[[:space:]]*\r?$/ &&
        $0 !~ /^\*\*Version:\*\* / { bad = 1 }
      END { exit (bad || hunks == 0) ? 1 : 0 }
    ' "${root}/${f}" || return 1
  done
}

# Resolve conflict hunks in a file by keeping one side ("ours" or "theirs").
resolve_side() {
  local side="$1" file="${root}/$2"
  awk -v side="${side}" '
    /^<<<<<<< / { state = 1; next }
    state == 1 && /^=======\r?$/ { state = 2; next }
    state && /^>>>>>>> / { state = 0; next }
    state == 1 { if (side == "ours") print; next }
    state == 2 { if (side == "theirs") print; next }
    { print }
  ' "${file}" >"${file}.tmp"
  cat "${file}.tmp" >"${file}"
  rm -f "${file}.tmp"
}

conflicted_files() {
  g diff --name-only --diff-filter=U
}

# The Release-Source trailer of the newest release on main: the dev commit it was cut from.
last_release_source() {
  g log -1 --format=%B --grep='^Release-Source: ' "${remote}/main" |
    sed -n 's/^Release-Source: \([0-9a-f]\{7,\}\)[[:space:]]*$/\1/p' | head -n 1
}

# Guard for the snapshot: every change on main must already be in dev, because the release
# commit takes dev's tree as it is. True when main is an ancestor of dev, or when merging main
# into dev is clean and changes nothing (e.g. a hotfix committed to main and to dev).
main_contained_in_dev() {
  g merge-base --is-ancestor "${remote}/main" "${remote}/dev" && return 0
  local merged
  merged="$(g merge-tree --write-tree "${remote}/dev" "${remote}/main" 2>/dev/null | head -n 1)" || return 1
  [[ -n "${merged}" && "${merged}" == "$(g rev-parse "${remote}/dev^{tree}")" ]]
}

# release/<version>: ONE snapshot commit on top of origin/main whose tree is origin/dev's
# tree plus the release version and the rolled CHANGELOG. No per-commit replay, so earlier
# conflict resolutions on dev can never block a release.
build_release_branch() {
  local version="$1" branch="$2" src
  src="$(g rev-parse "${remote}/dev")"
  if ! main_contained_in_dev; then
    g checkout -q dev
    die "${EXIT_CONFLICT}" "${remote}/main enthält Änderungen, die nicht in ${remote}/dev sind. Erst main per PR in dev mergen (Konflikte dort lösen), dann erneut starten: git checkout -b chore/sync-main ${remote}/dev && git merge ${remote}/main. Nichts wurde gepusht."
  fi
  if g rev-parse -q --verify "refs/heads/${branch}" >/dev/null; then
    note "Lokaler Branch ${branch} (abgebrochener Lauf) wird neu aufgebaut."
  fi
  g checkout -q -B "${branch}" "${remote}/main"
  # Index and working tree become exactly dev's tree (files only on main are removed).
  g read-tree -u --reset "${src}" || { g checkout -q -f dev; die "${EXIT_STEP}" "read-tree ${src} fehlgeschlagen."; }
  bump_files "${version}"
  roll_changelog "${version}"
  g add -- "${version_files[@]}"
  commit_plain -m "release: ${version}" -m "Release-Source: ${src}" ||
    { g checkout -q -f dev; die "${EXIT_STEP}" "Release-Commit fehlgeschlagen."; }
}

# Release-Source trailer of a commit (empty when it has none).
release_source_of() {
  g log -1 --format=%B "$1" | sed -n 's/^Release-Source: \([0-9a-f]\{7,\}\)[[:space:]]*$/\1/p' | head -n 1
}

pr_state() {
  gh pr view "$1" -R "${gh_repo}" --json state --jq .state 2>/dev/null || true
}

# Poll until GitHub has registered at least one check, then watch them.
wait_checks() {
  local head="$1" start count
  step "Warte auf grüne Checks (${head})"
  start="$(date +%s)"
  while :; do
    count="$(gh pr checks "${head}" -R "${gh_repo}" --json name --jq length 2>/dev/null || true)"
    if [[ "${count}" =~ ^[0-9]+$ && "${count}" -gt 0 ]]; then
      break
    fi
    if (($(date +%s) - start >= checks_timeout)); then
      die "${EXIT_STEP}" "Für ${head} wurden nach ${checks_timeout}s keine Checks registriert. PR prüfen und erneut starten; das Skript setzt fort."
    fi
    sleep "${poll_interval}"
  done
  gh pr checks "${head}" -R "${gh_repo}" --watch --fail-fast ||
    die "${EXIT_STEP}" "Checks für ${head} sind fehlgeschlagen. Nach der Korrektur erneut starten; das Skript setzt beim offenen PR fort."
}

# Create (or reuse) a PR, wait for its checks and merge it with the given method.
pr_flow() {
  local head="$1" base="$2" title="$3" body="$4" method="$5" state
  state="$(pr_state "${head}")"
  case "${state}" in
    MERGED)
      note "PR ${head} -> ${base} ist bereits gemergt."
      return
      ;;
    OPEN) note "PR ${head} -> ${base} existiert bereits." ;;
    *) run gh pr create -R "${gh_repo}" --base "${base}" --head "${head}" --title "${title}" --body "${body}" ;;
  esac
  wait_checks "${head}"
  step "Merge ${head} -> ${base} (--${method})"
  run gh pr merge "${head}" -R "${gh_repo}" "--${method}" --delete-branch
}

release_to_main() {
  local version="$1" branch="release/$1"
  step "Release-Branch ${branch}: Snapshot von ${remote}/dev auf ${remote}/main"
  if remote_branch_exists "${branch}"; then
    fetch_branch "${branch}"
    local ref="${remote}/${branch}" source
    source="$(release_source_of "${ref}")"
    if [[ "$(g log -1 --format=%s "${ref}")" == "release: ${version}" &&
      "$(version_at "${ref}")" == "${version}" &&
      "$(g rev-parse "${ref}^")" == "$(g rev-parse "${remote}/main")" &&
      "${source}" == "$(g rev-parse "${remote}/dev")" ]]; then
      note "${ref} existiert bereits (Stand ${remote}/dev) und wird weiterverwendet."
    else
      die "${EXIT_STEP}" "${ref} passt nicht mehr zu ${remote}/dev bzw. ${remote}/main (Release-Source ${source:-fehlt}). Löschen und neu aufbauen lassen: git push ${remote} --delete ${branch} && scripts/release.sh prod"
    fi
  else
    build_release_branch "${version}" "${branch}"
    run g push -q -u "${remote}" "${branch}"
    g checkout -q dev
  fi
  pr_flow "${branch}" main "release: ${version}" "Release ${version}" rebase
}

verify_main_version() {
  local version="$1" on_main
  step "Prüfe package.json auf ${remote}/main"
  g fetch --quiet "${remote}" main || die "${EXIT_TOOLING}" "git fetch ${remote} main fehlgeschlagen."
  on_main="$(version_at "${remote}/main")"
  [[ "${on_main}" == "${version}" ]] || die "${EXIT_VERSION}" "package.json auf main hat Version '${on_main}', erwartet '${version}'. Kein Tag gesetzt."
}

tag_main() {
  local version="$1" tag="v$1" main_sha
  step "Tag ${tag} auf main und Push"
  main_sha="$(g rev-parse "${remote}/main")"
  if local_tag_exists "${tag}"; then
    [[ "$(g rev-parse "${tag}^{commit}")" == "${main_sha}" ]] ||
      die "${EXIT_TAG_EXISTS}" "Tag ${tag} existiert lokal auf einem anderen Commit als ${remote}/main (git tag -d ${tag})."
    note "Tag ${tag} existiert lokal bereits auf ${remote}/main."
  else
    run git -C "${root}" tag -a "${tag}" -m "Release ${version}" "${main_sha}"
  fi
  run git -C "${root}" push -q "${remote}" "refs/tags/${tag}"
}

# Start the back-merge on the checked-out branch (a copy of origin/dev): a merge commit
# with main as second parent, left uncommitted. main's history is a rewritten copy of dev's
# (rebase-merge), so a plain merge would use the previous release as base and both sides
# would look changed. With the release's Release-Source known, the content is dev plus the
# release delta (Release-Source..main: version, CHANGELOG, hotfixes) instead.
merge_release_into_dev() {
  local src
  src="$(last_release_source)"
  if [[ -z "${src}" ]] || ! g merge-base --is-ancestor "${src}" "${remote}/dev" 2>/dev/null; then
    g -c merge.conflictStyle=merge merge -q --no-ff --no-commit "${remote}/main" >/dev/null 2>&1
    return
  fi
  g merge -q --no-ff --no-commit -s ours "${remote}/main" >/dev/null 2>&1 || return 1
  g diff --quiet "${src}" "${remote}/main" && return 0
  g diff --no-color --no-ext-diff --binary --src-prefix=a/ --dst-prefix=b/ "${src}" "${remote}/main" |
    g -c merge.conflictStyle=merge apply -3 >/dev/null 2>&1
}

# Merge main into dev and set the next dev version. Only the version lines of
# package.json/package-lock.json and the READMEs may conflict; anything else aborts with nothing pushed.
back_merge() {
  local version="$1" next_dev="$2" tag="v$1" branch="chore/back-merge-$1"
  step "Back-Merge ${tag} nach dev (${branch}), dev -> ${next_dev}"
  # dev may have moved while the release PR ran.
  g fetch --quiet "${remote}" || die "${EXIT_TOOLING}" "git fetch ${remote} fehlgeschlagen."
  if g merge-base --is-ancestor "${remote}/main" "${remote}/dev"; then
    note "${remote}/dev enthält ${remote}/main bereits – Back-Merge übersprungen."
    return
  fi
  if remote_branch_exists "${branch}"; then
    fetch_branch "${branch}"
    if [[ "$(version_at "${remote}/${branch}")" == "${next_dev}" ]] &&
      g merge-base --is-ancestor "${remote}/main" "${remote}/${branch}"; then
      note "${remote}/${branch} existiert bereits und wird weiterverwendet."
    else
      die "${EXIT_STEP}" "${remote}/${branch} existiert, enthält aber nicht ${remote}/main mit ${next_dev}. Prüfen und ggf. löschen: git push ${remote} --delete ${branch}"
    fi
  else
    if g rev-parse -q --verify "refs/heads/${branch}" >/dev/null; then
      note "Lokaler Branch ${branch} (abgebrochener Lauf) wird neu aufgebaut."
    fi
    g checkout -q -B "${branch}" "${remote}/dev"
    if ! merge_release_into_dev; then
      local conflicted files=()
      conflicted="$(conflicted_files)"
      while IFS= read -r f; do [[ -n "${f}" ]] && files+=("${f}"); done <<<"${conflicted}"
      if [[ ${#files[@]} -eq 0 ]] || ! only_version_conflicts "${files[@]}"; then
        g merge --abort >/dev/null 2>&1 || true
        g checkout -q dev
        g branch -q -D "${branch}"
        die "${EXIT_CONFLICT}" "Back-Merge ${tag} -> dev hat Konflikte außerhalb der Versionszeilen (${files[*]:-unbekannt}). ${tag} ist veröffentlicht, für dev wurde nichts gepusht. Manuell abschließen: docs/github-release.md, Abschnitt Recovery."
      fi
      for f in "${files[@]}"; do resolve_side ours "${f}"; done
    fi
    bump_files "${next_dev}"
    g add -- "${version_files[@]}"
    commit_plain -m "chore(release): back-merge ${tag} into dev" -m "dev continues at ${next_dev}." ||
      die "${EXIT_STEP}" "Back-Merge-Commit fehlgeschlagen."
    run g push -q -u "${remote}" "${branch}"
    g checkout -q dev
  fi
  pr_flow "${branch}" dev "chore(release): back-merge ${version}" "Merge ${tag} back into dev; dev continues at ${next_dev}." merge
}

release_dev() {
  local cur next
  cur="$(current_version)"
  next="$(next_dev_version "${cur}")"
  echo "Version: ${next}"
  preconditions
  fetch_remote
  # Resume: an aborted run left the release commit and tag only locally.
  if [[ "${dry_run}" -eq 0 ]] && local_tag_exists "v${cur}" &&
    [[ "$(g rev-parse "v${cur}^{commit}")" == "$(g rev-parse HEAD)" &&
      "$(g log -1 --format=%s)" == "release: ${cur}" &&
      "$(g rev-parse HEAD^)" == "$(g rev-parse "${remote}/dev")" &&
      -z "$(remote_tag_commit "v${cur}")" ]]; then
    step "v${cur} ist lokal fertig, aber nicht gepusht – Push wird wiederholt"
    run git -C "${root}" push -q --atomic "${remote}" dev "refs/tags/v${cur}"
    echo "Fertig: v${cur} wurde veröffentlicht."
    return
  fi
  require_in_sync
  require_tag_free "v${next}"
  step "Bump ${cur} -> ${next}"
  bump_files "${next}"
  run git -C "${root}" add -- "${version_files[@]}"
  run commit_plain -m "release: ${next}"
  step "Tag v${next} und Push (atomar; löst den Pre-Release-Workflow aus)"
  run git -C "${root}" tag -a "v${next}" -m "Release ${next}"
  run git -C "${root}" push -q --atomic "${remote}" dev "refs/tags/v${next}"
  if [[ "${dry_run}" -eq 0 ]]; then echo "Fertig: v${next} wurde veröffentlicht."; fi
}

print_prod_plan() {
  local version="$1" next_dev="$2" tag="v$1"
  echo "[dry-run] prüfen, dass ${remote}/main in ${remote}/dev enthalten ist; git -C ${root} checkout -B release/${version} ${remote}/main; git read-tree -u --reset ${remote}/dev"
  run npm version "${version}" --no-git-tag-version --allow-same-version
  roll_changelog "${version}"
  run commit_plain -m "release: ${version}" -m "Release-Source: <${remote}/dev>"
  run git -C "${root}" push -u "${remote}" "release/${version}"
  run gh pr create -R "${gh_repo}" --base main --head "release/${version}" --title "release: ${version}"
  echo "[dry-run] warten, bis Checks registriert sind; gh pr checks release/${version} -R ${gh_repo} --watch --fail-fast"
  run gh pr merge "release/${version}" -R "${gh_repo}" --rebase --delete-branch
  echo "[dry-run] git fetch ${remote} main; erwarte Version ${version} in ${remote}/main:package.json"
  run git -C "${root}" tag -a "${tag}" -m "Release ${version}" "${remote}/main"
  run git -C "${root}" push "${remote}" "refs/tags/${tag}"
  echo "[dry-run] git -C ${root} checkout -B chore/back-merge-${version} ${remote}/dev; git merge --no-commit ${remote}/main (nur Versionskonflikte werden aufgelöst)"
  run npm version "${next_dev}" --no-git-tag-version --allow-same-version
  run git -C "${root}" push -u "${remote}" "chore/back-merge-${version}"
  run gh pr create -R "${gh_repo}" --base dev --head "chore/back-merge-${version}"
  run gh pr merge "chore/back-merge-${version}" -R "${gh_repo}" --merge --delete-branch
}

release_prod() {
  local cur version next_dev tag
  cur="$(current_version)"
  version="$(next_prod_version "${cur}" "${new_month}")"
  next_dev="$(next_dev_version "${version}")"
  tag="v${version}"
  echo "Version: ${version}"
  [[ "${new_month}" -eq 1 ]] || warn_old_month "${version}"
  preconditions
  fetch_remote
  require_in_sync
  require_gh
  if [[ "${dry_run}" -eq 1 ]]; then
    require_tag_free "${tag}"
    print_prod_plan "${version}" "${next_dev}"
    return
  fi

  local published
  published="$(remote_tag_commit "${tag}")"
  if [[ -n "${published}" ]]; then
    if g merge-base --is-ancestor "${published}" "${remote}/main" 2>/dev/null &&
      [[ "$(version_at "${published}")" == "${version}" ]]; then
      step "Release ${tag}"
      note "${tag} ist bereits veröffentlicht – Release-Schritte übersprungen."
    else
      die "${EXIT_TAG_EXISTS}" "Tag ${tag} existiert bereits auf ${remote}, gehört aber nicht zu diesem Release."
    fi
  else
    if [[ "$(version_at "${remote}/main")" == "${version}" ]]; then
      step "Release ${version} nach main"
      note "${remote}/main hat bereits Version ${version} – Merge übersprungen."
    else
      release_to_main "${version}"
    fi
    verify_main_version "${version}"
    tag_main "${version}"
  fi

  back_merge "${version}" "${next_dev}"
  g checkout -q dev
  g pull -q --ff-only "${remote}" dev || die "${EXIT_STEP}" "git pull --ff-only ${remote} dev fehlgeschlagen."
  echo "Fertig: ${tag} veröffentlicht, dev steht auf ${next_dev}."
}

main() {
  local cmd="" print_next=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      dev | prod)
        if [[ -n "${print_next}" && "${print_next}" == "?" ]]; then print_next="$1"; else cmd="$1"; fi
        ;;
      --print-next) print_next="?" ;;
      --new-month) new_month=1 ;;
      --dry-run) dry_run=1 ;;
      -h | --help) usage ;;
      *)
        echo "Unbekannte Option: $1" >&2
        usage
        ;;
    esac
    shift
  done

  if [[ "${print_next}" == "?" ]]; then usage; fi
  if [[ -n "${print_next}" ]]; then
    case "${print_next}" in
      dev) next_dev_version "$(current_version)" ;;
      prod) next_prod_version "$(current_version)" "${new_month}" ;;
    esac
    return
  fi

  if [[ "${new_month}" -eq 1 && "${cmd}" != "prod" ]]; then
    die "${EXIT_USAGE}" "--new-month ist nur mit 'prod' erlaubt."
  fi
  # npm and gh run in the repo root, wherever the script was started from.
  cd "${root}"
  case "${cmd}" in
    dev) release_dev ;;
    prod) release_prod ;;
    *) usage ;;
  esac
}

main "$@"
