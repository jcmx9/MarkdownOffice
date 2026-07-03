//go:build embed_assets && darwin && arm64

package assets

import _ "embed"

// typstBinary is the macOS/arm64 Typst executable. Adding another platform is
// mechanical: fetch it via `make assets` on that target and add a sibling file
// with the matching build constraint and embed path.
//
//go:embed dist/typst/darwin_arm64/typst
var typstBinary []byte
