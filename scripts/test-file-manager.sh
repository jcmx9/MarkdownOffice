#!/usr/bin/env bash
# Unit test of the file-manager entry "Markdown-PDF" that scripts/bootstrap.sh writes (macOS
# Quick Action, Linux .desktop entry and Nautilus/Nemo scripts, the shared markdown-pdf.sh),
# without an app archive: bootstrap.sh is sourced (MDO_BOOTSTRAP_SOURCE_ONLY=1) and its
# generators run against a stand-in `markdown-office` command that writes a fake PDF.
# scripts/test-bootstrap.sh checks the same entries end to end with the real app.
#
#   scripts/test-file-manager.sh
#
# Everything happens below a temp dir with its own HOME (with a space and shell/XML special
# characters in the state folder's name); notifications go to a file (MDO_NOTIFY_LOG), so
# nothing is shown and the real ~/Library/Services or ~/.local is never touched.
# The paths (state_dir, pdf_script, record, …) come from the sourced bootstrap.sh.
# shellcheck disable=SC2154
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
os_name="$(uname -s)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "ok   $*"
}

work="$(mktemp -d "${TMPDIR:-/tmp}/mdo-file-manager-test.XXXXXX")"
trap 'rm -rf "${work}"' EXIT

export HOME="${work}/home"
mkdir -p "${HOME}"
unset XDG_DATA_HOME
# Quotes, $, & and < in the folder name: every generated file must keep the path intact.
export MDO_HOME="${work}/state 'q' \$x & <y>"
export MDO_NOTIFY_LOG="${work}/notify.log"

# shellcheck source=/dev/null
MDO_BOOTSTRAP_SOURCE_ONLY=1 source "${root}/scripts/bootstrap.sh"
# Sourcing turned on errexit; the generators are meant to run under it, as in the bootstrap.
detect_platform
tmp="${work}/bootstrap-tmp"
mkdir -p "${tmp}" "${state_dir}"

# The stand-in command: a PDF next to the note (like markdown-office without a target), the
# pipeline's success line, a remote-image hint for notes containing REMOTE, and an error for
# notes containing FAIL. It records each call (cwd + arguments) next to itself, not via the
# environment: Automator starts the Quick Action with a clean one.
command_path="${work}/bin dir/markdown-office"
mkdir -p "$(dirname "${command_path}")"
cat >"${command_path}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "$(pwd)" "$*" >>"$(dirname "$0")/calls.log"
note="$1"
if grep -q FAIL "${note}"; then
  echo "Error: Vorlagen-Set kaputt" >&2
  exit 1
fi
pdf="${note%.*}.pdf"
printf '%%PDF-1.7 fake\n' >"${pdf}"
echo "✓ ${pdf} erzeugt (PDF/A-3b)"
if grep -q REMOTE "${note}"; then echo "Hinweis: 2 Remote-Bild(er) übersprungen (kein Netzzugriff in Typst)."; fi
EOF
chmod +x "${command_path}"
FAKE_CALLS="${work}/bin dir/calls.log"

notes="${work}/Meine Notizen"
mkdir -p "${notes}"
printf '# Eins\n' >"${notes}/Notiz eins.md"
printf '# Zwei REMOTE\n' >"${notes}/Zwei.markdown"
printf '# FAIL\n' >"${notes}/Kaputt.md"
printf 'kein Markdown\n' >"${notes}/Liste.txt"

last_notify() {
  tail -n 1 "${MDO_NOTIFY_LOG}"
}

reset_run() {
  : >"${MDO_NOTIFY_LOG}"
  : >"${FAKE_CALLS}"
  rm -f "${notes}"/*.pdf
}

# Runs the generated script (or any entry's command) and checks exit code and notification.
expect_run() {
  local want="$1" pattern="$2" code
  shift 2
  set +e
  "$@" >/dev/null 2>&1
  code=$?
  set -e
  [[ "${code}" -eq "${want}" ]] || fail "'$*' exited ${code}, expected ${want}"
  grep -qF -- "${pattern}" "${MDO_NOTIFY_LOG}" ||
    fail "notification lacks '${pattern}': $(cat "${MDO_NOTIFY_LOG}")"
}

# --- Generators -----------------------------------------------------------------

if [[ "${os_name}" == "Linux" ]]; then
  # Nautilus is "there" (its data folder exists), Nemo not: only the Nautilus script appears.
  mkdir -p "${data_home}/nautilus"
  # The editor's own entry, as the bootstrap writes it before: the Markdown default goes to it.
  write_desktop_entry
fi
write_file_manager

[[ -x "${pdf_script}" ]] || fail "markdown-pdf.sh missing or not executable: ${pdf_script}"
[[ "$(head -n 1 "${pdf_script}")" == '#!/usr/bin/env bash' ]] || fail "markdown-pdf.sh shebang"
grep -qxF "${pdf_tag}" "${pdf_script}" || fail "markdown-pdf.sh lacks the tag"
bash -n "${pdf_script}" || fail "markdown-pdf.sh is not valid bash"
if command -v shellcheck >/dev/null 2>&1; then
  # SC2016: the test path itself holds a literal $x in single quotes.
  shellcheck -s bash -e SC2016 "${pdf_script}" || fail "markdown-pdf.sh is not shellcheck-clean"
fi
grep -qxF "F ${pdf_script}" "${record}" || fail "record lacks the script"
pass "markdown-pdf.sh written (tagged, valid bash, recorded)"

# --- The script itself ------------------------------------------------------------

reset_run
expect_run 0 "normal|Notiz eins.pdf erstellt." "${pdf_script}" "${notes}/Notiz eins.md"
[[ -f "${notes}/Notiz eins.pdf" ]] || fail "no PDF next to the note"
pass "one note: PDF next to it, notification names the PDF"

reset_run
expect_run 0 "normal|2 PDFs erstellt. 1 Datei(en) übersprungen (kein Markdown). 2 Remote-Bild(er) übersprungen." \
  "${pdf_script}" "${notes}/Notiz eins.md" "${notes}/Liste.txt" "${notes}/Zwei.markdown"
[[ "$(wc -l <"${FAKE_CALLS}" | tr -d ' ')" == "2" ]] || fail "the .txt file reached the command"
pass "several files: Markdown converted, other files skipped, remote-image hint summed"

reset_run
expect_run 1 "critical|1 PDF(s) erstellt, 1 fehlgeschlagen. Kaputt.md: Error: Vorlagen-Set kaputt" \
  "${pdf_script}" "${notes}/Kaputt.md" "${notes}/Notiz eins.md"
grep -qF "Protokoll: ${pdf_log}" "${MDO_NOTIFY_LOG}" || fail "error notification lacks the log path"
grep -qF "Error: Vorlagen-Set kaputt" "${pdf_log}" || fail "log lacks the command's output"
[[ -f "${notes}/Notiz eins.pdf" ]] || fail "a failed note stopped the others"
pass "a failing note: exit 1, the others still converted, reason + log in the notification"

reset_run
expect_run 1 "critical|Keine Markdown-Datei ausgewählt" "${pdf_script}" "${notes}/Liste.txt"
reset_run
expect_run 1 "critical|Keine Markdown-Datei ausgewählt" "${pdf_script}"
pass "no Markdown file selected: exit 1 with a hint"

mv "${command_path}" "${command_path}.away"
reset_run
expect_run 1 "critical|Markdown Office ist nicht installiert" "${pdf_script}" "${notes}/Notiz eins.md"
mv "${command_path}.away" "${command_path}"
pass "command missing: exit 1 with a hint"

# --- Per platform: the entries and the command line they run ------------------------

if [[ "${os_name}" == "Darwin" ]]; then
  wflow="${workflow_path}/Contents/document.wflow"
  plutil -lint "${workflow_path}/Contents/Info.plist" "${wflow}" >/dev/null || fail "plist lint"
  buddy=/usr/libexec/PlistBuddy
  [[ "$("${buddy}" -c 'Print :NSServices:0:NSMenuItem:default' "${workflow_path}/Contents/Info.plist")" == "Markdown-PDF" ]] ||
    fail "menu title is not Markdown-PDF"
  [[ "$("${buddy}" -c 'Print :NSServices:0:NSSendFileTypes:0' "${workflow_path}/Contents/Info.plist")" == "net.daringfireball.markdown" ]] ||
    fail "Quick Action not restricted to Markdown"
  [[ "$("${buddy}" -c 'Print :NSServices:0:NSRequiredContext:NSApplicationIdentifier' "${workflow_path}/Contents/Info.plist")" == "com.apple.finder" ]] ||
    fail "Quick Action not bound to Finder"
  [[ "$("${buddy}" -c 'Print :actions:0:action:ActionParameters:inputMethod' "${wflow}")" == "1" ]] ||
    fail "input is not passed as arguments"
  cmd="$("${buddy}" -c 'Print :actions:0:action:ActionParameters:COMMAND_STRING' "${wflow}")"
  grep -qxF "W ${workflow_path}" "${record}" || fail "record lacks the Quick Action"
  grep -qxF "D ${HOME}/Library" "${record}" || fail "record lacks the created ~/Library"
  # As Automator runs it: /bin/bash -c with the selected files as arguments, minimal PATH, cwd /.
  reset_run
  expect_run 0 "normal|Notiz eins.pdf erstellt." \
    env -i HOME="${HOME}" PATH=/usr/bin:/bin MDO_NOTIFY_LOG="${MDO_NOTIFY_LOG}" \
    /bin/bash -c "cd / && ${cmd}" automator "${notes}/Notiz eins.md"
  pass "Quick Action: plists lint, Finder + Markdown only, its command converts with a minimal PATH"
  # The bundle as Automator itself runs it (automator -i hands the file over like Finder). Only
  # in CI: Automator starts the action with a clean environment, so MDO_NOTIFY_LOG does not
  # reach the script and a real notification would appear on a developer's desktop.
  if [[ "${CI:-}" == "true" ]]; then
    reset_run
    /usr/bin/automator -i "${notes}/Notiz eins.md" "${workflow_path}" >"${work}/automator.log" 2>&1 &
    automator_pid=$!
    for _ in $(seq 1 120); do
      kill -0 "${automator_pid}" 2>/dev/null || break
      sleep 1
    done
    if kill "${automator_pid}" 2>/dev/null; then
      fail "automator did not finish within 120 s: $(cat "${work}/automator.log")"
    fi
    wait "${automator_pid}" || fail "automator failed: $(cat "${work}/automator.log")"
    grep -qF "|${notes}/Notiz eins.md" "${FAKE_CALLS}" ||
      fail "automator did not hand the note to markdown-office: $(cat "${work}/automator.log")"
    [[ -f "${notes}/Notiz eins.pdf" ]] || fail "no PDF after the Quick Action ran in Automator"
    pass "Quick Action run by Automator (automator -i): the note reaches markdown-office"
  fi
else
  grep -qxF "F ${pdf_desktop_path}" "${record}" || fail "record lacks the .desktop entry"
  grep -qxF "Name=Markdown-PDF" "${pdf_desktop_path}" || fail ".desktop Name"
  grep -qxF "MimeType=text/markdown;" "${pdf_desktop_path}" || fail ".desktop MimeType"
  if command -v desktop-file-validate >/dev/null 2>&1; then
    desktop-file-validate "${pdf_desktop_path}" || fail "desktop-file-validate"
  fi
  # The Exec line as a desktop launcher runs it: unquote the program, %F = the selected files.
  exec_line="$(sed -n 's/^Exec=//p' "${pdf_desktop_path}")"
  [[ "${exec_line}" == *' %F' ]] || fail ".desktop Exec does not take %F: ${exec_line}"
  program="$(printf '%s' "${exec_line% %F}" | sed -e 's/^"//' -e 's/"$//' -e 's/\\\\/\\/g' -e 's/\\\([$`"\\]\)/\1/g' -e 's/%%/%/g')"
  [[ "${program}" == "${pdf_script}" ]] || fail ".desktop Exec runs '${program}', expected '${pdf_script}'"
  reset_run
  expect_run 0 "normal|2 PDFs erstellt." env PATH=/usr/bin:/bin "${program}" "${notes}/Notiz eins.md" "${notes}/Zwei.markdown"
  pass ".desktop entry: Name, MimeType, Exec runs markdown-pdf.sh with all selected files"

  nautilus="${data_home}/nautilus/scripts/Markdown-PDF"
  [[ -x "${nautilus}" ]] || fail "Nautilus script missing"
  [[ ! -e "${data_home}/nemo/scripts/Markdown-PDF" ]] || fail "Nemo script written although Nemo is not there"
  grep -qxF "F ${nautilus}" "${record}" || fail "record lacks the Nautilus script"
  grep -qxF "D ${data_home}/nautilus/scripts" "${record}" || fail "record lacks the created scripts folder"
  ! grep -qxF "D ${data_home}/nautilus" "${record}" || fail "record claims the existing nautilus folder"
  # Nautilus runs scripts in the folder with the selected names as arguments.
  reset_run
  # shellcheck disable=SC2016 # expanded by the inner bash
  expect_run 0 "normal|Notiz eins.pdf erstellt." bash -c 'cd "$1" && "$2" "Notiz eins.md"' _ "${notes}" "${nautilus}"
  pass "Nautilus script (only for a file manager that is there): relative names from its folder work"

  # No Markdown default yet: the editor becomes it, recorded with the ~/.config the install made.
  [[ "$(cat "${mimeapps_path}")" == $'[Default Applications]\ntext/markdown=markdown-office.desktop' ]] ||
    fail "mimeapps.list: $(cat "${mimeapps_path}")"
  grep -qxF "M ${mimeapps_path}" "${record}" || fail "record lacks the mimeapps.list line"
  grep -qxF "D ${HOME}/.config" "${record}" || fail "record lacks the created ~/.config"
  # A user's own file: our line goes into its [Default Applications] and comes out again; a
  # default the user chose is never replaced.
  remove_file_manager
  [[ ! -e "${HOME}/.config" ]] || fail "uninstall left the ~/.config it created"
  mkdir -p "$(dirname "${mimeapps_path}")"
  printf '[Default Applications]\ntext/plain=editor.desktop\n\n[Added Associations]\ntext/plain=editor.desktop;\n' >"${mimeapps_path}"
  own_mimeapps="$(cat "${mimeapps_path}")"
  write_file_manager
  [[ "$(sed -n 2p "${mimeapps_path}")" == "text/markdown=markdown-office.desktop" ]] ||
    fail "default line not in [Default Applications]: $(cat "${mimeapps_path}")"
  remove_file_manager
  [[ "$(cat "${mimeapps_path}")" == "${own_mimeapps}" ]] || fail "uninstall changed the user's mimeapps.list: $(cat "${mimeapps_path}")"
  printf '[Default Applications]\ntext/markdown=other.desktop\n' >"${mimeapps_path}"
  write_file_manager
  [[ "$(cat "${mimeapps_path}")" == $'[Default Applications]\ntext/markdown=other.desktop' ]] ||
    fail "install replaced the user's Markdown default"
  ! grep -q '^M ' "${record}" || fail "recorded a default line it did not write"
  remove_file_manager
  [[ "$(cat "${mimeapps_path}")" == $'[Default Applications]\ntext/markdown=other.desktop' ]] ||
    fail "uninstall touched the user's Markdown default"
  rm -rf "${HOME}/.config"
  write_file_manager
  pass "Markdown default: set to the editor only when none is chosen, removed again exactly"
fi

# --- Idempotent update, foreign files, uninstall ------------------------------------

before="$(cat "${record}")"
write_file_manager
[[ "$(cat "${record}")" == "${before}" ]] || fail "a second run changed the record"
pass "second run (update): same entries, same record"

# A file of the same name that is not ours is never overwritten or removed.
if [[ "${os_name}" == "Darwin" ]]; then
  foreign="${workflow_path}"
  remove_file_manager
  mkdir -p "${foreign}/Contents"
  echo keep >"${foreign}/Contents/document.wflow"
  check_file="${foreign}/Contents/document.wflow"
else
  foreign="${pdf_desktop_path}"
  remove_file_manager
  mkdir -p "$(dirname "${foreign}")"
  echo keep >"${foreign}"
  check_file="${foreign}"
fi
write_file_manager 2>/dev/null
[[ "$(cat "${check_file}")" == "keep" ]] || fail "install overwrote a foreign ${foreign}"
remove_file_manager 2>/dev/null
[[ "$(cat "${check_file}")" == "keep" ]] || fail "uninstall removed a foreign ${foreign}"
rm -rf "${foreign}"
# The test made those folders itself; the next install creates (and records) them again.
[[ "${os_name}" != "Darwin" ]] || rm -rf "${HOME}/Library"
pass "foreign entry of the same name: install and uninstall leave it alone"

write_file_manager
remove_file_manager
[[ ! -e "${pdf_script}" ]] || fail "markdown-pdf.sh still there"
[[ ! -e "${record}" ]] || fail "record still there"
[[ ! -e "${pdf_log}" ]] || fail "log still there"
if [[ "${os_name}" == "Darwin" ]]; then
  [[ ! -e "${workflow_path}" ]] || fail "Quick Action still there"
  [[ ! -e "${HOME}/Library" ]] || fail "the ~/Library the install created is still there"
else
  [[ ! -e "${pdf_desktop_path}" ]] || fail ".desktop entry still there"
  [[ ! -e "${data_home}/nautilus/scripts" ]] || fail "the scripts folder the install created is still there"
  [[ -d "${data_home}/nautilus" ]] || fail "uninstall removed the nautilus folder it did not create"
  [[ ! -e "${HOME}/.config" ]] || fail "the ~/.config (mimeapps.list) the install created is still there"
fi
pass "uninstall: entries, script, record, log and the folders the install created are gone"

echo "All file-manager checks passed."
