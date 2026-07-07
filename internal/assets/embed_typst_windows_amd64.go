//go:build embed_assets && windows && amd64

package assets

import _ "embed"

//go:embed dist/typst/windows_amd64/typst.exe
var typstBinary []byte
