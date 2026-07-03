// Package assets optionally embeds the Typst binary, fonts and Typst packages so
// the tool can run fully self-contained (offline, no system Typst).
//
// Embedding is gated by the build tag `embed_assets` (release builds, after
// `make assets` has populated internal/assets/dist). Without the tag, Available()
// returns false and callers fall back to a system Typst located via MDO_* env
// vars — this keeps `go build` and `go test` working without the ~45 MB assets.
package assets

// TypstVersion is the embedded/target Typst version; it also names the extracted
// runtime directory so upgrades re-extract cleanly.
const TypstVersion = "0.15.0"
