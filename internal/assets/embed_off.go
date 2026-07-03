//go:build !embed_assets

package assets

import "io/fs"

// Available reports whether runtime assets are embedded. Without the
// `embed_assets` build tag they are not, and the caller uses a system Typst.
func Available() bool { return false }

// TypstBinary returns the embedded Typst executable bytes, or nil when not embedded.
func TypstBinary() []byte { return nil }

// SupportFS returns the embedded fonts/packages tree, or nil when not embedded.
func SupportFS() fs.FS { return nil }
