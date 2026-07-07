//go:build embed_assets && darwin && amd64

package assets

import _ "embed"

//go:embed dist/typst/darwin_amd64/typst
var typstBinary []byte
