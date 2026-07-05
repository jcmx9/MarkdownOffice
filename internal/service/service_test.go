package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jcmx9/MarkdownOffice/internal/frontmatter"
	"github.com/jcmx9/MarkdownOffice/internal/pipeline"
)

// fakeRunner captures the compile-directory contents and writes a stub PDF.
type fakeRunner struct{ files map[string]string }

func (f *fakeRunner) Compile(_ context.Context, workdir, entrypoint, outPath string) error {
	f.files = map[string]string{}
	entries, _ := os.ReadDir(workdir)
	for _, e := range entries {
		b, _ := os.ReadFile(filepath.Join(workdir, e.Name()))
		f.files[e.Name()] = string(b)
	}
	return os.WriteFile(outPath, []byte("%PDF-svc"), 0o644)
}

const validMD = `---
name: Musterfirma
street: Musterstraße 1
zip: 12345
city: Musterstadt
recipient:
  - Firma GmbH
subject: Hallo
---

Sehr geehrte Damen und Herren,

Hallo **Welt**.
`

func TestRenderMarkdownReturnsPDFAndPassesParsedInput(t *testing.T) {
	fr := &fakeRunner{}
	svc := New("26.4.35", fr)

	pdf, err := svc.RenderMarkdown(context.Background(), validMD)
	if err != nil {
		t.Fatalf("RenderMarkdown: %v", err)
	}
	if string(pdf) != "%PDF-svc" {
		t.Errorf("returned %q, want the runner's PDF", pdf)
	}
	// The full source is embedded verbatim; the body (not the frontmatter) feeds cmarker.
	if fr.files["brief.md"] != validMD {
		t.Errorf("brief.md is not the verbatim source")
	}
	if !strings.Contains(fr.files["body.md"], "Hallo **Welt**") || strings.Contains(fr.files["body.md"], "name:") {
		t.Errorf("body.md wrong: %q", fr.files["body.md"])
	}
}

func TestRenderMarkdownPropagatesParseError(t *testing.T) {
	svc := New("26.4.35", &fakeRunner{})
	_, err := svc.RenderMarkdown(context.Background(), "kein frontmatter hier\n")
	if err == nil {
		t.Fatal("expected an error")
	}
	var pe *frontmatter.ParseError
	if !errors.As(err, &pe) {
		t.Errorf("want *frontmatter.ParseError, got %T", err)
	}
}

func TestRenderMarkdownResolvesSignature(t *testing.T) {
	const mdWithSig = `---
name: A
street: S
zip: 1
city: C
signature: unterschrift.svg
recipient:
  - R
---

Body
`
	fr := &fakeRunner{}
	var askedFor string
	resolver := func(name string) ([]byte, error) {
		askedFor = name
		return []byte("<svg/>"), nil
	}
	svc := New("26.4.35", fr, WithSignatureResolver(resolver))

	if _, err := svc.RenderMarkdown(context.Background(), mdWithSig); err != nil {
		t.Fatalf("RenderMarkdown: %v", err)
	}
	if askedFor != "unterschrift.svg" {
		t.Errorf("resolver asked for %q, want unterschrift.svg", askedFor)
	}
	if fr.files["unterschrift.svg"] != "<svg/>" {
		t.Errorf("signature bytes not written into the compile dir")
	}
}

func TestRenderMarkdownDropsSignatureWhenUnresolvable(t *testing.T) {
	const mdWithSig = "---\nname: A\nstreet: S\nzip: 1\ncity: C\nsignature: unterschrift.svg\nrecipient:\n  - R\n---\n\nBody\n"
	fr := &fakeRunner{}
	svc := New("26.4.35", fr) // no signature resolver configured

	if _, err := svc.RenderMarkdown(context.Background(), mdWithSig); err != nil {
		t.Fatalf("RenderMarkdown: %v", err)
	}
	// Without a resolver the letter must render *without* a signature — the
	// generated brief.json must not reference a file that was never written,
	// otherwise Typst's read() aborts the compile.
	if strings.Contains(fr.files["brief.json"], "unterschrift.svg") {
		t.Errorf("brief.json references an unprovided signature file:\n%s", fr.files["brief.json"])
	}
	if _, ok := fr.files["unterschrift.svg"]; ok {
		t.Errorf("a signature file was written although none was resolvable")
	}
}

// TestRenderMarkdownEndToEnd runs the real Typst binary against vendored assets.
// Skipped unless MDO_TESTDATA points at a dir with pkgs/, cache/ and fonts/.
func TestRenderMarkdownEndToEnd(t *testing.T) {
	td := os.Getenv("MDO_TESTDATA")
	if td == "" {
		t.Skip("set MDO_TESTDATA to run the end-to-end test")
	}
	runner := pipeline.NewTypstRunner("typst", pipeline.TypstEnv{
		PackagePath:      filepath.Join(td, "pkgs"),
		PackageCachePath: filepath.Join(td, "cache"),
		FontPath:         filepath.Join(td, "fonts"),
	})
	svc := New("26.4.35", runner)
	pdf, err := svc.RenderMarkdown(context.Background(), validMD)
	if err != nil {
		t.Fatalf("end-to-end RenderMarkdown: %v", err)
	}
	if !strings.HasPrefix(string(pdf), "%PDF") || !strings.Contains(string(pdf), "pdfaid:part") {
		t.Errorf("output is not a PDF/A")
	}
}
