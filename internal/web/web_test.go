package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jcmx9/mdo-service/internal/frontmatter"
)

type fakeRenderer struct {
	pdf       []byte
	err       error
	gotSource string
}

func (f *fakeRenderer) RenderMarkdown(_ context.Context, source string) ([]byte, error) {
	f.gotSource = source
	return f.pdf, f.err
}

func TestIndexServesEditorPage(t *testing.T) {
	srv, err := NewServer(&fakeRenderer{})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `id="editor"`) {
		t.Errorf("page has no #editor mount point")
	}
	if !strings.Contains(body, "/static/editor.js") {
		t.Errorf("page does not load the editor script")
	}
	if !strings.Contains(body, "recipient:") {
		t.Errorf("page does not seed a default letter")
	}
}

func TestRenderReturnsPDF(t *testing.T) {
	fr := &fakeRenderer{pdf: []byte("%PDF-web")}
	srv, _ := NewServer(fr)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/render", strings.NewReader("source=hallo"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type = %q, want application/pdf", ct)
	}
	if rec.Body.String() != "%PDF-web" {
		t.Errorf("body = %q", rec.Body.String())
	}
	if fr.gotSource != "hallo" {
		t.Errorf("source passed to renderer = %q, want %q", fr.gotSource, "hallo")
	}
}

func TestRenderParseErrorIsUnprocessable(t *testing.T) {
	fr := &fakeRenderer{err: &frontmatter.ParseError{Message: "Kein Frontmatter gefunden."}}
	srv, _ := NewServer(fr)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/render", strings.NewReader("source=x"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Kein Frontmatter gefunden.") {
		t.Errorf("friendly message missing from body: %q", rec.Body.String())
	}
}
