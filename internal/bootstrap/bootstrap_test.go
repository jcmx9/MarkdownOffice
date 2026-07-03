package bootstrap

import (
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestExtractWritesRuntimeAndIsIdempotent(t *testing.T) {
	support := fstest.MapFS{
		"fonts/Foo.otf":             {Data: []byte("font")},
		"pkgs/local/x/1.0/lib.typ":  {Data: []byte("pkg")},
		"cache/preview/y/2.0/z.typ": {Data: []byte("cache")},
	}
	root := t.TempDir()

	rt, err := Extract(root, "0.15.0", []byte("TYPST-BIN"), support)
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}

	// Typst binary written and executable.
	b, err := os.ReadFile(rt.TypstBin)
	if err != nil || string(b) != "TYPST-BIN" {
		t.Fatalf("typst binary: err=%v content=%q", err, b)
	}
	if fi, _ := os.Stat(rt.TypstBin); fi.Mode()&0o100 == 0 {
		t.Errorf("typst binary not executable: %v", fi.Mode())
	}

	// Support tree extracted under the returned paths.
	if got, _ := os.ReadFile(filepath.Join(rt.FontPath, "Foo.otf")); string(got) != "font" {
		t.Errorf("font not extracted at FontPath")
	}
	if _, err := os.Stat(filepath.Join(rt.PackagePath, "local/x/1.0/lib.typ")); err != nil {
		t.Errorf("package not extracted at PackagePath: %v", err)
	}
	if _, err := os.Stat(filepath.Join(rt.CachePath, "preview/y/2.0/z.typ")); err != nil {
		t.Errorf("preview cache not extracted at CachePath: %v", err)
	}

	// Idempotent: a second call returns the same paths and does not error.
	rt2, err := Extract(root, "0.15.0", []byte("TYPST-BIN"), support)
	if err != nil {
		t.Fatalf("second Extract: %v", err)
	}
	if rt2 != rt {
		t.Errorf("paths differ on second call: %+v vs %+v", rt2, rt)
	}
}
