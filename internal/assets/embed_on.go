//go:build embed_assets

package assets

import (
	"embed"
	"io/fs"
)

// supportFiles holds the platform-independent assets: fonts and the Typst
// packages (@local under pkgs/, @preview cache under cache/).
//
//go:embed dist/fonts dist/pkgs dist/cache
var supportFiles embed.FS

// Available reports that runtime assets are embedded.
func Available() bool { return true }

// TypstBinary returns the embedded Typst executable (per-platform, see
// embed_typst_<os>_<arch>.go).
func TypstBinary() []byte { return typstBinary }

// SupportFS returns the fonts/packages tree rooted so that it contains
// fonts/, pkgs/ and cache/ at the top level.
func SupportFS() fs.FS {
	sub, err := fs.Sub(supportFiles, "dist")
	if err != nil {
		panic(err) // embed layout is fixed at build time
	}
	return sub
}
