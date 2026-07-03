#!/usr/bin/env bash
# Fetch the embedded runtime assets (Typst binary, fonts, Typst packages) into
# internal/assets/dist for the host GOOS/GOARCH. Run before `go build -tags embed_assets`.
# The dist/ tree is gitignored; this script makes the build reproducible.
set -euo pipefail

TYPST_VERSION="0.15.0"
DIN5008A_VERSION="26.4.35"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="${repo_root}/internal/assets/dist"

goos="$(go env GOOS)"
goarch="$(go env GOARCH)"

# Map GOOS/GOARCH → Typst release target triple + archive kind.
case "${goos}/${goarch}" in
  darwin/arm64) triple="aarch64-apple-darwin"; kind="tarxz" ;;
  darwin/amd64) triple="x86_64-apple-darwin"; kind="tarxz" ;;
  linux/amd64)  triple="x86_64-unknown-linux-musl"; kind="tarxz" ;;
  linux/arm64)  triple="aarch64-unknown-linux-musl"; kind="tarxz" ;;
  windows/amd64) triple="x86_64-pc-windows-msvc"; kind="zip" ;;
  windows/arm64) triple="aarch64-pc-windows-msvc"; kind="zip" ;;
  *) echo "unsupported target ${goos}/${goarch}" >&2; exit 1 ;;
esac

typst_bin="typst"
[ "${goos}" = "windows" ] && typst_bin="typst.exe"
typst_out_dir="${dist}/typst/${goos}_${goarch}"

mkdir -p "${typst_out_dir}" \
  "${dist}/pkgs/local/din5008a/${DIN5008A_VERSION}" \
  "${dist}/pkgs/local/cmarker/0.1.9" \
  "${dist}/pkgs/local/zero/0.6.1" \
  "${dist}/cache/preview/cades/0.3.1" \
  "${dist}/cache/preview/jogs/0.2.4" \
  "${dist}/fonts"

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

echo "→ Typst ${TYPST_VERSION} (${triple})"
base="https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${triple}"
if [ "${kind}" = "tarxz" ]; then
  curl -fsSL "${base}.tar.xz" | tar -xJ -C "${tmp}"
  cp "${tmp}/typst-${triple}/typst" "${typst_out_dir}/${typst_bin}"
else
  curl -fsSL -o "${tmp}/typst.zip" "${base}.zip"
  (cd "${tmp}" && unzip -q typst.zip)
  cp "${tmp}/typst-${triple}/typst.exe" "${typst_out_dir}/${typst_bin}"
fi
chmod +x "${typst_out_dir}/${typst_bin}"

echo "→ Typst-Pakete (@local + @preview-Cache)"
curl -fsSL "https://packages.typst.org/preview/cmarker-0.1.9.tar.gz" | tar -xz -C "${dist}/pkgs/local/cmarker/0.1.9"
curl -fsSL "https://packages.typst.org/preview/zero-0.6.1.tar.gz"    | tar -xz -C "${dist}/pkgs/local/zero/0.6.1"
curl -fsSL "https://packages.typst.org/preview/cades-0.3.1.tar.gz"   | tar -xz -C "${dist}/cache/preview/cades/0.3.1"
curl -fsSL "https://packages.typst.org/preview/jogs-0.2.4.tar.gz"    | tar -xz -C "${dist}/cache/preview/jogs/0.2.4"
curl -fsSL "https://github.com/jcmx9/typst-DIN5008a/archive/refs/tags/v${DIN5008A_VERSION}.tar.gz" \
  | tar -xz -C "${dist}/pkgs/local/din5008a/${DIN5008A_VERSION}" --strip-components=1

echo "→ Fonts (statische Source-Instanzen)"
fetch_font_zip() {
  local url="$1"
  curl -fsSL -o "${tmp}/font.zip" "${url}"
  (cd "${tmp}" && unzip -qo font.zip -d fontzip)
  find "${tmp}/fontzip" -type f \( -iname 'SourceSerif4-*.otf' -o -iname 'SourceSans3-*.otf' -o -iname 'SourceCodePro-*.otf' \) \
    -exec cp {} "${dist}/fonts/" \;
  rm -rf "${tmp}/fontzip" "${tmp}/font.zip"
}
fetch_font_zip "https://github.com/adobe-fonts/source-serif/releases/download/4.005R/source-serif-4.005_Desktop.zip"
fetch_font_zip "https://github.com/adobe-fonts/source-sans/releases/download/3.052R/OTF-source-sans-3.052R.zip"
fetch_font_zip "https://github.com/adobe-fonts/source-code-pro/releases/download/2.042R-u/1.062R-i/1.026R-vf/OTF-source-code-pro-2.042R-u_1.062R-i.zip"

echo "✓ Assets in ${dist}"
echo "  typst:  $(ls "${typst_out_dir}")"
echo "  fonts:  $(ls "${dist}/fonts" | wc -l | tr -d ' ') Dateien"
