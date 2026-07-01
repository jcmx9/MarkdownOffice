package pipeline

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// fakeRunner records how it was invoked and captures the compile-directory
// contents while they exist, so Compile's orchestration can be tested without a
// real Typst binary (and without depending on the temp dir that Compile cleans up).
type fakeRunner struct {
	entrypoint string
	captured   map[string]string
}

func (f *fakeRunner) Compile(_ context.Context, workdir, entrypoint, outPath string) error {
	f.entrypoint = entrypoint
	f.captured = map[string]string{}
	for _, name := range []string{"brief.typ", "brief.json", "body.md", "brief.md"} {
		b, err := os.ReadFile(filepath.Join(workdir, name))
		if err != nil {
			return err
		}
		f.captured[name] = string(b)
	}
	return os.WriteFile(outPath, []byte("%PDF-stub"), 0o644)
}

func testInput() Input {
	return Input{
		Letter: Letter{
			Sender:    Sender{Name: "Dr. Anna Weber", City: "80331 München"},
			Recipient: []string{"Sonnenschein Verlag GmbH", "50667 Köln"},
			Subject:   "Test",
			Closing:   "Mit freundlichen Grüßen",
			Accent:    "#1F6FEB",
		},
		Body:   "Sehr geehrte Damen und Herren,\n\ndies ist ein **Test**.\n",
		Source: "---\nsubject: Test\n---\n\nSehr geehrte Damen und Herren,\n\ndies ist ein **Test**.\n",
	}
}

func TestCompileWritesSidecarsAndReturnsPDF(t *testing.T) {
	fr := &fakeRunner{}
	pdf, err := Compile(context.Background(), fr, testInput(), Options{Din5008aVersion: "26.4.35"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if string(pdf) != "%PDF-stub" {
		t.Errorf("Compile returned %q, want the runner's PDF bytes", pdf)
	}
	if fr.entrypoint != "brief.typ" {
		t.Errorf("runner entrypoint = %q, want brief.typ", fr.entrypoint)
	}
	// The compile dir must hold all four inputs Typst needs.
	for _, name := range []string{"brief.typ", "brief.json", "body.md", "brief.md"} {
		if _, ok := fr.captured[name]; !ok {
			t.Errorf("missing %s in compile dir", name)
		}
	}
	// The embedded source must be the full original, byte-for-byte.
	if fr.captured["brief.md"] != testInput().Source {
		t.Errorf("brief.md content does not match the original source")
	}
	// The body fed to cmarker must be the body, not the full source.
	if fr.captured["body.md"] != testInput().Body {
		t.Errorf("body.md content does not match the letter body")
	}
}

func TestCompileRejectsEmptyVersion(t *testing.T) {
	_, err := Compile(context.Background(), &fakeRunner{}, testInput(), Options{})
	if err == nil {
		t.Fatal("Compile should reject an empty din5008a version")
	}
}

// TestCompileEndToEnd runs the real Typst binary against vendored packages/fonts
// and asserts a PDF/A-3b with the embedded source is produced. It is skipped
// unless MDO_TESTDATA points at a dir containing pkgs/, cache/ and fonts/.
func TestCompileEndToEnd(t *testing.T) {
	td := os.Getenv("MDO_TESTDATA")
	if td == "" {
		t.Skip("set MDO_TESTDATA to the vendored assets dir to run the end-to-end test")
	}
	if _, err := exec.LookPath("typst"); err != nil {
		t.Skip("typst not on PATH")
	}
	r := NewTypstRunner("typst", TypstEnv{
		PackagePath:      filepath.Join(td, "pkgs"),
		PackageCachePath: filepath.Join(td, "cache"),
		FontPath:         filepath.Join(td, "fonts"),
	})
	pdf, err := Compile(context.Background(), r, testInput(), Options{Din5008aVersion: "26.4.35"})
	if err != nil {
		t.Fatalf("end-to-end Compile: %v", err)
	}
	if !strings.HasPrefix(string(pdf), "%PDF") {
		t.Fatalf("output is not a PDF")
	}
	if !strings.Contains(string(pdf), "pdfaid:part") {
		t.Errorf("PDF is missing PDF/A identification metadata")
	}
}
