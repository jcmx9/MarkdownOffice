#!/usr/bin/env bash
# Tests for scripts/release.sh (CI runs this on Linux).
#
#   scripts/test-release.sh
#
# 1. Version arithmetic via `--print-next`.
# 2. `--dry-run` for dev and prod against the real checkout (must change nothing, no network).
# 4. scripts/release-notes.sh (the release workflow's notes from CHANGELOG.md).
# 3. Full flows in a throwaway repo below a temp dir, with a bare repo as fake origin and
#    fake `npm`/`gh` on PATH. The fake `gh pr merge --rebase` behaves like GitHub: it
#    cherry-picks the PR's commits onto the base with a new committer, so SHAs change, and
#    it refuses merge commits or conflicts. Two prod cycles run back to back with a dev
#    cycle in between, plus resume, conflict and atomic-push cases. The real remote is
#    never touched.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release="${root}/scripts/release.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "ok   $*"
}

expect_eq() {
  [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"
  pass "$1"
}

# --- 1. version arithmetic -------------------------------------------------
next() {
  local cur="$1"
  shift
  MDO_CURRENT_VERSION="${cur}" MDO_NOW="26.11" "${release}" --print-next "$@"
}

expect_eq "dev increments" "$(next 26.10.0-dev.0 dev)" "26.10.0-dev.1"
expect_eq "dev increments (two digits)" "$(next 26.10.1-dev.9 dev)" "26.10.1-dev.10"
expect_eq "dev after release continues at next MICRO" "$(next 26.10.0 dev)" "26.10.1-dev.0"
expect_eq "prod strips dev suffix" "$(next 26.10.0-dev.3 prod)" "26.10.0"
expect_eq "prod keeps MICRO" "$(next 26.10.2-dev.0 prod)" "26.10.2"
expect_eq "prod --new-month" "$(next 26.10.2-dev.4 prod --new-month)" "26.11.0"
if MDO_CURRENT_VERSION="26.10.0" "${release}" --print-next prod >/dev/null 2>&1; then
  fail "prod from a plain release must fail"
fi
pass "prod from a plain release fails"
if MDO_CURRENT_VERSION="nonsense" "${release}" --print-next dev >/dev/null 2>&1; then
  fail "invalid version must fail"
fi
pass "invalid version fails"

# --- 2. dry run on the real checkout ---------------------------------------
before="$(git -C "${root}" rev-parse HEAD)$(git -C "${root}" status --porcelain)"
cur="$(sed -n 's/^  "version": "\(.*\)",/\1/p' "${root}/package.json" | head -n 1)"
out="$("${release}" dev --dry-run 2>/dev/null)"
want="$(MDO_CURRENT_VERSION="${cur}" "${release}" --print-next dev)"
grep -qx "Version: ${want}" <<<"${out}" || fail "dev --dry-run did not print 'Version: ${want}'"
grep -q "git -C ${root} push -q --atomic" <<<"${out}" || fail "dev --dry-run did not list the atomic push"
pass "dev --dry-run prints ${want} and an atomic push"
# prod starts from a -dev.N version; on a release commit (main) use the next dev version.
pcur="${cur}"
[[ "${pcur}" == *-dev.* ]] || pcur="$(MDO_CURRENT_VERSION="${cur}" "${release}" --print-next dev)"
out="$(MDO_CURRENT_VERSION="${pcur}" "${release}" prod --dry-run 2>/dev/null)"
want="$(MDO_CURRENT_VERSION="${pcur}" "${release}" --print-next prod)"
grep -qx "Version: ${want}" <<<"${out}" || fail "prod --dry-run did not print 'Version: ${want}'"
grep -q "gh pr merge" <<<"${out}" || fail "prod --dry-run did not list the merge"
grep -q "CHANGELOG.md: \[Unreleased\] -> ## \[${want}\]" <<<"${out}" || fail "prod --dry-run did not list the CHANGELOG roll"
pass "prod --dry-run prints ${want}, the merge and the CHANGELOG roll"
out="$(MDO_CURRENT_VERSION="${pcur}" "${release}" prod --new-month --dry-run 2>/dev/null)"
grep -q '^Version: ' <<<"${out}" || fail "prod --new-month --dry-run printed no version"
pass "prod --new-month --dry-run"
err="$(MDO_CURRENT_VERSION=26.10.0-dev.3 MDO_NOW=26.11 "${release}" prod --dry-run 2>&1 >/dev/null)"
grep -q "Warnung: Release 26.10.0 trägt den Monat 26.10, heute ist 26.11" <<<"${err}" || fail "no warning for an old month: ${err}"
grep -q -- "--new-month" <<<"${err}" || fail "old-month warning does not mention --new-month"
pass "prod warns when the release carries an old month"
err="$(MDO_CURRENT_VERSION=26.11.0-dev.3 MDO_NOW=26.11 "${release}" prod --dry-run 2>&1 >/dev/null)"
if grep -q "trägt den Monat" <<<"${err}"; then fail "warned about the current month"; fi
pass "prod does not warn in the current month"
after="$(git -C "${root}" rev-parse HEAD)$(git -C "${root}" status --porcelain)"
expect_eq "dry runs leave the checkout untouched" "${after}" "${before}"

# --- 3. full flows in a throwaway repo -------------------------------------
fakebin="${tmp}/bin"
mkdir -p "${fakebin}"
cat >"${fakebin}/npm" <<'NPM'
#!/usr/bin/env bash
# Fake `npm version <v> --no-git-tag-version`: rewrites the version in package*.json
# (package-lock.json has two version lines, like the real one).
set -euo pipefail
[[ "$1" == "version" ]] || exit 1
for f in package.json package-lock.json; do
  [[ -f "${f}" ]] || continue
  sed -i.bak "s/^\([[:space:]]*\"version\": \"\)[^\"]*\(\",\{0,1\}\)$/\1$2\2/" "${f}"
  rm -f "${f}.bak"
done
exit 0
NPM
cat >"${fakebin}/gh" <<'GH'
#!/usr/bin/env bash
# Fake gh backed by the bare fake origin. State lives in FAKE_STATE:
#   <head>.base / <head>.state   PR base branch and state (OPEN, MERGED)
#   <head>.polls                 number of `pr checks --json` queries
#   fail-<head>                  `pr checks --watch` fails while this file exists
# FAKE_CHECKS_DELAY=N: the first N queries report no checks (GitHub registers them late);
# `--watch` before registration fails like the real gh ("no checks reported").
# FAKE_MERGE_NOOP: `pr merge --rebase` leaves the base unchanged.
# FAKE_HOTFIX_FILE=<file>: after a rebase-merge, a hotfix commit on the base rewrites it.
# FAKE_DEV_FILE=<file>: after a rebase-merge, someone else pushes a change of it to dev.
set -euo pipefail
bare="${FAKE_ORIGIN}"
state="${FAKE_STATE}"
echo "gh $*" >>"${state}/gh.log"
sub="$1 $2"
shift 2
pos=() repo="" head="" base="" json="" watch=0 method=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -R | --repo) repo="$2"; shift ;;
    --head) head="$2"; shift ;;
    --base) base="$2"; shift ;;
    --title | --body | --jq) shift ;;
    --json) json="$2"; shift ;;
    --watch) watch=1 ;;
    --rebase) method=rebase ;;
    --merge) method=merge ;;
    --fail-fast | --delete-branch) ;;
    -*) echo "fake gh: unknown flag $1" >&2; exit 1 ;;
    *) pos+=("$1") ;;
  esac
  shift
done
[[ "${sub}" == "auth status" ]] && exit 0
[[ "${repo}" == "${FAKE_REPO}" ]] || { echo "fake gh: expected -R ${FAKE_REPO}, got '${repo}'" >&2; exit 1; }
key() { echo "$1" | tr / _; }

github_rebase() {
  local base="$1" head="$2" wt c
  local mb
  mb="$(git -C "${bare}" merge-base "refs/heads/${base}" "refs/heads/${head}")"
  if [[ -n "$(git -C "${bare}" rev-list --merges "${mb}..refs/heads/${head}")" ]]; then
    echo "fake gh: merge commits in the PR, rebase would be unsafe" >&2
    exit 1
  fi
  [[ -z "${FAKE_MERGE_NOOP:-}" ]] || return 0
  wt="$(mktemp -d)"
  git clone -q "${bare}" "${wt}/w"
  git -C "${wt}/w" checkout -q "${base}"
  for c in $(git -C "${bare}" rev-list --reverse "${mb}..refs/heads/${head}"); do
    if ! GIT_COMMITTER_NAME=GitHub GIT_COMMITTER_EMAIL=noreply@github.com \
      git -C "${wt}/w" cherry-pick "${c}" >/dev/null 2>&1; then
      echo "fake gh: this branch cannot be rebased due to conflicts" >&2
      rm -rf "${wt}"
      exit 1
    fi
  done
  if [[ -n "${FAKE_HOTFIX_FILE:-}" ]]; then
    echo hotfix >"${wt}/w/${FAKE_HOTFIX_FILE}"
    git -C "${wt}/w" commit -q -am "fix: hotfix on ${base}"
  fi
  git -C "${wt}/w" push -q origin "HEAD:refs/heads/${base}"
  if [[ -n "${FAKE_DEV_FILE:-}" ]]; then
    git -C "${wt}/w" checkout -q dev
    echo "dev later" >"${wt}/w/${FAKE_DEV_FILE}"
    git -C "${wt}/w" commit -q -am "fix: concurrent change on dev"
    git -C "${wt}/w" push -q origin dev
  fi
  rm -rf "${wt}"
}

case "${sub}" in
  "pr create")
    k="$(key "${head}")"
    if [[ "$(cat "${state}/${k}.state" 2>/dev/null)" == OPEN ]]; then
      echo "fake gh: a pull request for ${head} already exists" >&2
      exit 1
    fi
    echo "${base}" >"${state}/${k}.base"
    echo OPEN >"${state}/${k}.state"
    echo 0 >"${state}/${k}.polls"
    echo "https://example.invalid/pr/${k}"
    ;;
  "pr view")
    f="${state}/$(key "${pos[0]}").state"
    [[ -f "${f}" ]] || { echo "no pull requests found for branch \"${pos[0]}\"" >&2; exit 1; }
    # GitHub closes an open PR whose head branch was deleted.
    if [[ "$(cat "${f}")" == OPEN ]] && ! git -C "${bare}" rev-parse -q --verify "refs/heads/${pos[0]}" >/dev/null; then
      echo CLOSED >"${f}"
    fi
    cat "${f}"
    ;;
  "pr checks")
    k="$(key "${pos[0]}")"
    polls="$(cat "${state}/${k}.polls")"
    if ((polls < ${FAKE_CHECKS_DELAY:-0})); then
      [[ "${watch}" -eq 1 ]] || echo $((polls + 1)) >"${state}/${k}.polls"
      echo "no checks reported on the '${pos[0]}' branch" >&2
      exit 1
    fi
    if [[ "${watch}" -eq 1 ]]; then
      [[ ! -f "${state}/fail-${k}" ]] || { echo "X ci"; exit 1; }
      echo "ok ci"
    else
      [[ "${json}" == name ]] || exit 1
      echo 1
    fi
    ;;
  "pr merge")
    h="${pos[0]}"
    k="$(key "${h}")"
    [[ "$(cat "${state}/${k}.state")" == OPEN ]] || { echo "fake gh: PR not open" >&2; exit 1; }
    b="$(cat "${state}/${k}.base")"
    if [[ "${method}" == rebase ]]; then
      github_rebase "${b}" "${h}"
    else
      tree="$(git -C "${bare}" merge-tree --write-tree "refs/heads/${b}" "refs/heads/${h}")" ||
        { echo "fake gh: pull request is not mergeable" >&2; exit 1; }
      c="$(git -C "${bare}" commit-tree "${tree}" -p "refs/heads/${b}" -p "refs/heads/${h}" -m "Merge ${h}")"
      git -C "${bare}" update-ref "refs/heads/${b}" "${c}"
    fi
    echo MERGED >"${state}/${k}.state"
    git -C "${bare}" update-ref -d "refs/heads/${h}"
    ;;
  *) echo "fake gh: unsupported: ${sub} $*" >&2; exit 1 ;;
esac
GH
chmod +x "${fakebin}/npm" "${fakebin}/gh"

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=jcmx9 GIT_AUTHOR_EMAIL=jcmx9@users.noreply.github.com
export GIT_COMMITTER_NAME=jcmx9 GIT_COMMITTER_EMAIL=jcmx9@users.noreply.github.com
export FAKE_ORIGIN="${tmp}/origin.git" FAKE_STATE="${tmp}/state" FAKE_REPO="jcmx9/fake"
export MDO_GH_REPO="${FAKE_REPO}" MDO_POLL_INTERVAL=0 MDO_TODAY=2026-10-15 MDO_NOW=26.10
work="${tmp}/work"

setup_repo() {
  rm -rf "${FAKE_ORIGIN}" "${work}" "${FAKE_STATE}"
  mkdir -p "${FAKE_STATE}"
  git init -q --bare -b main "${FAKE_ORIGIN}"
  git init -q -b main "${work}"
  mkdir -p "${work}/scripts"
  cp "${release}" "${work}/scripts/release.sh"
  printf '{\n  "name": "x",\n  "version": "26.10.0-dev.0",\n  "private": true\n}\n' >"${work}/package.json"
  printf '{\n  "name": "x",\n  "version": "26.10.0-dev.0",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "26.10.0-dev.0"\n    }\n  }\n}\n' >"${work}/package-lock.json"
  printf '# Changelog\n\n## [Unreleased]\n\n### Added\n- first\n' >"${work}/CHANGELOG.md"
  printf '# x\n\n**Version:** 26.10.0-dev.0 · [English](README.en.md)\n\nText\n' >"${work}/README.md"
  printf '# x\n\n**Version:** 26.10.0-dev.0 · [Deutsch](README.md)\n\nText\n' >"${work}/README.en.md"
  echo base >"${work}/a.txt"
  # Hooks that add attribution trailers: release.sh must bypass them.
  cat >"${work}/.git/hooks/prepare-commit-msg" <<'HOOK'
#!/bin/sh
printf '\nCo-authored-by: Bot <bot@example.invalid>\n' >>"$1"
HOOK
  cat >"${work}/.git/hooks/commit-msg" <<'HOOK'
#!/bin/sh
printf 'Signed-off-by: Bot <bot@example.invalid>\n' >>"$1"
HOOK
  chmod +x "${work}/.git/hooks/prepare-commit-msg" "${work}/.git/hooks/commit-msg"
  git -C "${work}" add -A
  git -C "${work}" commit -q -m init
  git -C "${work}" remote add origin "${FAKE_ORIGIN}"
  git -C "${work}" push -q origin main
  git -C "${work}" checkout -q -b dev
  git -C "${work}" push -q origin dev
}

# A feature commit on dev, pushed (what a squash-merged feature PR leaves on dev).
dev_commit() {
  local file="$1" content="$2"
  echo "${content}" >"${work}/${file}"
  git -C "${work}" add -A
  git -C "${work}" commit -q -m "feat: ${file}"
  git -C "${work}" push -q origin dev
}

# A hotfix committed directly to origin/main.
main_hotfix() {
  local file="$1" content="$2" hf="${tmp}/hotfix"
  rm -rf "${hf}"
  git clone -q -b main "${FAKE_ORIGIN}" "${hf}"
  echo "${content}" >"${hf}/${file}"
  git -C "${hf}" -c core.hooksPath=/dev/null commit -q -am "fix: hotfix ${file}"
  git -C "${hf}" push -q origin main
  rm -rf "${hf}"
}

# Commits release.sh made carry no attribution trailers; release commits exactly one
# Release-Source trailer; the author is the configured one.
expect_plain_script_commits() {
  local label="$1" sha subject trailers
  while IFS=$'\t' read -r sha subject; do
    case "${subject}" in
      "release: "* | "chore(release): back-merge "*) ;;
      *) continue ;;
    esac
    trailers="$(git -C "${FAKE_ORIGIN}" log -1 --format='%(trailers:unfold)' "${sha}" | sed '/^$/d')"
    if [[ "${subject}" == release:\ [0-9]*.[0-9]*.[0-9]* && "${subject}" != *-dev.* ]]; then
      [[ "${trailers}" =~ ^Release-Source:\ [0-9a-f]{40}$ ]] || fail "${label}: '${subject}' trailers: ${trailers}"
    else
      [[ -z "${trailers}" ]] || fail "${label}: '${subject}' has trailers: ${trailers}"
    fi
    [[ "$(git -C "${FAKE_ORIGIN}" log -1 --format=%an "${sha}")" == jcmx9 ]] || fail "${label}: '${subject}' author"
  done < <(git -C "${FAKE_ORIGIN}" log --format=$'%H\t%s' main dev)
  pass "${label}: script commits have no Co-authored-by/Signed-off-by, only Release-Source"
}

readme_version() {
  git -C "$1" show "$2:$3" | sed -n 's/^\*\*Version:\*\* \([^ ]*\) .*/\1/p'
}

pkg_version() {
  git -C "$1" show "$2:package.json" | sed -n 's/^  "version": "\(.*\)",/\1/p'
}

lock_versions() {
  git -C "$1" show "$2:package-lock.json" | sed -n 's/^ *"version": "\(.*\)",*$/\1/p' | sort -u | tr '\n' ' '
}

# Started from outside the repo: release.sh must not depend on the caller's directory.
run_release() {
  (cd "${tmp}" && PATH="${fakebin}:${PATH}" "${work}/scripts/release.sh" "$@")
}

run_code() {
  set +e
  run_release "$@" >"${tmp}/out.txt" 2>&1
  code=$?
  set -e
}

expect_local_clean_dev() {
  expect_eq "$1: local branch is dev" "$(git -C "${work}" rev-parse --abbrev-ref HEAD)" "dev"
  expect_eq "$1: working tree clean" "$(git -C "${work}" status --porcelain)" ""
}

# Main must never contain merge commits (rebase-merges only).
expect_linear_main() {
  expect_eq "$1: main is linear" "$(git -C "${FAKE_ORIGIN}" rev-list --merges main | wc -l | tr -d ' ')" "0"
}

expect_released() {
  local label="$1" version="$2" next_dev="$3"
  expect_eq "${label}: main has ${version}" "$(pkg_version "${FAKE_ORIGIN}" main)" "${version}"
  expect_eq "${label}: main lock file has ${version}" "$(lock_versions "${FAKE_ORIGIN}" main)" "${version} "
  expect_eq "${label}: tag v${version} points at main" \
    "$(git -C "${FAKE_ORIGIN}" rev-parse "v${version}^{commit}")" "$(git -C "${FAKE_ORIGIN}" rev-parse main)"
  expect_eq "${label}: dev continues at ${next_dev}" "$(pkg_version "${FAKE_ORIGIN}" dev)" "${next_dev}"
  expect_eq "${label}: dev lock file at ${next_dev}" "$(lock_versions "${FAKE_ORIGIN}" dev)" "${next_dev} "
  local readme
  for readme in README.md README.en.md; do
    expect_eq "${label}: main ${readme} shows ${version}" "$(readme_version "${FAKE_ORIGIN}" main "${readme}")" "${version}"
    expect_eq "${label}: dev ${readme} shows ${next_dev}" "$(readme_version "${FAKE_ORIGIN}" dev "${readme}")" "${next_dev}"
  done
  git -C "${FAKE_ORIGIN}" merge-base --is-ancestor main dev || fail "${label}: main not merged back into dev"
  pass "${label}: main merged back into dev"
  expect_eq "${label}: main was rewritten by the rebase-merge" \
    "$(git -C "${FAKE_ORIGIN}" log -1 --format=%cn main)" "GitHub"
  expect_eq "${label}: release branch deleted" \
    "$(git -C "${FAKE_ORIGIN}" for-each-ref --format=x "refs/heads/release/${version}")" ""
  expect_eq "${label}: back-merge branch deleted" \
    "$(git -C "${FAKE_ORIGIN}" for-each-ref --format=x "refs/heads/chore/back-merge-${version}")" ""
  expect_linear_main "${label}"
  # Apart from the version lines, main and dev hold the same files.
  local diff
  diff="$(git -C "${FAKE_ORIGIN}" diff -U0 main dev | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | grep -v '"version"' | grep -v '^[+-]\*\*Version:\*\* ' || true)"
  expect_eq "${label}: main and dev differ only in the version" "${diff}" ""
  expect_local_clean_dev "${label}"
  expect_eq "${label}: local dev equals origin/dev" "$(git -C "${work}" rev-parse dev)" "$(git -C "${FAKE_ORIGIN}" rev-parse dev)"
}

# 3a. dev, prod, dev, prod, prod --new-month ---------------------------------
setup_repo
run_release dev >/dev/null
expect_eq "dev: package.json bumped on origin/dev" "$(pkg_version "${FAKE_ORIGIN}" dev)" "26.10.0-dev.1"
expect_eq "dev: lock file bumped (both lines)" "$(lock_versions "${FAKE_ORIGIN}" dev)" "26.10.0-dev.1 "
expect_eq "dev: README version line bumped" "$(readme_version "${FAKE_ORIGIN}" dev README.md)" "26.10.0-dev.1"
expect_eq "dev: README.en version line bumped" "$(readme_version "${FAKE_ORIGIN}" dev README.en.md)" "26.10.0-dev.1"
git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0-dev.1 >/dev/null || fail "dev: tag not pushed"
pass "dev: tag v26.10.0-dev.1 pushed"
expect_eq "dev: commit message" "$(git -C "${FAKE_ORIGIN}" log -1 --format=%s dev)" "release: 26.10.0-dev.1"
run_release dev >/dev/null 2>&1
expect_eq "dev: second run bumps again" "$(pkg_version "${FAKE_ORIGIN}" dev)" "26.10.0-dev.2"

# precondition failures
echo dirty >"${work}/dirty.txt"
run_code dev
expect_eq "dirty tree exit code" "${code}" "4"
rm "${work}/dirty.txt"
git -C "${work}" checkout -q -b other
run_code dev
expect_eq "wrong branch exit code" "${code}" "3"
run_code prod --dry-run
expect_eq "dry run on the wrong branch still succeeds" "${code}" "0"
grep -q "Warnung: Release nur auf dem Branch 'dev'" "${tmp}/out.txt" || fail "dry run did not warn about the branch"
pass "dry run reports the wrong branch as a warning"
git -C "${work}" checkout -q dev
git -C "${work}" branch -q -D other
git -C "${work}" remote add gh git@github.com:jcmx9/MarkdownOffice.git
out="$(cd "${tmp}" && env -u MDO_GH_REPO MDO_REMOTE=gh PATH="${fakebin}:${PATH}" "${work}/scripts/release.sh" prod --dry-run 2>/dev/null)"
grep -q "gh pr merge release/26.10.0 -R jcmx9/MarkdownOffice --rebase" <<<"${out}" || fail "gh -R not derived from the remote URL"
pass "gh -R owner/repo derived from the remote URL"
git -C "${work}" remote remove gh

dev_commit b.txt "feature b"
FAKE_CHECKS_DELAY=2 run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "prod (cycle 1) failed"; }
expect_released "prod cycle 1" "26.10.0" "26.10.1-dev.0"
expect_eq "prod cycle 1: checks were polled until registered" \
  "$(grep -c 'gh pr checks release/26.10.0 -R jcmx9/fake --json name' "${FAKE_STATE}/gh.log")" "3"
if grep -v -- '-R jcmx9/fake' "${FAKE_STATE}/gh.log" | grep -qv 'auth status'; then fail "a gh call ran without -R"; fi
pass "every gh call uses -R"
git -C "${FAKE_ORIGIN}" show main:CHANGELOG.md | grep -qx '## \[26.10.0\] - 2026-10-15' || fail "CHANGELOG not rolled on main"
git -C "${FAKE_ORIGIN}" show main:CHANGELOG.md | grep -qx '## \[Unreleased\]' || fail "CHANGELOG lost [Unreleased]"
pass "prod cycle 1: CHANGELOG rolled ([Unreleased] kept, [26.10.0] added)"
git -C "${FAKE_ORIGIN}" log -1 --format=%B main | grep -q '^Release-Source: ' || fail "release commit has no Release-Source"
pass "prod cycle 1: release commit records its dev source"

# dev cycle in between, plus a feature and a CHANGELOG entry
run_release dev >/dev/null
expect_eq "dev between releases" "$(pkg_version "${FAKE_ORIGIN}" dev)" "26.10.1-dev.1"
dev_commit c.txt "feature c"
awk '{ print } $0 == "## [Unreleased]" { print ""; print "### Fixed"; print "- second" }' "${work}/CHANGELOG.md" >"${tmp}/cl"
cp "${tmp}/cl" "${work}/CHANGELOG.md"
git -C "${work}" commit -q -am "docs: changelog"
git -C "${work}" push -q origin dev

run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "prod (cycle 2) failed"; }
expect_released "prod cycle 2" "26.10.1" "26.10.2-dev.0"
git -C "${FAKE_ORIGIN}" show main:c.txt >/dev/null 2>&1 || fail "prod cycle 2: feature c missing on main"
pass "prod cycle 2: new feature reached main"
expect_eq "prod cycle 2: one snapshot commit per release on main" \
  "$(git -C "${FAKE_ORIGIN}" log --format=%s main | tr '\n' '|')" "release: 26.10.1|release: 26.10.0|init|"
git -C "${FAKE_ORIGIN}" show main:CHANGELOG.md | grep -qx '## \[26.10.1\] - 2026-10-15' || fail "cycle 2 CHANGELOG not rolled"
pass "prod cycle 2: CHANGELOG rolled"

# the version on dev is 26.10.2-dev.0; a release in November uses --new-month
dev_commit d.txt "feature d"
MDO_NOW=26.11 run_release prod --new-month >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "prod --new-month (cycle 3) failed"; }
expect_released "prod cycle 3 (--new-month)" "26.11.0" "26.11.1-dev.0"
expect_eq "prod cycle 3: main holds only release commits" \
  "$(git -C "${FAKE_ORIGIN}" rev-list --count main)" "4"
expect_plain_script_commits "3 prod cycles"

# 3b2. a stale release branch (dev moved after failed checks) is not reused --------
setup_repo
touch "${FAKE_STATE}/fail-release_26.10.0"
run_code prod
expect_eq "stale branch: failed checks exit code" "${code}" "9"
rm "${FAKE_STATE}/fail-release_26.10.0"
dev_commit fix.txt "the fix"
run_code prod
expect_eq "stale branch: rerun stops (exit code)" "${code}" "9"
grep -q "git push origin --delete release/26.10.0 && scripts/release.sh prod" "${tmp}/out.txt" ||
  fail "stale branch: no delete/rebuild command: $(cat "${tmp}/out.txt")"
pass "stale branch: rerun names the delete/rebuild command"
git -C "${work}" push -q origin --delete release/26.10.0
run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "rebuilt release failed"; }
expect_released "stale branch rebuilt" "26.10.0" "26.10.1-dev.0"
expect_eq "stale branch rebuilt: the fix is released" "$(git -C "${FAKE_ORIGIN}" show main:fix.txt)" "the fix"

# 3b. resume after failed release checks ------------------------------------
setup_repo
dev_commit b.txt "feature b"
touch "${FAKE_STATE}/fail-release_26.10.0"
run_code prod
expect_eq "resume: failed release checks exit code" "${code}" "9"
expect_local_clean_dev "resume: after failed checks"
git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/heads/release/26.10.0 >/dev/null || fail "release branch was not pushed"
if git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0 >/dev/null; then fail "tag pushed despite failed checks"; fi
pass "resume: no tag after failed checks"
rm "${FAKE_STATE}/fail-release_26.10.0"
run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "resumed prod failed"; }
grep -q "origin/release/26.10.0 existiert bereits (Stand origin/dev) und wird weiterverwendet" "${tmp}/out.txt" || fail "resume did not report the existing branch"
grep -q "PR release/26.10.0 -> main existiert bereits" "${tmp}/out.txt" || fail "resume did not report the open PR"
pass "resume: existing branch and PR are reused"
expect_released "resume (release checks)" "26.10.0" "26.10.1-dev.0"

# 3c. resume after failed back-merge checks ---------------------------------
setup_repo
touch "${FAKE_STATE}/fail-chore_back-merge-26.10.0"
run_code prod
expect_eq "resume: failed back-merge checks exit code" "${code}" "9"
git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0 >/dev/null || fail "tag missing before back-merge"
rm "${FAKE_STATE}/fail-chore_back-merge-26.10.0"
run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "resumed back-merge failed"; }
grep -q "v26.10.0 ist bereits veröffentlicht" "${tmp}/out.txt" || fail "resume did not detect the published tag"
grep -q "origin/chore/back-merge-26.10.0 existiert bereits" "${tmp}/out.txt" || fail "resume did not reuse the back-merge branch"
pass "resume: published tag and back-merge branch detected"
expect_released "resume (back-merge checks)" "26.10.0" "26.10.1-dev.0"
run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "prod right after a finished release failed"; }
expect_released "next release after resume" "26.10.1" "26.10.2-dev.0"

# 3d. a hotfix on main flows back into dev -----------------------------------
setup_repo
dev_commit a.txt "dev"
FAKE_HOTFIX_FILE=a.txt run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "prod with a hotfix on main failed"; }
expect_eq "hotfix on main: dev gets it" "$(git -C "${FAKE_ORIGIN}" show dev:a.txt)" "hotfix"
expect_eq "hotfix on main: dev continues" "$(pkg_version "${FAKE_ORIGIN}" dev)" "26.10.1-dev.0"
expect_local_clean_dev "hotfix on main"

# 3e. back-merge with a real conflict aborts cleanly -------------------------
setup_repo
dev_commit a.txt "dev"
FAKE_HOTFIX_FILE=a.txt FAKE_DEV_FILE=a.txt run_code prod
expect_eq "back-merge conflict exit code" "${code}" "10"
grep -q "Konflikte außerhalb der Versionszeilen (a.txt)" "${tmp}/out.txt" || fail "conflict message does not name a.txt: $(cat "${tmp}/out.txt")"
pass "back-merge conflict names the file"
git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0 >/dev/null || fail "release tag missing"
expect_eq "back-merge conflict: nothing pushed to origin/dev" \
  "$(git -C "${FAKE_ORIGIN}" log -1 --format=%s dev)" "fix: concurrent change on dev"
expect_eq "back-merge conflict: no remote back-merge branch" \
  "$(git -C "${FAKE_ORIGIN}" for-each-ref --format=x refs/heads/chore/)" ""
expect_eq "back-merge conflict: no local back-merge branch" \
  "$(git -C "${work}" for-each-ref --format=x refs/heads/chore/)" ""
[[ ! -f "${work}/.git/MERGE_HEAD" ]] || fail "merge left in progress"
expect_local_clean_dev "back-merge conflict"

# N1 case A: the documented manual back-merge, then the next release is clean.
git -C "${work}" pull -q --ff-only origin dev
git -C "${work}" checkout -q -b chore/back-merge-26.10.0 origin/dev
git -C "${work}" merge -q --no-ff origin/main >/dev/null 2>&1 || true
echo resolved >"${work}/a.txt"
(cd "${work}" && PATH="${fakebin}:${PATH}" npm version 26.10.1-dev.0 --no-git-tag-version --allow-same-version)
git -C "${work}" add -A
git -C "${work}" commit -q --no-edit
git -C "${work}" checkout -q dev
git -C "${work}" merge -q --no-ff --no-edit chore/back-merge-26.10.0
git -C "${work}" branch -q -D chore/back-merge-26.10.0
git -C "${work}" push -q origin dev
dev_commit e.txt "feature e"
run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "N1 A: release after manual back-merge failed"; }
expect_released "N1 A (after manual back-merge)" "26.10.1" "26.10.2-dev.0"
expect_eq "N1 A: resolution is on main" "$(git -C "${FAKE_ORIGIN}" show main:a.txt)" "resolved"

# N1 case B: a hotfix committed to main and, separately, to dev.
setup_repo
run_release prod >/dev/null 2>&1 || fail "N1 B: first release failed"
dev_commit a.txt "dev"
main_hotfix a.txt "hotfix"
dev_commit a.txt "hotfix"
run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "N1 B: release after hotfix in main and dev failed"; }
expect_released "N1 B (hotfix in main and dev)" "26.10.1" "26.10.2-dev.0"
expect_eq "N1 B: hotfix on main" "$(git -C "${FAKE_ORIGIN}" show main:a.txt)" "hotfix"

# N1 case B2: a hotfix only on main stops the release (exit 10, nothing pushed); after
# merging main into dev as the message says, it releases cleanly.
setup_repo
run_release prod >/dev/null 2>&1 || fail "N1 B2: first release failed"
dev_commit a.txt "dev"
main_hotfix a.txt "hotfix"
main_before="$(git -C "${FAKE_ORIGIN}" rev-parse main)"
run_code prod
expect_eq "N1 B2: main not in dev (exit code)" "${code}" "10"
grep -q "origin/main enthält Änderungen, die nicht in origin/dev sind" "${tmp}/out.txt" || fail "N1 B2: message: $(cat "${tmp}/out.txt")"
expect_eq "N1 B2: main untouched" "$(git -C "${FAKE_ORIGIN}" rev-parse main)" "${main_before}"
expect_eq "N1 B2: no release branch pushed" "$(git -C "${FAKE_ORIGIN}" for-each-ref --format=x refs/heads/release/)" ""
expect_local_clean_dev "N1 B2 abort"
git -C "${work}" fetch -q origin
git -C "${work}" merge -q --no-ff origin/main >/dev/null 2>&1 || true
echo merged >"${work}/a.txt"
git -C "${work}" add -A
git -C "${work}" commit -q --no-edit
git -C "${work}" push -q origin dev
run_release prod >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "N1 B2: release after merging main into dev failed"; }
expect_released "N1 B2 (main merged into dev)" "26.10.1" "26.10.2-dev.0"
expect_eq "N1 B2: merged content on main" "$(git -C "${FAKE_ORIGIN}" show main:a.txt)" "merged"

# 3f. a wrong version on main aborts before tagging --------------------------
setup_repo
FAKE_MERGE_NOOP=1 run_code prod
expect_eq "prod: wrong version on main aborts (exit code)" "${code}" "8"
if git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0 >/dev/null; then
  fail "prod: tag must not exist after failed verification"
fi
pass "prod: no tag after failed verification"

# 3g. dev push is atomic and resumable ---------------------------------------
setup_repo
cat >"${FAKE_ORIGIN}/hooks/update" <<'HOOK'
#!/usr/bin/env bash
# Reject updates of dev while the marker exists (protected branch / lost race).
if [[ "$1" == refs/heads/dev && -f "${FAKE_STATE}/reject-dev" ]]; then
  echo "dev is protected" >&2
  exit 1
fi
exit 0
HOOK
chmod +x "${FAKE_ORIGIN}/hooks/update"
touch "${FAKE_STATE}/reject-dev"
run_code dev
expect_eq "dev: rejected push exit code" "${code}" "9"
if git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0-dev.1 >/dev/null; then
  fail "dev: tag landed although dev was rejected (push not atomic)"
fi
pass "dev: rejected branch push publishes no tag (atomic)"
rm "${FAKE_STATE}/reject-dev"
run_release dev >"${tmp}/out.txt" 2>&1 || { cat "${tmp}/out.txt"; fail "dev resume failed"; }
grep -q "v26.10.0-dev.1 ist lokal fertig" "${tmp}/out.txt" || fail "dev resume not detected"
expect_eq "dev resume: version not bumped twice" "$(pkg_version "${FAKE_ORIGIN}" dev)" "26.10.0-dev.1"
git -C "${FAKE_ORIGIN}" rev-parse -q --verify refs/tags/v26.10.0-dev.1 >/dev/null || fail "dev resume: tag missing"
pass "dev resume: commit and tag pushed"

# --- 4. release notes from CHANGELOG.md --------------------------------------
notes="${root}/scripts/release-notes.sh"
printf '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- next\n\n## [26.10.0] - 2026-10-15\n\n### Added\n- a\n- b\n\n## [25.1.0] - 2025-01-01\n\n- old\n' >"${tmp}/CHANGELOG.md"
expect_eq "notes: release section" "$("${notes}" 26.10.0 "${tmp}/CHANGELOG.md")" $'### Added\n- a\n- b'
expect_eq "notes: pre-release uses [Unreleased]" "$("${notes}" 26.10.1-dev.3 "${tmp}/CHANGELOG.md")" $'### Fixed\n- next'
expect_eq "notes: last section" "$("${notes}" 25.1.0 "${tmp}/CHANGELOG.md")" "- old"
expect_eq "notes: missing section" "$("${notes}" 9.9.9 "${tmp}/CHANGELOG.md")" "Release 9.9.9"

# --- 5. released CHANGELOG sections stay as tagged ---------------------------
cl="${tmp}/cl-repo"
rm -rf "${cl}"
git init -q -b main "${cl}"
mkdir -p "${cl}/scripts"
cp "${root}/scripts/check-changelog.sh" "${root}/scripts/release-notes.sh" "${cl}/scripts/"
printf '# Changelog\n\n## [Unreleased]\n\n## [26.10.0] - 2026-10-15\n\n### Added\n- a\n' >"${cl}/CHANGELOG.md"
git -C "${cl}" add -A
git -C "${cl}" -c core.hooksPath=/dev/null commit -q -m "release: 26.10.0"
git -C "${cl}" tag v26.10.0
check() { (cd "${cl}" && scripts/check-changelog.sh >/dev/null 2>&1); }
check || fail "changelog: unchanged history refused"
pass "changelog: unchanged released section passes"
printf '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- new\n\n## [26.10.0] - 2026-10-15\n\n### Added\n- a\n' >"${cl}/CHANGELOG.md"
check || fail "changelog: a new entry under [Unreleased] refused"
pass "changelog: new entries under [Unreleased] pass"
printf '# Changelog\n\n## [Unreleased]\n\n## [26.10.0] - 2026-10-15\n\n### Added\n- a\n- late\n' >"${cl}/CHANGELOG.md"
if check; then fail "changelog: an entry added to a released section was accepted"; fi
pass "changelog: an entry added to a released section fails"
printf '# Changelog\n\n## [Unreleased]\n\n## [26.10.1] - 2026-10-20\n\n- next\n\n## [26.10.0] - 2026-10-15\n\n### Added\n- a\n' >"${cl}/CHANGELOG.md"
check || fail "changelog: an untagged release section refused"
pass "changelog: a section without a tag yet (release PR) passes"

echo "All release tests passed."
