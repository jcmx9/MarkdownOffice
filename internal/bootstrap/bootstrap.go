// Package bootstrap materializes the embedded runtime assets (Typst binary,
// fonts, Typst packages) into the user's data directory on first run, so the
// tool works without a system Typst.
package bootstrap

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
)

// Runtime holds the on-disk paths of the extracted assets, ready to feed into a
// pipeline Typst runner.
type Runtime struct {
	TypstBin    string // the extracted Typst executable
	PackagePath string // TYPST_PACKAGE_PATH (contains local/<name>/<version>/)
	CachePath   string // TYPST_PACKAGE_CACHE_PATH (contains preview/<name>/<version>/)
	FontPath    string // --font-path
}

// Extract writes typstBin and the support tree (fonts/, pkgs/, cache/) under
// root/<version>/. It is idempotent: once a ready marker exists the extraction
// is skipped and the paths are returned as-is. A partially written directory
// (no marker) is rebuilt from scratch.
func Extract(root, version string, typstBin []byte, support fs.FS) (Runtime, error) {
	dst := filepath.Join(root, version)
	rt := Runtime{
		TypstBin:    filepath.Join(dst, "bin", typstName()),
		PackagePath: filepath.Join(dst, "pkgs"),
		CachePath:   filepath.Join(dst, "cache"),
		FontPath:    filepath.Join(dst, "fonts"),
	}

	marker := filepath.Join(dst, ".ready")
	if _, err := os.Stat(marker); err == nil {
		return rt, nil
	}

	// Rebuild from scratch to self-heal any partial previous extraction.
	if err := os.RemoveAll(dst); err != nil {
		return Runtime{}, fmt.Errorf("clean runtime dir: %w", err)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return Runtime{}, fmt.Errorf("create runtime dir: %w", err)
	}

	if support != nil {
		if err := os.CopyFS(dst, support); err != nil {
			return Runtime{}, fmt.Errorf("extract support assets: %w", err)
		}
	}

	if len(typstBin) > 0 {
		if err := os.MkdirAll(filepath.Dir(rt.TypstBin), 0o755); err != nil {
			return Runtime{}, err
		}
		if err := os.WriteFile(rt.TypstBin, typstBin, 0o755); err != nil {
			return Runtime{}, fmt.Errorf("write typst binary: %w", err)
		}
	}

	if err := os.WriteFile(marker, []byte(version), 0o644); err != nil {
		return Runtime{}, fmt.Errorf("write ready marker: %w", err)
	}
	return rt, nil
}

func typstName() string {
	if runtime.GOOS == "windows" {
		return "typst.exe"
	}
	return "typst"
}
