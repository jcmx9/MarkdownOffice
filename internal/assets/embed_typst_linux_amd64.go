//go:build embed_assets && linux && amd64

package assets

import _ "embed"

//go:embed dist/typst/linux_amd64/typst
var typstBinary []byte
