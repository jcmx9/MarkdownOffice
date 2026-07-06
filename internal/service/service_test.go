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
	"github.com/jcmx9/MarkdownOffice/internal/profiles"
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

// fakeProfiles is an in-memory Profiles for handler tests.
type fakeProfiles struct {
	prof     *profiles.Profile
	sig      []byte
	sigExt   string
	loadErr  error
	askedFor string
}

func (f *fakeProfiles) Load(name string) (*profiles.Profile, error) {
	f.askedFor = name
	if f.loadErr != nil {
		return nil, f.loadErr
	}
	return f.prof, nil
}

func (f *fakeProfiles) Signature(string) ([]byte, string, error) { return f.sig, f.sigExt, nil }

func sampleProfile() *profiles.Profile {
	return &profiles.Profile{
		Name: "Musterfirma", Street: "Musterstraße 1", Zip: "10115", City: "Berlin",
		Email: "info@muster.de", Bank: &profiles.Bank{IBAN: "DE1", BIC: "BIC", BankName: "Bank"},
		PrintQR: true, Accent: "#103C78",
	}
}

const validMD = `---
profile: default
recipient:
  name: Firma GmbH
  street: Weg 1
  zip: 12345
  city: Musterstadt
subject: Hallo
---

Sehr geehrte Damen und Herren,

Hallo **Welt**.
`

func TestRenderMapsProfileAndRecipient(t *testing.T) {
	fr := &fakeRunner{}
	fp := &fakeProfiles{prof: sampleProfile()}
	svc := New("26.4.35", fr, WithProfiles(fp))

	pdf, err := svc.RenderMarkdown(context.Background(), validMD)
	if err != nil {
		t.Fatalf("RenderMarkdown: %v", err)
	}
	if string(pdf) != "%PDF-svc" {
		t.Errorf("returned %q", pdf)
	}
	bj := fr.files["brief.json"]
	for _, want := range []string{"Musterfirma", "10115 Berlin", "Firma GmbH", "12345 Musterstadt", "#103C78", "DE1"} {
		if !strings.Contains(bj, want) {
			t.Errorf("brief.json missing %q:\n%s", want, bj)
		}
	}
	if fr.files["brief.md"] != validMD {
		t.Error("brief.md is not the verbatim source")
	}
}

func TestRenderDefaultsProfileName(t *testing.T) {
	fp := &fakeProfiles{prof: sampleProfile()}
	svc := New("26.4.35", &fakeRunner{}, WithProfiles(fp))
	// Frontmatter without a profile → the service asks for "default".
	src := "---\nrecipient:\n  name: N\n  street: S\n  zip: 1\n  city: C\nsubject: S\n---\n\nB\n"
	if _, err := svc.RenderMarkdown(context.Background(), src); err != nil {
		t.Fatal(err)
	}
	if fp.askedFor != "default" {
		t.Errorf("asked for %q, want default", fp.askedFor)
	}
}

func TestRenderPropagatesParseError(t *testing.T) {
	svc := New("26.4.35", &fakeRunner{}, WithProfiles(&fakeProfiles{prof: sampleProfile()}))
	_, err := svc.RenderMarkdown(context.Background(), "kein frontmatter\n")
	if !errors.As(err, new(*frontmatter.ParseError)) {
		t.Errorf("want *frontmatter.ParseError, got %T", err)
	}
}

func TestRenderPropagatesProfileError(t *testing.T) {
	fp := &fakeProfiles{loadErr: &profiles.ProfileError{Message: "Profil wurde nicht gefunden.", Name: "default"}}
	svc := New("26.4.35", &fakeRunner{}, WithProfiles(fp))
	_, err := svc.RenderMarkdown(context.Background(), validMD)
	if !errors.As(err, new(*profiles.ProfileError)) {
		t.Errorf("want *profiles.ProfileError, got %T (%v)", err, err)
	}
}

func TestRenderNoStore(t *testing.T) {
	svc := New("26.4.35", &fakeRunner{}) // no WithProfiles
	if _, err := svc.RenderMarkdown(context.Background(), validMD); err == nil {
		t.Error("expected an error without a profile store")
	}
}

func TestRenderSignatureWhenSigning(t *testing.T) {
	prof := sampleProfile()
	prof.Signature = "signature.svg"
	fr := &fakeRunner{}
	fp := &fakeProfiles{prof: prof, sig: []byte("<svg/>"), sigExt: ".svg"}
	svc := New("26.4.35", fr, WithProfiles(fp))

	src := strings.Replace(validMD, "subject: Hallo\n", "subject: Hallo\nsign: true\n", 1)
	if _, err := svc.RenderMarkdown(context.Background(), src); err != nil {
		t.Fatal(err)
	}
	if fr.files["signature.svg"] != "<svg/>" {
		t.Error("signature bytes not written into the compile dir")
	}
	if !strings.Contains(fr.files["brief.json"], "signature.svg") {
		t.Errorf("brief.json does not reference the signature:\n%s", fr.files["brief.json"])
	}
}

func TestRenderNoSignatureWhenNotSigning(t *testing.T) {
	prof := sampleProfile()
	prof.Signature = "signature.svg" // profile has one, but the letter does not sign
	fr := &fakeRunner{}
	fp := &fakeProfiles{prof: prof, sig: []byte("<svg/>"), sigExt: ".svg"}
	svc := New("26.4.35", fr, WithProfiles(fp))

	if _, err := svc.RenderMarkdown(context.Background(), validMD); err != nil {
		t.Fatal(err)
	}
	if _, ok := fr.files["signature.svg"]; ok {
		t.Error("a signature was written although sign is false")
	}
	if strings.Contains(fr.files["brief.json"], "signature.svg") {
		t.Error("brief.json references a signature although sign is false")
	}
}

// TestRenderMarkdownEndToEnd runs the real Typst binary against vendored assets.
// Skipped unless MDO_TESTDATA points at a dir with pkgs/, cache/ and fonts/.
func TestRenderMarkdownEndToEnd(t *testing.T) {
	td := os.Getenv("MDO_TESTDATA")
	if td == "" {
		t.Skip("set MDO_TESTDATA to run the end-to-end test")
	}
	profDir := t.TempDir()
	dir := filepath.Join(profDir, "default")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "profile.yaml"),
		[]byte("name: Muster GmbH\nstreet: Weg 1\nzip: 12345\ncity: Stadt\nprint_qr: false\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := profiles.NewStore("", profDir)
	runner := pipeline.NewTypstRunner("typst", pipeline.TypstEnv{
		PackagePath:      filepath.Join(td, "pkgs"),
		PackageCachePath: filepath.Join(td, "cache"),
		FontPath:         filepath.Join(td, "fonts"),
	})
	svc := New("26.4.35", runner, WithProfiles(store))
	pdf, err := svc.RenderMarkdown(context.Background(), validMD)
	if err != nil {
		t.Fatalf("end-to-end RenderMarkdown: %v", err)
	}
	if !strings.HasPrefix(string(pdf), "%PDF") || !strings.Contains(string(pdf), "pdfaid:part") {
		t.Errorf("output is not a PDF/A")
	}
}
