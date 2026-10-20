#!/usr/bin/env bash
# Ein-Zeiler-Bootstrap für Markdown Office (macOS/Linux).
#
#   Installieren / Aktualisieren (neueste stabile Version):
#     curl -fsSL https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.sh | bash
#   Vorabversion testen (neueste Pre-Release):
#     curl -fsSL https://raw.githubusercontent.com/jcmx9/MarkdownOffice/dev/scripts/bootstrap.sh | bash -s -- --pre
#   Bestimmte Version:            ... | bash -s -- --version 26.10.0
#   Deinstallieren:               ... | bash -s -- --uninstall
#
# Lädt das passende Archiv der GitHub-Release, prüft es gegen SHA256SUMS und
# installiert ohne Adminrechte:
#   macOS: ~/Applications/Markdown Office.app
#          (Marker ~/.local/share/markdown-office/.mdo-install, außerhalb der
#          signierten App; Inhalt: Pfad der App)
#   Linux: ~/.local/share/markdown-office/app/ (das AppImage einmal entpackt: startet
#          ohne FUSE/libfuse2 und schneller) + ~/.local/share/applications/markdown-office.desktop
#   Befehl: ~/.local/bin/markdown-office
#     markdown-office notiz.md [ziel.pdf] [Optionen]   PDF erzeugen (Pipeline)
#     markdown-office --app [notiz.md …]               Editor starten
#     (Startprotokoll des Editors: ~/.local/share/markdown-office/launch.log)
#   Dateimanager-Eintrag „Markdown-PDF“ (PDF neben der Notiz, ohne den Editor):
#     macOS: Quick Action ~/Library/Services/Markdown-PDF.workflow (Finder → Rechtsklick)
#     Linux: ~/.local/share/applications/markdown-office-pdf.desktop („Öffnen mit“) und,
#            wenn Nautilus/Nemo da sind, ein Skript in deren scripts-Ordner
#     beide rufen ~/.local/share/markdown-office/markdown-pdf.sh (Ergebnis als Mitteilung)
#     Was davon angelegt wurde, steht in .mdo-file-manager neben dem Marker; nur das
#     entfernt die Deinstallation.
# Dokumente, Vorlagen-Sets, Snippets und Einstellungen werden nie angetastet.
#
# The command is a small /bin/sh shim that always runs the app's own binary as Node
# (ELECTRON_RUN_AS_NODE=1) with <resources>/pipeline/cli.js and every argument unchanged;
# cli.js itself starts the editor for a leading --app (see pipeline/cli.js).
#
# Umgebung (für Tests):
#   MDO_ARCHIVE  lokales Archiv statt Download (keine Prüfsumme)
#   MDO_HOME     Installordner (macOS: Ordner, der Markdown Office.app enthält – dort
#                liegen dann auch Marker und Startprotokoll; Linux: statt
#                ~/.local/share/markdown-office, die App liegt dann in MDO_HOME/app)
#
# Exit-Codes:
#   0 ok                          1 Sicherheitsabbruch (keine Markdown-Office-Installation)
#   2 falscher Aufruf             3 System nicht unterstützt / Werkzeug fehlt
#   4 offline / Download-Fehler   5 Prüfsumme falsch
#   6 Installation fehlgeschlagen, alte Version unverändert
#   7 Wiederherstellung fehlgeschlagen – manuell nötig (Pfad wird ausgegeben)
#   8 keine passende Release (noch keine stabile, keine Vorabversion, Datei fehlt)
#   9 Version gibt es nicht       10 GitHub-Abfragelimit erreicht
#  12 Markdown Office läuft noch (macOS; nichts verändert)
#
# Release lookup uses the unauthenticated GitHub API (60 requests/hour) with exactly
# one call: /releases/latest (never a pre-release or draft), /releases?per_page=50 for
# --pre, /releases/tags/v<X> for --version. The JSON is read with grep/awk instead of jq
# (often missing) or python3 (on macOS without Command Line Tools, /usr/bin/python3 is a
# stub that opens an install dialog). That is safe: a quoted key followed by a colon,
# e.g. "tag_name":, cannot occur inside a JSON string, where quotes are escaped. Each
# release carries exactly one top-level tag_name, draft and prerelease (nested objects
# have none), so the tokens come in groups of three in any field order.
#
# Everything runs inside main(), called on the last line, so a truncated download
# of this script never executes half of it.
set -euo pipefail

readonly repo="jcmx9/MarkdownOffice"
readonly api="https://api.github.com/repos/${repo}/releases"
readonly marker_name=".mdo-install"
readonly bundle_id="io.github.jcmx9.markdownoffice"
readonly app_name="Markdown Office"
readonly launcher_tag="# markdown-office command (Markdown Office bootstrap)"
readonly desktop_tag="X-MarkdownOffice-Bootstrap=true"
# File-manager entry "Markdown-PDF": its name in the menus, and the comment line that marks every
# file the bootstrap wrote for it (script, Quick Action, .desktop), so update and uninstall
# never touch a file of the same name that someone else made.
readonly pdf_action="Markdown-PDF"
readonly pdf_tag="# Markdown-PDF (Markdown Office bootstrap)"
readonly record_name=".mdo-file-manager"
# electron-builder names the Linux executable after the package name.
readonly linux_bin="markdown-office"
readonly version_re='^[0-9]+\.[0-9]+\.[0-9]+(-dev\.[0-9]+)?$'

say() { echo "→ $*"; }
ok() { echo "✓ $*"; }
warn() { echo "Warnung: $*" >&2; }
die() {
  local code="$1"
  shift
  echo "Error: $*" >&2
  exit "${code}"
}

usage() {
  cat <<'EOF'
Markdown-Office-Bootstrap (macOS/Linux)

  bootstrap.sh                 neueste stabile Version installieren oder aktualisieren
  bootstrap.sh --pre           neueste Vorabversion (Pre-Release) zum Testen – sie kann
                               älter sein als die neueste stabile Version
  bootstrap.sh --version X     genau Version X (z. B. 26.10.0 oder 26.10.0-dev.1)
  bootstrap.sh --uninstall     Markdown Office entfernen (Dokumente, Vorlagen-Sets,
                               Snippets und Einstellungen bleiben)
EOF
}

strip_trailing_slashes() {
  local path="$1"
  while [[ "${path}" == */ && "${path}" != "/" ]]; do
    path="${path%/}"
  done
  printf '%s' "${path}"
}

# --- Platform and paths -------------------------------------------------------

detect_platform() {
  os="$(uname -s)"
  local machine home_override=""
  machine="$(uname -m)"
  case "${os}" in
    Darwin)
      case "${machine}" in
        arm64) arch="arm64" ;;
        x86_64) arch="x64" ;;
        *) die 3 "Prozessor ${machine} wird nicht unterstützt." ;;
      esac
      ;;
    Linux)
      case "${machine}" in
        x86_64 | amd64) arch="x64" ;;
        *) die 3 "Linux auf ${machine} wird nicht unterstützt (nur x86_64)." ;;
      esac
      ;;
    *) die 3 "Betriebssystem ${os} wird nicht unterstützt (Windows: bootstrap.ps1)." ;;
  esac

  [[ -z "${MDO_HOME:-}" ]] || home_override="$(strip_trailing_slashes "${MDO_HOME}")"
  data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
  bin_dir="${HOME}/.local/bin"
  command_path="${bin_dir}/markdown-office"
  desktop_path=""
  if [[ "${os}" == "Darwin" ]]; then
    # install_dir is the unit that gets replaced and deleted: the .app bundle. Never write
    # into the signed bundle (it would break the code seal): the marker lives outside the
    # app and names it; deleting additionally requires Markdown Office's bundle ID.
    install_dir="${home_override:-${HOME}/Applications}/${app_name}.app"
    state_dir="${home_override:-${data_home}/markdown-office}"
    marker="${state_dir}/${marker_name}"
  else
    # The AppImage is extracted once: no FUSE needed, faster start. install_dir is the
    # extracted app (the unit that gets replaced and deleted); the marker lives inside it.
    state_dir="${home_override:-${data_home}/markdown-office}"
    install_dir="${state_dir}/app"
    marker="${install_dir}/${marker_name}"
    desktop_path="${data_home}/applications/markdown-office.desktop"
  fi
  app_exe="$(app_exe_in "${install_dir}")"
  cli_js="$(cli_js_in "${install_dir}")"
  log_path="${state_dir}/launch.log"
  # The file-manager entry lives outside the app (the signed bundle must stay untouched, and
  # the Linux app folder is replaced on every update): a script next to the marker that every
  # entry calls, its log, and the record of what the install created.
  pdf_script="${state_dir}/markdown-pdf.sh"
  pdf_log="${state_dir}/markdown-pdf.log"
  record="${state_dir}/${record_name}"
  workflow_path=""
  pdf_desktop_path=""
  mimeapps_path=""
  if [[ "${os}" == "Darwin" ]]; then
    workflow_path="${HOME}/Library/Services/${pdf_action}.workflow"
  else
    pdf_desktop_path="${data_home}/applications/markdown-office-pdf.desktop"
    mimeapps_path="${XDG_CONFIG_HOME:-${HOME}/.config}/mimeapps.list"
  fi
}

# The app binary and the pipeline entry inside an install (or staged) folder.
app_exe_in() {
  if [[ "${os}" == "Darwin" ]]; then
    printf '%s' "$1/Contents/MacOS/${app_name}"
  else
    printf '%s' "$1/${linux_bin}"
  fi
}

cli_js_in() {
  if [[ "${os}" == "Darwin" ]]; then
    printf '%s' "$1/Contents/Resources/pipeline/cli.js"
  else
    printf '%s' "$1/resources/pipeline/cli.js"
  fi
}

# Runs the pipeline CLI of an install folder as the command does (Linux: bundled libraries first).
run_cli() {
  local dir="$1"
  shift
  if [[ "${os}" == "Linux" ]]; then
    LD_LIBRARY_PATH="${dir}/usr/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}" \
      ELECTRON_RUN_AS_NODE=1 "$(app_exe_in "${dir}")" "$(cli_js_in "${dir}")" "$@"
  else
    ELECTRON_RUN_AS_NODE=1 "$(app_exe_in "${dir}")" "$(cli_js_in "${dir}")" "$@"
  fi
}

asset_name() {
  local version="$1"
  if [[ "${os}" == "Darwin" ]]; then
    echo "markdown-office-${version}-mac-${arch}.zip"
  else
    echo "markdown-office-${version}-linux-x86_64.AppImage"
  fi
}

# --- Ownership checks ---------------------------------------------------------

app_bundle_id() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$1/Contents/Info.plist" 2>/dev/null || true
}

is_elf() {
  [[ -f "$1" && "$(head -c 4 "$1" | tail -c 3)" == "ELF" ]]
}

# True only for an install this bootstrap made (install_dir or its leftover .old).
# macOS: the marker names this app AND the bundle is Markdown Office's.
# Linux: the marker AND the extracted ELF executable sit in the folder.
owns_dir() {
  local dir="$1"
  if [[ "${os}" == "Darwin" ]]; then
    [[ -f "${marker}" && "$(cat "${marker}")" == "${install_dir}" ]] &&
      [[ "$(app_bundle_id "${dir}")" == "${bundle_id}" ]]
  else
    [[ -f "${dir}/${marker_name}" && -x "${dir}/${linux_bin}" ]] && is_elf "${dir}/${linux_bin}"
  fi
}

# Prints what is in a folder the bootstrap would otherwise delete, and stops.
refuse_foreign() {
  local path="$1"
  if [[ "${os}" == "Darwin" ]]; then
    echo "Error: ${path} existiert, ist aber keine Markdown-Office-Installation dieses Skripts (Marker ${marker} fehlt oder Bundle-ID ≠ ${bundle_id})." >&2
  else
    echo "Error: ${path} existiert, ist aber keine Markdown-Office-Installation dieses Skripts (Marker ${marker_name} oder ${linux_bin} fehlt)." >&2
  fi
  echo "Gefunden:" >&2
  ls -la "${path}" >&2 || true
  die 1 "Abbruch – der Ordner wird nicht angetastet. Bitte selbst prüfen und ggf. entfernen."
}

is_own_file() {
  local path="$1" tag="$2"
  [[ -f "${path}" ]] && grep -qF -- "${tag}" "${path}"
}

# --- Release lookup -----------------------------------------------------------

header_value() {
  local name="$1"
  awk -v n="${name}" -F': *' 'tolower($1) == n { v = $2; sub(/\r$/, "", v) } END { print v }' \
    "${tmp}/api.headers" 2>/dev/null || true
}

clock_time() {
  date -r "$1" '+%H:%M' 2>/dev/null || date -d "@$1" '+%H:%M' 2>/dev/null || echo "?"
}

# Fetches ${1} into ${tmp}/api.json; maps HTTP errors to distinct messages and codes.
# ${2}: latest | list | tag (only changes the 404 message).
api_get() {
  local url="$1" what="$2" code
  : >"${tmp}/api.headers"
  if ! code="$(curl -sS -L --proto '=https' -H 'Accept: application/vnd.github+json' \
    -D "${tmp}/api.headers" -o "${tmp}/api.json" -w '%{http_code}' "${url}" 2>"${tmp}/api.err")"; then
    die 4 "Keine Verbindung zu GitHub (offline?): $(tail -n 1 "${tmp}/api.err")"
  fi
  case "${code}" in
    200) ;;
    404)
      case "${what}" in
        latest) die 8 "Noch keine stabile Version veröffentlicht – mit --pre die Testversion installieren." ;;
        tag) die 9 "Version ${want_version} gibt es nicht (keine Release v${want_version})." ;;
        *) die 4 "GitHub-API antwortet mit 404: ${url}" ;;
      esac
      ;;
    403 | 429)
      if [[ "${code}" == "429" || "$(header_value x-ratelimit-remaining)" == "0" ]]; then
        local reset
        reset="$(header_value x-ratelimit-reset)"
        if [[ -n "${reset}" ]]; then
          die 10 "GitHub-Abfragelimit (60 pro Stunde) erreicht – wieder möglich ab $(clock_time "${reset}") Uhr."
        fi
        die 10 "GitHub-Abfragelimit (60 pro Stunde) erreicht – bitte später erneut versuchen."
      fi
      die 4 "GitHub-API verweigert den Zugriff (HTTP ${code}): ${url}"
      ;;
    *) die 4 "GitHub-API antwortet mit HTTP ${code}: ${url}" ;;
  esac
}

json_tokens() {
  grep -oE '"(tag_name|draft|prerelease)": *("[^"\\]*"|true|false)' "${tmp}/api.json" || true
}

first_tag() {
  json_tokens | awk -F'"' '$2 == "tag_name" { print $4; exit }'
}

# Newest published pre-release in a /releases list (newest first). Tokens come in
# groups of three per release, in any order; a group without all three keys means the
# response is not what we expect, so stop instead of guessing.
newest_prerelease() {
  json_tokens | awk -F'"' '
    {
      n++
      seen[$2] = 1
      if ($2 == "tag_name") tag = $4
      else if ($2 == "draft") draft = ($0 ~ /true$/)
      else if ($2 == "prerelease") pre = ($0 ~ /true$/)
    }
    n % 3 == 0 {
      if (!(seen["tag_name"] && seen["draft"] && seen["prerelease"])) { bad = 1; exit }
      if (pre && !draft && tag != "") { print tag; exit }
      split("", seen); tag = ""; draft = 0; pre = 0
    }
    END { if (bad || n % 3 != 0) exit 1 }'
}

# Sets tag, version, asset, asset_url and sums_url for the requested channel.
resolve_release() {
  if [[ -n "${want_version}" ]]; then
    api_get "${api}/tags/v${want_version}" tag
    tag="$(first_tag)"
  elif [[ "${want_pre}" == "true" ]]; then
    api_get "${api}?per_page=50" list
    tag="$(newest_prerelease)" || die 4 "Unerwartete Antwort der GitHub-API (Release ohne tag_name/draft/prerelease)."
    [[ -n "${tag}" ]] || die 8 "Keine Vorabversion (Pre-Release) unter den letzten 50 Releases gefunden."
  else
    # /releases/latest never returns a pre-release or draft.
    api_get "${api}/latest" latest
    tag="$(first_tag)"
  fi
  [[ -n "${tag}" ]] || die 4 "Unerwartete Antwort der GitHub-API (kein tag_name)."
  version="${tag#v}"
  asset="$(asset_name "${version}")"
  local base="https://github.com/${repo}/releases/download/${tag}"
  grep -qF "${base}/${asset}\"" "${tmp}/api.json" || die 8 "Release ${tag} enthält kein ${asset}."
  grep -qF "${base}/SHA256SUMS\"" "${tmp}/api.json" || die 8 "Release ${tag} enthält keine SHA256SUMS."
  asset_url="${base}/${asset}"
  sums_url="${base}/SHA256SUMS"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

# Downloads the asset into ${tmp} and verifies it; sets archive.
download_release() {
  resolve_release
  say "Lade Markdown Office ${version} (${asset})"
  curl -fL --proto '=https' --retry 3 -o "${tmp}/${asset}" "${asset_url}" ||
    die 4 "Download fehlgeschlagen: ${asset_url}"
  curl -fsSL --proto '=https' --retry 3 -o "${tmp}/SHA256SUMS" "${sums_url}" ||
    die 4 "Download fehlgeschlagen: ${sums_url}"
  local expected actual
  expected="$(awk -v f="${asset}" '$2 == f || $2 == "*" f { print $1; exit }' "${tmp}/SHA256SUMS")"
  [[ -n "${expected}" ]] || die 5 "SHA256SUMS enthält keinen Eintrag für ${asset}."
  actual="$(sha256_of "${tmp}/${asset}")"
  if [[ "${actual}" != "${expected}" ]]; then
    die 5 "Prüfsumme falsch für ${asset} (erwartet ${expected}, erhalten ${actual}) – nichts wurde verändert."
  fi
  ok "Prüfsumme stimmt"
  archive="${tmp}/${asset}"
}

# --- Install ------------------------------------------------------------------

# Builds the new install in a staging folder next to the target (same file system,
# so the final moves are renames); sets stage_dir (the new install_dir).
stage_install() {
  local parent
  parent="$(dirname "${install_dir}")"
  mkdir -p "${parent}"
  stage_root="$(mktemp -d "${parent}/.$(basename "${install_dir}")-new.XXXXXX")"
  if [[ "${os}" == "Darwin" ]]; then
    ditto -x -k "${archive}" "${stage_root}" 2>/dev/null ||
      die 6 "Archiv lässt sich nicht entpacken: ${archive}"
    stage_dir="${stage_root}/${app_name}.app"
    [[ -x "$(app_exe_in "${stage_dir}")" ]] ||
      die 6 "Archiv enthält kein ${app_name}.app: ${archive}"
    [[ "$(app_bundle_id "${stage_dir}")" == "${bundle_id}" ]] ||
      die 6 "Archiv enthält kein Markdown Office (Bundle-ID ≠ ${bundle_id}): ${archive}"
    # Downloaded or copied archives may carry Gatekeeper's quarantine flag; the app is unsigned.
    xattr -dr com.apple.quarantine "${stage_dir}" 2>/dev/null || true
  else
    is_elf "${archive}" || die 6 "Keine gültige AppImage-Datei: ${archive}"
    # The AppImage runtime extracts itself (no FUSE needed) into ./squashfs-root without
    # starting the app; the copy keeps the caller's file unchanged and is deleted after.
    cp "${archive}" "${stage_root}/markdown-office.AppImage"
    chmod 755 "${stage_root}/markdown-office.AppImage"
    (cd "${stage_root}" && ./markdown-office.AppImage --appimage-extract) >/dev/null 2>&1 ||
      die 6 "AppImage lässt sich nicht entpacken: ${archive}"
    rm -f "${stage_root}/markdown-office.AppImage"
    stage_dir="${stage_root}/$(basename "${install_dir}")"
    mv "${stage_root}/squashfs-root" "${stage_dir}"
    if [[ ! -x "${stage_dir}/${linux_bin}" ]] || ! is_elf "${stage_dir}/${linux_bin}"; then
      die 6 "AppImage enthält kein ${linux_bin}: ${archive}"
    fi
    touch "${stage_dir}/${marker_name}"
  fi
  # Smoke test before the old install is touched: the pipeline CLI as the command runs it
  # (Electron as Node: no window, no display needed) prints its own and Typst's version.
  local out
  out="$(run_cli "${stage_dir}" --version </dev/null 2>/dev/null)" ||
    die 6 "Das neue Markdown Office startet nicht – die bisherige Installation bleibt."
  case "${out}" in
    "markdown-office "*) ;;
    *) die 6 "Das neue Markdown Office meldet keine Version – die bisherige Installation bleibt." ;;
  esac
  say "Neue Version: $(printf '%s' "${out}" | tr '\n' ' ')"
}

# Prints how to put the previous version back by hand, and stops with 7.
die_recovery() {
  local old="$1"
  echo "Error: Installation und Wiederherstellung fehlgeschlagen." >&2
  echo "  Die bisherige Version liegt unverändert in: ${old}" >&2
  echo "  Zurückholen mit:" >&2
  printf '    mv %q %q\n' "${old}" "${install_dir}" >&2
  exit 7
}

# macOS: Electron starts its helpers from the bundle path, so swapping or deleting the
# bundle under a running app could mix versions or crash it (Linux keeps the running
# executable's inodes; Windows refuses on its own). Stops with 12, nothing changed.
refuse_running() {
  [[ "${os}" == "Darwin" ]] || return 0
  local pattern
  pattern="$(printf '%s' "${install_dir}/Contents/" | sed -e 's/[][\\.*^$+?(){}|]/\\&/g')"
  if pgrep -f -- "${pattern}" >/dev/null 2>&1; then
    die 12 "Markdown Office läuft noch – bitte beenden und erneut versuchen. Es wurde nichts verändert."
  fi
}

# Swaps the staged install in: old → .old, new → target, delete .old; restores .old on failure.
swap_install() {
  refuse_running
  local old="${install_dir}.old"
  if [[ -e "${old}" ]]; then
    # Leftover from an interrupted run: only ours may go.
    owns_dir "${old}" || refuse_foreign "${old}"
    rm -rf "${old}" || die 6 "Konnte den Rest eines früheren Laufs nicht löschen: ${old}"
  fi
  if [[ "${os}" == "Darwin" ]]; then
    # Before the swap, so an interrupted first install is still recognised as ours
    # (ownership also needs the bundle ID, so a marker without app is harmless).
    mkdir -p "${state_dir}"
    printf '%s\n' "${install_dir}" >"${marker}"
  fi
  local had_old="false"
  if [[ -e "${install_dir}" ]]; then
    mv "${install_dir}" "${old}" || die 6 "Konnte ${install_dir} nicht ersetzen – läuft Markdown Office noch?"
    had_old="true"
  fi
  if ! mv "${stage_dir}" "${install_dir}"; then
    if [[ "${had_old}" == "true" ]]; then
      mv "${old}" "${install_dir}" || die_recovery "${old}"
      die 6 "Installation fehlgeschlagen – die bisherige Version wurde wiederhergestellt."
    fi
    die 6 "Installation fehlgeschlagen."
  fi
  rm -rf "${old}" || warn "Alte Version konnte nicht gelöscht werden: ${old}"
  rm -rf "${stage_root}"
  stage_root=""
}

# One word for /bin/sh: single-quoted, each ' written as '\''.
sh_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed -e "s/'/'\\\\''/g")"
}

write_launcher() {
  mkdir -p "${bin_dir}"
  if [[ -e "${command_path}" ]] && ! is_own_file "${command_path}" "${launcher_tag}"; then
    die 1 "${command_path} existiert und stammt nicht von Markdown Office – bitte selbst entfernen."
  fi
  local tmp_cmd lib_line=""
  if [[ "${os}" == "Linux" ]]; then
    # Like the AppImage's AppRun: the bundled libraries (libXss, libXtst, …) come first.
    lib_line="LD_LIBRARY_PATH=$(sh_quote "${install_dir}/usr/lib")\"\${LD_LIBRARY_PATH:+:\${LD_LIBRARY_PATH}}\"
export LD_LIBRARY_PATH
"
  fi
  tmp_cmd="$(mktemp "${bin_dir}/.markdown-office.XXXXXX")"
  # Every argument goes to cli.js unchanged; for a leading --app cli.js starts the editor
  # detached, its output in the launch log (truncated per start). Relative paths work: both
  # resolve them against this cwd, and a running instance receives them already resolved.
  cat >"${tmp_cmd}" <<EOF
#!/bin/sh
${launcher_tag}
${lib_line}MDO_LAUNCH_LOG=$(sh_quote "${log_path}")
export MDO_LAUNCH_LOG
ELECTRON_RUN_AS_NODE=1 exec $(sh_quote "${app_exe}") $(sh_quote "${cli_js}") "\$@"
EOF
  chmod 755 "${tmp_cmd}"
  mv "${tmp_cmd}" "${command_path}"
}

# One argument for a .desktop Exec line: quoted, with ", `, $ and \ escaped by the quoting
# rule, then every \ doubled by the string escape rule, and % doubled (field codes).
desktop_exec_arg() {
  printf '"%s"' "$(printf '%s' "$1" | sed -e 's/[\\"`$]/\\&/g' -e 's/\\/\\\\/g' -e 's/%/%%/g')"
}

write_desktop_entry() {
  [[ -n "${desktop_path}" ]] || return 0
  mkdir -p "$(dirname "${desktop_path}")"
  if [[ -e "${desktop_path}" ]] && ! is_own_file "${desktop_path}" "${desktop_tag}"; then
    warn "${desktop_path} stammt nicht von Markdown Office – Menüeintrag nicht angelegt."
    return 0
  fi
  local icon_line=""
  if [[ -f "${install_dir}/${linux_bin}.png" ]]; then
    icon_line="Icon=$(printf '%s' "${install_dir}/${linux_bin}.png" | sed -e 's/\\/\\\\/g')"
  fi
  {
    echo "[Desktop Entry]"
    echo "Type=Application"
    echo "Name=${app_name}"
    echo "Comment=Markdown-Editor mit PDF-Export"
    # Through the command: it sets the library path and logs the start.
    echo "Exec=$(desktop_exec_arg "${command_path}") --app %F"
    [[ -z "${icon_line}" ]] || echo "${icon_line}"
    echo "Terminal=false"
    echo "Categories=Office;TextEditor;"
    echo "MimeType=text/markdown;"
    # electron-builder's own default without desktopName: the product name.
    echo "StartupWMClass=${app_name}"
    echo "${desktop_tag}"
  } >"${desktop_path}"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$(dirname "${desktop_path}")" >/dev/null 2>&1 || true
  fi
}

# --- File-manager entry "Markdown-PDF" ----------------------------------------
# Right-click a note in Finder / the Linux file manager → "Markdown-PDF": the note becomes a PDF
# next to it, through the installed markdown-office command, without starting the editor. The
# predecessor real-fast-document had this; the entries call one script (pdf_script) that loops
# over the selected files and reports as a desktop notification, because no terminal shows the
# command's output there. Everything here is a convenience: a failure only warns, the install
# itself is complete at this point.

# The record lists what the install created outside the app, one "<kind> <path>" per line:
#   F  a file it wrote (removed only while it carries pdf_tag)
#   W  the Quick Action bundle (removed only while its document.wflow carries pdf_tag)
#   M  the mimeapps.list that got the editor as Markdown default (only that line is removed)
#   D  a folder it had to create (removed only when empty again)
# Uninstall removes exactly these; an update keeps the D entries of earlier runs.
record_add() {
  [[ -f "${record}" ]] && grep -qxF -- "$1" "${record}" && return 0
  printf '%s\n' "$1" >>"${record}"
}

# mkdir -p that records every level it creates (D), so uninstall can take them back.
make_dir_recorded() {
  local dir="$1" parent
  [[ -d "${dir}" ]] && return 0
  parent="$(dirname "${dir}")"
  [[ "${parent}" == "${dir}" ]] || make_dir_recorded "${parent}" || return 1
  mkdir "${dir}" || return 1
  record_add "D ${dir}"
}

# Text for an XML plist <string>.
xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

owns_workflow() {
  [[ -d "$1" ]] && is_own_file "$1/Contents/document.wflow" "${pdf_tag}"
}

# The script every entry calls: markdown-office for each selected Markdown file, then one
# notification. Paths are baked in at install time (sh_quote), so it needs no PATH: Finder and
# the desktop start it with a minimal environment. Bash 3.2 compatible (macOS /bin/bash).
write_pdf_script() {
  if [[ -e "${pdf_script}" ]] && ! is_own_file "${pdf_script}" "${pdf_tag}"; then
    warn "${pdf_script} stammt nicht von Markdown Office – Dateimanager-Eintrag ${pdf_action} nicht angelegt."
    return 1
  fi
  local tmp_script
  tmp_script="$(mktemp "${state_dir}/.markdown-pdf.XXXXXX")" || return 1
  {
    echo '#!/usr/bin/env bash'
    echo "${pdf_tag}"
    echo "command=$(sh_quote "${command_path}")"
    echo "log=$(sh_quote "${pdf_log}")"
    cat <<'EOF'
# Converts the Markdown files a file manager hands over (Finder Quick Action, "Öffnen mit" entry,
# Nautilus/Nemo script) with the markdown-office command, one after the other, and reports the
# result as one desktop notification: started from a file manager there is no terminal that
# would show the command's output. The full output of the last run stays in the log above.
# Written by the Markdown Office bootstrap; update and uninstall replace or remove it.
# No -e: one broken note must not stop the others.
set -uo pipefail
title="Markdown-PDF"

notify() {
  local message="$1" urgency="$2"
  # Test hook: collect the messages instead of showing them.
  if [[ -n "${MDO_NOTIFY_LOG:-}" ]]; then
    printf '%s|%s\n' "${urgency}" "${message}" >>"${MDO_NOTIFY_LOG}"
    return 0
  fi
  if [[ "$(uname -s)" == "Darwin" ]]; then
    # The texts travel as arguments, never as AppleScript source: quotes in a file name stay text.
    /usr/bin/osascript -e 'on run argv' \
      -e 'display notification (item 1 of argv) with title (item 2 of argv)' \
      -e 'end run' "${message}" "${title}" >/dev/null 2>&1 || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send --app-name="${title}" --urgency="${urgency}" "${title}" "${message}" \
      >/dev/null 2>&1 || true
  fi
}

is_markdown() {
  case "$1" in
    *.[mM][dD] | *.[mM][aA][rR][kK][dD][oO][wW][nN]) return 0 ;;
    *) return 1 ;;
  esac
}

# The line that says why a conversion failed: the first error line, else the last line.
reason_of() {
  local reason
  reason="$(printf '%s\n' "$1" | grep -iE '^(error|fehler)' | head -n 1)"
  [[ -n "${reason}" ]] || reason="$(printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | tail -n 1)"
  printf '%s' "${reason}"
}

: >"${log}" 2>/dev/null || log=/dev/null
if [[ ! -x "${command}" ]]; then
  notify "Markdown Office ist nicht installiert (${command} fehlt)." critical
  exit 1
fi

converted=0
failed=0
skipped=0
remote=0
last_pdf=""
first_error=""
for note in "$@"; do
  if ! is_markdown "${note}"; then
    skipped=$((skipped + 1))
    printf 'Übersprungen (keine Markdown-Datei): %s\n' "${note}" >>"${log}"
    continue
  fi
  printf '== %s\n' "${note}" >>"${log}"
  if out="$("${command}" "${note}" 2>&1)"; then
    converted=$((converted + 1))
    # build.sh reports "✓ <pdf> erzeugt (PDF/A-3b)" and the skipped remote images; both lines
    # are a parse contract of the pipeline.
    last_pdf="$(printf '%s\n' "${out}" | sed -n 's/^✓ \(.*\) erzeugt (PDF\/A-3b)$/\1/p' | tail -n 1)"
    [[ -n "${last_pdf}" ]] || last_pdf="${note%.*}.pdf"
    n="$(printf '%s\n' "${out}" | sed -n 's/^Hinweis: \([0-9][0-9]*\) Remote-Bild.*/\1/p' | head -n 1)"
    remote=$((remote + ${n:-0}))
  else
    failed=$((failed + 1))
    [[ -n "${first_error}" ]] || first_error="${note##*/}: $(reason_of "${out}")"
  fi
  printf '%s\n' "${out}" >>"${log}"
done

if [[ $((converted + failed)) -eq 0 ]]; then
  notify "Keine Markdown-Datei ausgewählt (.md, .markdown)." critical
  exit 1
fi
if [[ "${failed}" -eq 0 ]]; then
  urgency="normal"
  if [[ "${converted}" -eq 1 ]]; then
    message="${last_pdf##*/} erstellt."
  else
    message="${converted} PDFs erstellt."
  fi
else
  urgency="critical"
  if [[ "${converted}" -eq 0 && "${failed}" -eq 1 ]]; then
    message="Fehler – ${first_error}"
  else
    message="${converted} PDF(s) erstellt, ${failed} fehlgeschlagen. ${first_error}"
  fi
fi
[[ "${skipped}" -eq 0 ]] || message="${message} ${skipped} Datei(en) übersprungen (kein Markdown)."
[[ "${remote}" -eq 0 ]] || message="${message} ${remote} Remote-Bild(er) übersprungen."
[[ "${failed}" -eq 0 ]] || message="${message} Protokoll: ${log}"
notify "${message}" "${urgency}"
[[ "${failed}" -eq 0 ]]
EOF
  } >"${tmp_script}"
  chmod 755 "${tmp_script}"
  mv "${tmp_script}" "${pdf_script}"
  record_add "F ${pdf_script}"
}

# macOS: a Quick Action (Automator service) shown in Finder's context menu for Markdown files
# only (NSSendFileTypes: the system's Markdown type). Built in the temp folder, both plists
# checked with plutil, then swapped in; Automator need not be opened to run it.
write_workflow() {
  [[ -n "${workflow_path}" ]] || return 0
  if [[ -e "${workflow_path}" ]] && ! owns_workflow "${workflow_path}"; then
    warn "${workflow_path} stammt nicht von Markdown Office – Quick Action nicht angelegt."
    return 0
  fi
  local stage="${tmp}/workflow/${pdf_action}.workflow" command_string
  mkdir -p "${stage}/Contents"
  # Run Shell Script with "Pass input: as arguments" (inputMethod 1): the files arrive as "$@".
  command_string="$(xml_escape "${pdf_tag}
exec /bin/bash $(sh_quote "${pdf_script}") \"\$@\"")"
  cat >"${stage}/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${pdf_action}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>net.daringfireball.markdown</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
EOF
  cat >"${stage}/Contents/document.wflow" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>521</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<false/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${command_string}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/bash</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>4E2F2C1A-6C1B-4B8E-9A51-2D7C3F0B6A01</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
				</array>
				<key>OutputUUID</key>
				<string>4E2F2C1A-6C1B-4B8E-9A51-2D7C3F0B6A02</string>
				<key>UUID</key>
				<string>4E2F2C1A-6C1B-4B8E-9A51-2D7C3F0B6A03</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict/>
				<key>isViewVisible</key>
				<integer>1</integer>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>presentationMode</key>
		<integer>11</integer>
		<key>processesInput</key>
		<integer>0</integer>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<integer>0</integer>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
EOF
  if ! plutil -lint -s "${stage}/Contents/Info.plist" "${stage}/Contents/document.wflow" >/dev/null; then
    warn "Quick Action ${pdf_action} ist fehlerhaft und wurde nicht angelegt."
    return 0
  fi
  make_dir_recorded "$(dirname "${workflow_path}")" || return 0
  rm -rf "${workflow_path}"
  mv "${stage}" "${workflow_path}"
  record_add "W ${workflow_path}"
  refresh_services
}

# Lets the services menu pick up a new, changed or removed Quick Action now, not at the next login.
refresh_services() {
  [[ -x /System/Library/CoreServices/pbs ]] || return 0
  /System/Library/CoreServices/pbs -update >/dev/null 2>&1 || true
}

# Linux: an application entry for text/markdown, so the file manager offers "Markdown-PDF" under
# "Öffnen mit"; %F hands over all selected files at once (one notification for all).
write_pdf_desktop_entry() {
  [[ -n "${pdf_desktop_path}" ]] || return 0
  if [[ -e "${pdf_desktop_path}" ]] && ! is_own_file "${pdf_desktop_path}" "${pdf_tag}"; then
    warn "${pdf_desktop_path} stammt nicht von Markdown Office – Eintrag Öffnen mit → ${pdf_action} nicht angelegt."
    return 0
  fi
  make_dir_recorded "$(dirname "${pdf_desktop_path}")" || return 0
  {
    echo "${pdf_tag}"
    echo "[Desktop Entry]"
    echo "Type=Application"
    echo "Name=${pdf_action}"
    echo "Comment=Markdown-Datei mit Markdown Office als PDF neben der Notiz speichern"
    echo "Exec=$(desktop_exec_arg "${pdf_script}") %F"
    if [[ -f "${install_dir}/${linux_bin}.png" ]]; then
      echo "Icon=$(printf '%s' "${install_dir}/${linux_bin}.png" | sed -e 's/\\/\\\\/g')"
    fi
    echo "Terminal=false"
    # Only a file action, not a program to start from the menu; "Öffnen mit" still lists it.
    echo "NoDisplay=true"
    echo "MimeType=text/markdown;"
    echo "${desktop_tag}"
  } >"${pdf_desktop_path}"
  record_add "F ${pdf_desktop_path}"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$(dirname "${pdf_desktop_path}")" >/dev/null 2>&1 || true
  fi
}

# Nautilus (GNOME Files) and Nemo (Cinnamon) list executables in their scripts folder under
# right-click → Scripts, for any file; the script skips what is not Markdown. Only for a file
# manager that is there (its data folder or its program), so nothing is created for nothing.
fm_script_paths() {
  [[ "${os}" == "Linux" ]] || return 0
  local fm
  for fm in nautilus nemo; do
    if [[ -d "${data_home}/${fm}" ]] || command -v "${fm}" >/dev/null 2>&1; then
      printf '%s\n' "${data_home}/${fm}/scripts/${pdf_action}"
    fi
  done
}

write_fm_scripts() {
  local path tmp_fm
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    if [[ -e "${path}" ]] && ! is_own_file "${path}" "${pdf_tag}"; then
      warn "${path} stammt nicht von Markdown Office – bleibt."
      continue
    fi
    make_dir_recorded "$(dirname "${path}")" || continue
    tmp_fm="$(mktemp "$(dirname "${path}")/.markdown-pdf.XXXXXX")" || continue
    printf '#!/bin/sh\n%s\nexec %s "$@"\n' "${pdf_tag}" "$(sh_quote "${pdf_script}")" >"${tmp_fm}"
    chmod 755 "${tmp_fm}"
    mv "${tmp_fm}" "${path}"
    record_add "F ${path}"
  done < <(fm_script_paths)
}

# Linux: the editor's entry and Markdown-PDF both claim text/markdown. Without a chosen default
# the desktop picks one of them in no defined order (GIO took Markdown-PDF in CI), so a
# double-click could convert a note instead of opening it. When the user has no default for
# text/markdown yet, the editor becomes it explicitly (mimeapps.list, [Default Applications]);
# recorded as "M <file>", and uninstall removes exactly this line again. A default the user
# chose is never touched.
readonly mime_default_line="text/markdown=markdown-office.desktop"

has_markdown_default() {
  [[ -f "${mimeapps_path}" ]] &&
    awk '/^\[/ { s = ($0 == "[Default Applications]") } s && /^text\/markdown=/ { f = 1 } END { exit !f }' \
      "${mimeapps_path}"
}

pin_editor_default() {
  [[ -n "${mimeapps_path}" ]] || return 0
  is_own_file "${desktop_path}" "${desktop_tag}" || return 0
  has_markdown_default && return 0
  make_dir_recorded "$(dirname "${mimeapps_path}")" || return 0
  local new
  if [[ -f "${mimeapps_path}" ]] && grep -qxF '[Default Applications]' "${mimeapps_path}"; then
    new="$(awk -v line="${mime_default_line}" '{ print } $0 == "[Default Applications]" && !done { print line; done = 1 }' "${mimeapps_path}")"
  elif [[ -s "${mimeapps_path}" ]]; then
    new="$(cat "${mimeapps_path}")"$'\n\n[Default Applications]\n'"${mime_default_line}"
  else
    new="[Default Applications]"$'\n'"${mime_default_line}"
  fi
  # Written in place, so a symlinked mimeapps.list (dotfiles) stays a symlink.
  printf '%s\n' "${new}" >"${mimeapps_path}" || return 0
  record_add "M ${mimeapps_path}"
}

# Removes the line pin_editor_default added (only that exact line in [Default Applications]);
# a file left with nothing but that empty section goes too.
unpin_editor_default() {
  local path="$1" new
  [[ -f "${path}" ]] || return 0
  new="$(awk -v line="${mime_default_line}" '/^\[/ { s = ($0 == "[Default Applications]") } !(s && $0 == line) { print }' "${path}")"
  if ! grep -qv -e '^[[:space:]]*$' -e '^\[Default Applications\]$' <<<"${new}"; then
    rm -f "${path}"
  else
    printf '%s\n' "${new}" >"${path}"
  fi
  say "Standardprogramm-Eintrag für Markdown entfernt: ${path}"
}

write_file_manager() {
  write_pdf_script || return 0
  if [[ "${os}" == "Darwin" ]]; then
    write_workflow
  else
    write_pdf_desktop_entry
    pin_editor_default
    write_fm_scripts
  fi
}

# Removes one recorded entry if it is still ours; anything else stays with a warning. Only the
# names this bootstrap uses are accepted, so an edited record cannot point anywhere else.
remove_recorded() {
  local kind="$1" path="$2"
  case "${kind}:${path##*/}" in
    "W:${pdf_action}.workflow")
      if owns_workflow "${path}"; then
        rm -rf "${path}"
        say "Quick Action entfernt: ${path}"
        refresh_services
      elif [[ -e "${path}" ]]; then
        warn "${path} stammt nicht von Markdown Office – bleibt."
      fi
      ;;
    "F:markdown-pdf.sh" | "F:markdown-office-pdf.desktop" | "F:${pdf_action}")
      if is_own_file "${path}" "${pdf_tag}"; then
        rm -f "${path}"
        say "Dateimanager-Eintrag entfernt: ${path}"
        if [[ "${path}" == *.desktop ]] && command -v update-desktop-database >/dev/null 2>&1; then
          update-desktop-database "$(dirname "${path}")" >/dev/null 2>&1 || true
        fi
      elif [[ -e "${path}" ]]; then
        warn "${path} stammt nicht von Markdown Office – bleibt."
      fi
      ;;
    "M:mimeapps.list") unpin_editor_default "${path}" ;;
    D:*) rmdir "${path}" 2>/dev/null || true ;;
    *) warn "Unbekannter Eintrag in ${record} – übergangen: ${kind} ${path}" ;;
  esac
}

# Files, bundles and the default line first, then the created folders, deepest first. Without a record (an install
# from before this feature, or a lost record) the default places are checked, each removed only
# while it carries the tag.
remove_file_manager() {
  local line
  {
    [[ ! -f "${record}" ]] || grep -E '^[FWM] ' "${record}" || true
    printf 'F %s\n' "${pdf_script}"
    [[ -z "${workflow_path}" ]] || printf 'W %s\n' "${workflow_path}"
    [[ -z "${pdf_desktop_path}" ]] || printf 'F %s\n' "${pdf_desktop_path}"
    if [[ "${os}" == "Linux" ]]; then
      printf 'F %s\n' "${data_home}/nautilus/scripts/${pdf_action}" "${data_home}/nemo/scripts/${pdf_action}"
    fi
  } | awk '!seen[$0]++' | while IFS= read -r line; do
    [[ -e "${line#? }" ]] || continue
    remove_recorded "${line%% *}" "${line#? }"
  done
  if [[ -f "${record}" ]]; then
    { grep -E '^D ' "${record}" || true; } | awk '{ print length($0) "\t" $0 }' | sort -rn | cut -f 2- |
      while IFS= read -r line; do
        remove_recorded D "${line#D }"
      done
  fi
  rm -f "${record}" "${pdf_log}"
}

check_path() {
  case ":${PATH}:" in
    *":${bin_dir}:"*) ;;
    *)
      warn "${bin_dir} ist nicht im PATH – der Befehl markdown-office wird so nicht gefunden."
      echo "  Diese Zeile in ~/.zshrc bzw. ~/.bashrc ergänzen:" >&2
      # shellcheck disable=SC2016 # printed literally for the user's shell profile
      echo '  export PATH="$HOME/.local/bin:$PATH"' >&2
      ;;
  esac
}

check_linux_runtime() {
  [[ "${os}" == "Linux" ]] || return 0
  # Ubuntu 24.04+ blocks the unprivileged user namespaces Chromium's sandbox needs; the
  # extracted app then exits right away (its chrome-sandbox fallback is not setuid root).
  # The narrow fix is an AppArmor profile for this one executable, as Ubuntu ships for
  # browsers and editors.
  local userns
  userns="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || true)"
  [[ "${userns}" == "1" ]] || return 0
  warn "AppArmor sperrt unprivilegierte User-Namespaces (Ubuntu 24.04+) – der Editor startet so nicht (die PDF-Erzeugung läuft)."
  echo "  Abhilfe: ein AppArmor-Profil nur für Markdown Office anlegen (braucht sudo):" >&2
  echo "    sudo tee /etc/apparmor.d/markdown-office >/dev/null <<'EOF'" >&2
  echo "    abi <abi/4.0>," >&2
  echo "    include <tunables/global>" >&2
  echo "    profile markdown-office \"${app_exe}\" flags=(unconfined) {" >&2
  echo "      userns," >&2
  echo "      include if exists <local/markdown-office>" >&2
  echo "    }" >&2
  echo "    EOF" >&2
  echo "    sudo apparmor_parser -r /etc/apparmor.d/markdown-office" >&2
  echo "  Startprotokoll bei Problemen: ${log_path}" >&2
}

do_install() {
  if [[ -e "${install_dir}" ]] && ! owns_dir "${install_dir}"; then
    refuse_foreign "${install_dir}"
  fi
  if [[ -n "${MDO_ARCHIVE:-}" ]]; then
    [[ -f "${MDO_ARCHIVE}" ]] || die 2 "MDO_ARCHIVE nicht gefunden: ${MDO_ARCHIVE}"
    archive="${MDO_ARCHIVE}"
    say "Installiere aus lokalem Archiv ${archive} (ohne Prüfsumme)"
  else
    command -v curl >/dev/null 2>&1 || die 3 "curl nicht gefunden – bitte zuerst installieren."
    download_release
  fi

  if [[ -e "${install_dir}" ]]; then
    refuse_running
    say "Aktualisiere ${install_dir}"
  else
    say "Installiere nach ${install_dir}"
  fi
  stage_install
  swap_install
  write_launcher
  write_desktop_entry
  write_file_manager
  ok "Markdown Office installiert: ${install_dir}"
  ok "Befehl: ${command_path}"
  if [[ "${os}" == "Darwin" ]]; then
    ok "Finder: Rechtsklick auf eine .md-Datei → Schnelle Aktionen → ${pdf_action}"
  else
    ok "Dateimanager: Rechtsklick auf eine .md-Datei → Öffnen mit → ${pdf_action}"
  fi
  check_path
  check_linux_runtime
  echo "Fertig. Editor: markdown-office --app [notiz.md] – PDF: markdown-office notiz.md"
}

# --- Uninstall ----------------------------------------------------------------

remove_own_entries() {
  if is_own_file "${command_path}" "${launcher_tag}"; then
    rm -f "${command_path}"
    say "Befehl entfernt: ${command_path}"
  elif [[ -e "${command_path}" ]]; then
    warn "${command_path} stammt nicht von Markdown Office – bleibt."
  fi
  if [[ -n "${desktop_path}" ]]; then
    if is_own_file "${desktop_path}" "${desktop_tag}"; then
      rm -f "${desktop_path}"
      say "Menüeintrag entfernt: ${desktop_path}"
      if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$(dirname "${desktop_path}")" >/dev/null 2>&1 || true
      fi
    elif [[ -e "${desktop_path}" ]]; then
      warn "${desktop_path} stammt nicht von Markdown Office – bleibt."
    fi
  fi
}

# A leftover <install>.old from an interrupted update; checked while the marker exists.
remove_old() {
  local old="${install_dir}.old"
  [[ -e "${old}" ]] || return 0
  if owns_dir "${old}"; then
    rm -rf "${old}" || die 6 "Konnte ${old} nicht löschen."
    say "Rest eines früheren Laufs entfernt: ${old}"
  else
    warn "${old} ist keine Markdown-Office-Installation dieses Skripts – bleibt."
  fi
}

# Marker (macOS) and launch log live outside the app; drop them and the state folder
# if it is now empty (on Linux the marker went with the app folder).
remove_state() {
  [[ "${os}" != "Darwin" ]] || rm -f "${marker}"
  rm -f "${log_path}"
  rmdir "${state_dir}" 2>/dev/null || true
}

do_uninstall() {
  if [[ ! -e "${install_dir}" ]]; then
    echo "Nichts zu deinstallieren: ${install_dir} existiert nicht."
    remove_old
    remove_own_entries
    remove_file_manager
    remove_state
    exit 0
  fi
  owns_dir "${install_dir}" || refuse_foreign "${install_dir}"
  refuse_running
  remove_old
  say "Lösche ${install_dir}"
  rm -rf "${install_dir}" || die 6 "Konnte ${install_dir} nicht vollständig löschen."
  remove_own_entries
  remove_file_manager
  remove_state
  ok "Markdown Office deinstalliert. Dokumente, Vorlagen-Sets, Snippets und Einstellungen bleiben unangetastet."
}

# --- Main ---------------------------------------------------------------------

main() {
  local action="install"
  want_pre="false"
  want_version=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pre) want_pre="true" ;;
      --version)
        [[ $# -ge 2 && -n "$2" ]] || die 2 "--version braucht eine Versionsnummer (z. B. 26.10.0)."
        want_version="${2#v}"
        shift
        ;;
      --version=*)
        want_version="${1#--version=}"
        want_version="${want_version#v}"
        ;;
      --uninstall | uninstall) action="uninstall" ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        die 2 "unbekannte Option ${1}"
        ;;
    esac
    shift
  done
  if [[ "${want_pre}" == "true" && -n "${want_version}" ]]; then
    die 2 "--pre und --version schließen sich aus."
  fi
  if [[ -n "${want_version}" ]] && ! [[ "${want_version}" =~ ${version_re} ]]; then
    die 2 "Ungültige Version ${want_version} (erwartet z. B. 26.10.0 oder 26.10.0-dev.1)."
  fi

  detect_platform
  if [[ "${action}" == "uninstall" ]]; then
    do_uninstall
    return
  fi

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/markdown-office-bootstrap.XXXXXX")"
  stage_root=""
  trap 'rm -rf "${tmp}"; [[ -z "${stage_root}" ]] || rm -rf "${stage_root}"' EXIT
  do_install
}

# scripts/test-file-manager.sh sources this file to test the generators on their own, without an
# archive; then only the functions are defined. Any normal run (also curl | bash) calls main.
[[ "${MDO_BOOTSTRAP_SOURCE_ONLY:-}" == "1" ]] || main "$@"
