//go:build embed_assets && linux && arm64

package assets

import _ "embed"

//go:embed dist/typst/linux_arm64/typst
var typstBinary []byte
