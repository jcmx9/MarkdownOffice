#!/usr/bin/env bash
# End-to-end check of scripts/bootstrap.sh against a locally built archive (CI job `bootstrap`).
#
#   scripts/test-bootstrap.sh [archive]
#
# Default archive: dist/markdown-office-<version>-mac-<arch>.zip (macOS) or
# dist/markdown-office-<version>-linux-x86_64.AppImage (Linux), as built by `npm run dist`.
# Everything happens below a temp dir with its own HOME: the runner's (or developer's)
# real ~/Applications, ~/.local/bin and ~/.local/share are never touched. The download
# path runs against a fake `curl` that serves fixtures, so no network is needed.
# On Linux the bootstrap extracts the AppImage (no FUSE needed); the pipeline CLI needs no
# display, but `markdown-office --app --version` starts the app and needs one, e.g. xvfb-run.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bootstrap="${root}/scripts/bootstrap.sh"
version="$(node -p "require('${root}/package.json').version")"
typst_version="$(node -p "require('${root}/scripts/pipeline-assets.json').typst.version")"
os="$(uname -s)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "ok   $*"
}

default_archive() {
  case "${os}" in
    Darwin)
      local arch
      arch="$(uname -m)"
      [[ "${arch}" == "x86_64" ]] && arch="x64"
      echo "${root}/dist/markdown-office-${version}-mac-${arch}.zip"
      ;;
    Linux) echo "${root}/dist/markdown-office-${version}-linux-x86_64.AppImage" ;;
    *) fail "unsupported OS ${os}" ;;
  esac
}

archive="${1:-$(default_archive)}"
[[ -f "${archive}" ]] || fail "archive not found: ${archive}"
archive="$(cd "$(dirname "${archive}")" && pwd)/$(basename "${archive}")"

work="$(mktemp -d "${TMPDIR:-/tmp}/mdo-bootstrap-test.XXXXXX")"
cleanup() {
  rm -rf "${work}"
}
trap cleanup EXIT

# Isolated profile: HOME, XDG and the install folder all live in the temp dir.
export HOME="${work}/home"
mkdir -p "${HOME}"
unset XDG_DATA_HOME
# The PDF viewer must not open during the conversion check.
export MDO_NO_OPEN=1
# With spaces, like "Markdown Office.app" itself: every path in the command must stay quoted.
export MDO_HOME="${work}/my apps"

command_path="${HOME}/.local/bin/markdown-office"
desktop_path="${HOME}/.local/share/applications/markdown-office.desktop"
case "${os}" in
  Darwin)
    install_dir="${MDO_HOME}/Markdown Office.app"
    app_exe="${install_dir}/Contents/MacOS/Markdown Office"
    # Outside the signed bundle; with MDO_HOME it sits next to the app.
    marker="${MDO_HOME}/.mdo-install"
    ;;
  Linux)
    # The extracted AppImage; the marker lives inside it.
    install_dir="${MDO_HOME}/app"
    app_exe="${install_dir}/markdown-office"
    marker="${install_dir}/.mdo-install"
    ;;
esac
old_dir="${install_dir}.old"

run_bootstrap() {
  bash "${bootstrap}" "$@" </dev/null
}

with_archive() {
  local file="$1"
  shift
  MDO_ARCHIVE="${file}" run_bootstrap "$@"
}

# Runs a command and checks its exit code and (optionally) a fixed string in its output.
expect_code() {
  local want="$1" pattern="$2" out code
  shift 2
  set +e
  out="$("$@" 2>&1)"
  code=$?
  set -e
  [[ "${code}" -eq "${want}" ]] || fail "'$*' exited ${code}, expected ${want}. Output: ${out}"
  if [[ -n "${pattern}" ]] && ! grep -qF -- "${pattern}" <<<"${out}"; then
    fail "'$*' output lacks '${pattern}'. Output: ${out}"
  fi
}

assert_installed() {
  [[ -f "${marker}" ]] || fail "marker missing: ${marker}"
  [[ -x "${command_path}" ]] || fail "command missing: ${command_path}"
  [[ "$(head -n 1 "${command_path}")" == "#!/bin/sh" ]] || fail "command is not a /bin/sh shim"
  grep -qF 'launch.log' "${command_path}" || fail "command does not name the launch log"
  grep -qF 'ELECTRON_RUN_AS_NODE=1 exec' "${command_path}" || fail "command does not run cli.js as Node"
  if [[ "${os}" == "Darwin" ]]; then
    [[ "$(cat "${marker}")" == "${install_dir}" ]] || fail "marker does not name ${install_dir}"
    [[ -z "$(find "${install_dir}" -name '.mdo-install')" ]] || fail "marker written into the app bundle"
    codesign --verify --deep --strict "${install_dir}" || fail "code seal of the installed app is broken"
    codesign --verify --strict "${install_dir}/Contents/Resources/pipeline/bin/typst" ||
      fail "bundled typst is not signed"
  else
    [[ -x "${app_exe}" ]] || fail "extracted executable missing"
    [[ -z "$(find "${MDO_HOME}" -name '*.AppImage')" ]] || fail "AppImage file kept after extraction"
    grep -qF 'LD_LIBRARY_PATH' "${command_path}" || fail "command does not set the bundled library path"
    [[ -f "${desktop_path}" ]] || fail ".desktop entry missing"
    grep -q '^MimeType=text/markdown;$' "${desktop_path}" || fail ".desktop lacks MimeType"
    grep -qxF "Exec=\"${command_path}\" --app %F" "${desktop_path}" || fail ".desktop Exec line"
    if grep -q '^Icon=' "${desktop_path}"; then
      [[ -f "${install_dir}/markdown-office.png" ]] || fail ".desktop Icon without icon file"
    fi
  fi
  local out
  out="$("${command_path}" --version)"
  [[ "$(head -n 1 <<<"${out}")" == "markdown-office ${version}" ]] ||
    fail "--version printed '${out}', expected 'markdown-office ${version}' first"
  grep -q "^typst ${typst_version//./\\.} " <<<"${out}" ||
    fail "--version lacks 'typst ${typst_version}': ${out}"
  [[ -z "$(find "$(dirname "${install_dir}")" -maxdepth 1 \( -name '*.old' -o -name '.*-new.*' \))" ]] ||
    fail "leftover staging/.old folders next to ${install_dir}"
}

# The installed command end to end: a PDF from a note in a folder with spaces (options and
# paths pass through unchanged), and --app reaching the editor binary (--version waits).
assert_command_works() {
  local notes="${work}/Meine Notizen" out
  mkdir -p "${notes}"
  printf -- '---\ntitle: Test\n---\n\n# Hallo\n\nText.\n' >"${notes}/Notiz mit Leerzeichen.md"
  (cd "${notes}" && "${command_path}" --no-source --template memo \
    "Notiz mit Leerzeichen.md" "${notes}/Ergebnis mit Leerzeichen.pdf") >/dev/null ||
    fail "markdown-office could not convert a note"
  [[ "$(head -c 5 "${notes}/Ergebnis mit Leerzeichen.pdf")" == "%PDF-" ]] || fail "no PDF written"
  out="$("${command_path}" --app --version)"
  [[ "${out}" == "Markdown Office ${version}" ]] ||
    fail "--app --version printed '${out}', expected 'Markdown Office ${version}'"
  rm -rf "${notes}"
}

# An install leftover (<install>.old) that the bootstrap must recognise as its own.
make_owned_old() {
  mkdir -p "${old_dir}"
  if [[ "${os}" == "Darwin" ]]; then
    mkdir -p "${old_dir}/Contents"
    /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string io.github.jcmx9.markdownoffice" \
      "${old_dir}/Contents/Info.plist" >/dev/null
  else
    touch "${old_dir}/.mdo-install"
    printf '\177ELF' >"${old_dir}/markdown-office"
    chmod +x "${old_dir}/markdown-office"
  fi
}

# 1. Usage errors exit 2 and change nothing.
expect_code 2 "unbekannte Option" run_bootstrap --bogus
expect_code 2 "Ungültige Version" run_bootstrap --version 1.2
expect_code 2 "Ungültige Version" run_bootstrap --version '26.10.0;x'
expect_code 2 "schließen sich aus" run_bootstrap --pre --version 26.10.0
[[ ! -e "${install_dir}" ]] || fail "usage errors created ${install_dir}"
pass "usage errors (unknown option, bad --version, --pre with --version) -> exit 2"

# 2. Fresh install from the local archive.
with_archive "${archive}"
assert_installed
pass "install: marker, command, markdown-office --version = ${version} + typst ${typst_version}"
assert_command_works
pass "command: PDF from a note in a folder with spaces; --app --version reaches the editor"

# 3. Update over an existing install, also with a trailing slash on MDO_HOME.
with_archive "${archive}"
assert_installed
MDO_HOME="${MDO_HOME}//" with_archive "${archive}"
assert_installed
pass "update over existing install (also MDO_HOME with trailing slash)"

# 4. A broken archive aborts before anything is replaced; the old install keeps working.
broken="${work}/broken-$(basename "${archive}")"
printf 'not an archive' >"${broken}"
expect_code 6 "" with_archive "${broken}"
assert_installed
pass "broken archive -> exit 6, old install intact"

# 5. Leftover .old: an own one is cleared on update, a foreign one stops the update.
make_owned_old
with_archive "${archive}"
assert_installed
mkdir -p "${old_dir}"
echo keep >"${old_dir}/keep.txt"
expect_code 1 "" with_archive "${archive}"
[[ -f "${old_dir}/keep.txt" ]] || fail "update deleted a foreign .old"
rm -rf "${old_dir}"
assert_installed
pass "leftover .old: own one removed on update, foreign one -> exit 1 and kept"

# 5b. macOS: update and uninstall refuse while Markdown Office runs (exit 12), nothing changes.
#     A `sleep` whose argv[0] is the app's executable stands in for the running app.
if [[ "${os}" == "Darwin" ]]; then
  bash -c 'exec -a "$0" sleep 120' "${app_exe}" &
  fake_app=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f -- "${app_exe}" >/dev/null && break
    sleep 0.2
  done
  inode="$(stat -f %i "${install_dir}")"
  expect_code 12 "läuft noch" with_archive "${archive}"
  expect_code 12 "läuft noch" run_bootstrap --uninstall
  [[ "$(stat -f %i "${install_dir}")" == "${inode}" ]] || fail "running app was replaced"
  kill "${fake_app}"
  wait "${fake_app}" 2>/dev/null || true
  assert_installed
  with_archive "${archive}"
  assert_installed
  pass "macOS: update/uninstall while Markdown Office runs -> exit 12, app untouched; works after quit"
fi

# 6. Download path against a fake GitHub: a stand-in `curl` first on PATH serves fixtures
#    keyed by URL (<key>, <key>.status, <key>.headers, <key>.offline).
fake="${work}/fake-gh"
mkdir -p "${fake}" "${work}/fakebin"
cat >"${work}/fakebin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
out="" url="" headers="" wfmt="" fail_on_http=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -D) headers="$2"; shift ;;
    -w) wfmt="$2"; shift ;;
    -H | --proto | --retry) shift ;;
    --*) ;;
    -*) [[ "$1" == *f* ]] && fail_on_http=1 ;;
    *) url="$1" ;;
  esac
  shift
done
echo "${url}" >>"${FAKE_GH}/requests.log"
key="${FAKE_GH}/$(printf '%s' "${url}" | tr '/:?=&' '_____')"
if [[ -f "${key}.offline" ]]; then
  echo "curl: (6) Could not resolve host: api.github.com" >&2
  exit 6
fi
status=200
if [[ -f "${key}.status" ]]; then
  status="$(cat "${key}.status")"
elif [[ ! -e "${key}" ]]; then
  status=404
fi
if [[ -n "${headers}" ]]; then
  if [[ -f "${key}.headers" ]]; then cp "${key}.headers" "${headers}"; else printf 'HTTP/2 %s\r\n\r\n' "${status}" >"${headers}"; fi
fi
if [[ "${status}" -ge 400 && "${fail_on_http}" -eq 1 ]]; then
  echo "curl: (22) The requested URL returned error: ${status}" >&2
  exit 22
fi
body='{"message": "Not Found"}'
if [[ -e "${key}" ]]; then
  if [[ -n "${out}" ]]; then cp "${key}" "${out}"; else cat "${key}"; fi
elif [[ -n "${out}" ]]; then
  printf '%s' "${body}" >"${out}"
else
  printf '%s' "${body}"
fi
if [[ -n "${wfmt}" ]]; then printf '%s' "${status}"; fi
EOF
chmod +x "${work}/fakebin/curl"
export FAKE_GH="${fake}"
api="https://api.github.com/repos/jcmx9/MarkdownOffice/releases"
download="https://github.com/jcmx9/MarkdownOffice/releases/download"
suffix="${archive##*/markdown-office-"${version}"}"

fixture_path() {
  printf '%s/%s' "${fake}" "$(printf '%s' "$1" | tr '/:?=&' '_____')"
}

# Release JSON as GitHub returns it (subset). order "std" = GitHub's field order,
# "mixed" = prerelease first, tag_name last. The body holds an escaped key as a trap.
release_json() {
  local tag="$1" pre="$2" draft="$3" order="${4:-std}" assets
  assets="$(printf '"assets": [{"name": "markdown-office-%s%s", "browser_download_url": "%s/%s/markdown-office-%s%s"}, {"name": "SHA256SUMS", "browser_download_url": "%s/%s/SHA256SUMS"}]' \
    "${tag#v}" "${suffix}" "${download}" "${tag}" "${tag#v}" "${suffix}" "${download}" "${tag}")"
  if [[ "${order}" == "std" ]]; then
    printf '{"tag_name": "%s", "draft": %s, "prerelease": %s, "body": "\\"prerelease\\": true", %s}' \
      "${tag}" "${draft}" "${pre}" "${assets}"
  else
    printf '{"prerelease":%s,"body":"\\"tag_name\\": \\"v0\\"",%s,"draft":%s,"tag_name":"%s"}' \
      "${pre}" "${assets}" "${draft}" "${tag}"
  fi
}

# Publishes asset + SHA256SUMS for a tag; a second argument overrides the hash.
publish_assets() {
  local tag="$1" hash="${2:-}"
  local asset="markdown-office-${tag#v}${suffix}"
  ln -sf "${archive}" "$(fixture_path "${download}/${tag}/${asset}")"
  [[ -n "${hash}" ]] || hash="$({ sha256sum "${archive}" 2>/dev/null || shasum -a 256 "${archive}"; } | awk '{ print $1 }')"
  printf '%s  %s\n' "${hash}" "${asset}" >"$(fixture_path "${download}/${tag}/SHA256SUMS")"
}

run_online() {
  PATH="${work}/fakebin:${PATH}" run_bootstrap "$@"
}

latest="$(fixture_path "${api}/latest")"

# API errors map to distinct codes and messages.
expect_code 8 "--pre" run_online
touch "${latest}.offline"
expect_code 4 "offline" run_online
rm "${latest}.offline"
echo 403 >"${latest}.status"
printf 'HTTP/2 403\r\nx-ratelimit-remaining: 0\r\nx-ratelimit-reset: 1700000000\r\n\r\n' >"${latest}.headers"
expect_code 10 "Abfragelimit" run_online
rm "${latest}.status" "${latest}.headers"
expect_code 9 "gibt es nicht" run_online --version 0.0.2
assert_installed
pass "API errors: no stable release -> 8 (hint --pre), offline -> 4, rate limit -> 10, unknown version -> 9"

release_json "v${version}" false false >"${latest}"
publish_assets "v${version}"
run_online >/dev/null
assert_installed
grep -qxF "${api}/latest" "${fake}/requests.log" || fail "default channel did not ask /releases/latest"
grep -qxF "${download}/v${version}/markdown-office-${version}${suffix}" "${fake}/requests.log" || fail "wrong asset downloaded"
pass "download: /releases/latest, checksum ok, installed"

# --pre takes the newest published pre-release: skips a draft and a newer stable release,
# in GitHub's field order and in a mixed order.
for order in std mixed; do
  {
    printf '['
    release_json "v98.0.0-dev.1" true true "${order}"
    printf ', '
    release_json "v99.0.0" false false "${order}"
    printf ', '
    release_json "v${version}" true false "${order}"
    printf ']'
  } >"$(fixture_path "${api}?per_page=50")"
  : >"${fake}/requests.log"
  run_online --pre >/dev/null
  assert_installed
  grep -qxF "${download}/v${version}/markdown-office-${version}${suffix}" "${fake}/requests.log" ||
    fail "--pre picked the wrong release (${order} field order)"
done
pass "--pre: newest published pre-release chosen (draft and stable skipped, any field order)"

# --version with a wrong checksum aborts with 5 and leaves the install alone.
release_json "v0.0.1" false false >"$(fixture_path "${api}/tags/v0.0.1")"
publish_assets "v0.0.1" "0000000000000000000000000000000000000000000000000000000000000000"
expect_code 5 "Prüfsumme falsch" run_online --version 0.0.1
assert_installed
pass "--version with bad checksum -> exit 5, install intact"

# 7. Uninstall removes command, menu entry, install folder, marker and an own leftover .old;
#    documents (with the user's sets and snippets) stay.
make_owned_old
documents="${HOME}/Documents/Markdown Office"
mkdir -p "${documents}/Vorlagen/eigenes" "${documents}/Snippets"
echo keep >"${documents}/Notiz.md"
echo keep >"${documents}/Vorlagen/eigenes/eigenes.typ"
echo keep >"${documents}/Snippets/eigenes.md"
out="$(run_bootstrap --uninstall)"
echo "${out}"
[[ ! -e "${install_dir}" ]] || fail "install folder still there"
[[ ! -e "${old_dir}" ]] || fail "leftover .old still there"
[[ ! -e "${command_path}" ]] || fail "command still there"
[[ ! -e "${desktop_path}" ]] || fail ".desktop entry still there"
[[ ! -e "${marker}" ]] || fail "marker still there"
for f in Notiz.md Vorlagen/eigenes/eigenes.typ Snippets/eigenes.md; do
  [[ -f "${documents}/${f}" ]] || fail "uninstall touched the documents: ${f}"
done
grep -q 'Dokumente' <<<"${out}" || fail "final message does not mention the documents"
pass "uninstall removed everything (incl. leftover .old), documents kept"

# 8. A folder without the marker is never deleted or overwritten.
if [[ "${os}" == "Darwin" ]]; then
  mkdir -p "${install_dir}/Contents"
  keep="${install_dir}/Contents/keep.txt"
else
  mkdir -p "${install_dir}"
  keep="${install_dir}/keep.txt"
fi
echo keep >"${keep}"
expect_code 1 "" run_bootstrap --uninstall
[[ -f "${keep}" ]] || fail "uninstall deleted an unmarked folder"
expect_code 1 "" with_archive "${archive}"
[[ -f "${keep}" ]] || fail "install replaced an unmarked folder"
pass "unmarked folder: uninstall and install refuse (exit 1), folder intact"

# 9. A marker alone is not enough: macOS needs Markdown Office's bundle ID, Linux the executable.
if [[ "${os}" == "Darwin" ]]; then
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.example.other" \
    "${install_dir}/Contents/Info.plist" >/dev/null
  printf '%s\n' "${install_dir}" >"${marker}"
else
  touch "${marker}"
fi
expect_code 1 "" run_bootstrap --uninstall
[[ -f "${keep}" ]] || fail "uninstall deleted a folder that only had a marker"
expect_code 1 "" with_archive "${archive}"
[[ -f "${keep}" ]] || fail "install replaced a folder that only had a marker"
pass "marker without Markdown Office (foreign bundle ID / no executable): refuse (exit 1), folder intact"

echo "All bootstrap checks passed."
