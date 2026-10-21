#!/usr/bin/env bash
# Baut das Entwicklungs-Layout build/pipeline-dev/ auf, das dem gepackten
# Layout der App entspricht (<resources>/pipeline und <resources>/sets):
#
#   build/pipeline-dev/pipeline/build.sh     -> pipeline/build.sh
#   build/pipeline-dev/pipeline/convert.ps1  -> pipeline/convert.ps1
#   build/pipeline-dev/pipeline/cli.js       (Kopie, schreibt `npm run build:cli`)
#   build/pipeline-dev/pipeline/lib          -> pipeline/lib
#   build/pipeline-dev/pipeline/example.md   -> pipeline/example.md
#   build/pipeline-dev/pipeline/logo.svg     -> pipeline/logo.svg
#   build/pipeline-dev/pipeline/bin/typst    -> build/pipeline-assets/<os>-<arch>/typst
#   build/pipeline-dev/pipeline/fonts        -> build/pipeline-assets/fonts
#   build/pipeline-dev/pipeline/vendor       -> build/pipeline-assets/vendor
#   build/pipeline-dev/pipeline/licenses     -> build/pipeline-assets/licenses (falls vorhanden)
#   build/pipeline-dev/sets                  -> build/pipeline-assets/sets
#
# cli.js wird aus src/cli/ gebündelt; der CLI-Build (vite.cli.config.mts)
# legt die Kopie hier ab, sobald dieses Layout existiert (npm run assets ruft
# ihn danach auf). Ein Link auf out/cli/cli.js wäre unter Git Bash eine
# veraltende Kopie. Weil dieses Skript das Layout neu anlegt (auch aus
# test-pdf.sh/test-equivalence.sh), übernimmt es eine vorhandene
# out/cli/cli.js – sonst fehlte cli.js danach bis zum nächsten CLI-Build.
# Der Rest sind symbolische Links: Änderungen an pipeline/ wirken sofort. Unter
# Git Bash (Windows) legt ln -s Kopien an; dann nach Änderungen an pipeline/
# erneut ausführen (npm run assets ruft das Skript auf). Die
# Skripte kennen nur MDO_PIPELINE_ROOT und MDO_SETS_DIR; beide zeigen auf
# dieses Layout (Standard ohne Variablen: Ordner des Skripts bzw. ../sets).
# Voraussetzung: build/pipeline-assets/ ist befüllt (npm run assets).
#
# Usage: bash pipeline/tests/dev-layout.sh
#   Gibt den Layout-Ordner (build/pipeline-dev) auf stdout aus.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly repo_dir
readonly assets="${repo_dir}/build/pipeline-assets"
readonly dev="${repo_dir}/build/pipeline-dev"

die() {
  printf 'FEHLER: %s\n' "$*" >&2
  exit 1
}

host_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="mac" ;;
    Linux) os="linux" ;;
    MINGW* | MSYS* | CYGWIN*) os="win" ;;
    *) die "unbekanntes Betriebssystem: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch="arm64" ;;
    x86_64 | amd64) arch="x64" ;;
    *) die "unbekannte Architektur: $(uname -m)" ;;
  esac
  printf '%s-%s' "${os}" "${arch}"
}

platform="$(host_platform)"
typst_name="typst"
[[ "${platform}" == win-* ]] && typst_name="typst.exe"
typst_src="${assets}/${platform}/${typst_name}"

for p in "${typst_src}" "${assets}/fonts" "${assets}/vendor" "${assets}/sets/memo/memo.typ"; do
  [[ -e "${p}" ]] || die "fehlt: ${p} – zuerst 'npm run assets' ausführen"
done

rm -rf "${dev}"
mkdir -p "${dev}/pipeline/bin"
for f in build.sh convert.ps1 lib example.md logo.svg; do
  ln -s "${repo_dir}/pipeline/${f}" "${dev}/pipeline/${f}"
done
# Dieselbe Datei, die der CLI-Build zuletzt geschrieben hat (siehe oben).
if [[ -f "${repo_dir}/out/cli/cli.js" ]]; then cp "${repo_dir}/out/cli/cli.js" "${dev}/pipeline/cli.js"; fi
ln -s "${typst_src}" "${dev}/pipeline/bin/${typst_name}"
ln -s "${assets}/fonts" "${dev}/pipeline/fonts"
ln -s "${assets}/vendor" "${dev}/pipeline/vendor"
# Die Pipeline selbst braucht die Lizenztexte nicht; ältere Assets ohne sie bleiben nutzbar.
if [[ -d "${assets}/licenses" ]]; then ln -s "${assets}/licenses" "${dev}/pipeline/licenses"; fi
ln -s "${assets}/sets" "${dev}/sets"

printf '%s\n' "${dev}"
