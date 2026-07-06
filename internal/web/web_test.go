package web

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jcmx9/MarkdownOffice/internal/frontmatter"
	"github.com/jcmx9/MarkdownOffice/internal/profiles"
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

type fakeStore struct {
	names     []string
	prof      *profiles.Profile
	loadErr   error
	savedName string
	saved     *profiles.Profile
	deleted   string
	sigName   string
	sigExt    string
	sigData   []byte
}

func (f *fakeStore) List() ([]string, error) { return f.names, nil }
func (f *fakeStore) Load(string) (*profiles.Profile, error) {
	if f.loadErr != nil {
		return nil, f.loadErr
	}
	return f.prof, nil
}
func (f *fakeStore) Save(name string, p *profiles.Profile) error {
	f.savedName, f.saved = name, p
	return nil
}
func (f *fakeStore) Delete(name string) error                 { f.deleted = name; return nil }
func (f *fakeStore) Signature(string) ([]byte, string, error) { return nil, "", nil }
func (f *fakeStore) SaveSignature(name, ext string, data []byte) error {
	f.sigName, f.sigExt, f.sigData = name, ext, data
	return nil
}

func newTestServer(t *testing.T, r Renderer, store ProfileStore) *Server {
	t.Helper()
	srv, err := NewServer(r, store)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	return srv
}

func TestIndexServesEditorPage(t *testing.T) {
	srv := newTestServer(t, &fakeRenderer{}, &fakeStore{})
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{`id="editor"`, "/static/editor.js", "recipient:", "profile:"} {
		if !strings.Contains(body, want) {
			t.Errorf("page missing %q", want)
		}
	}
}

func TestRenderReturnsPDF(t *testing.T) {
	fr := &fakeRenderer{pdf: []byte("%PDF-web")}
	srv := newTestServer(t, fr, &fakeStore{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/render", strings.NewReader("source=hallo"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type = %q", ct)
	}
	if rec.Body.String() != "%PDF-web" || fr.gotSource != "hallo" {
		t.Errorf("body/source wrong: %q / %q", rec.Body.String(), fr.gotSource)
	}
}

func TestRenderParseErrorIsUnprocessable(t *testing.T) {
	fr := &fakeRenderer{err: &frontmatter.ParseError{Message: "Kein Frontmatter gefunden."}}
	srv := newTestServer(t, fr, &fakeStore{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/render", strings.NewReader("source=x"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Kein Frontmatter gefunden.") {
		t.Errorf("friendly message missing: %q", rec.Body.String())
	}
}

func TestListProfiles(t *testing.T) {
	srv := newTestServer(t, &fakeRenderer{}, &fakeStore{names: []string{"default", "eltern"}})
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/profiles", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var got []string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 2 || got[0] != "default" {
		t.Errorf("list = %v", got)
	}
}

func TestGetProfile(t *testing.T) {
	store := &fakeStore{prof: &profiles.Profile{Name: "Anna", Street: "S", Zip: "1", City: "C", Accent: "#103C78"}}
	srv := newTestServer(t, &fakeRenderer{}, store)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/profiles/anna", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"name":"Anna"`) || !strings.Contains(rec.Body.String(), "#103C78") {
		t.Errorf("profile JSON wrong: %s", rec.Body.String())
	}
}

func TestGetProfileNotFound(t *testing.T) {
	store := &fakeStore{loadErr: &profiles.ProfileError{Message: "Profil wurde nicht gefunden.", Name: "x"}}
	srv := newTestServer(t, &fakeRenderer{}, store)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/profiles/x", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "nicht gefunden") {
		t.Errorf("message missing: %q", rec.Body.String())
	}
}

func TestSaveProfile(t *testing.T) {
	store := &fakeStore{}
	srv := newTestServer(t, &fakeRenderer{}, store)
	body := `{"name":"Anna","street":"Weg 1","zip":"12345","city":"Ort","print_qr":true}`
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/profiles/anna", strings.NewReader(body)))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if store.savedName != "anna" || store.saved == nil || store.saved.Name != "Anna" || store.saved.City != "Ort" {
		t.Errorf("save got name=%q profile=%+v", store.savedName, store.saved)
	}
}

func TestDeleteProfile(t *testing.T) {
	store := &fakeStore{}
	srv := newTestServer(t, &fakeRenderer{}, store)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/profiles/anna", nil))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if store.deleted != "anna" {
		t.Errorf("deleted = %q", store.deleted)
	}
}

func TestUploadSignature(t *testing.T) {
	store := &fakeStore{}
	srv := newTestServer(t, &fakeRenderer{}, store)

	body, ct := multipartFile(t, "file", "unterschrift.svg", []byte("<svg/>"))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/profiles/anna/signature", body)
	req.Header.Set("Content-Type", ct)
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (%s)", rec.Code, rec.Body.String())
	}
	if store.sigName != "anna" || store.sigExt != ".svg" || string(store.sigData) != "<svg/>" {
		t.Errorf("SaveSignature got (%q, %q, %q)", store.sigName, store.sigExt, store.sigData)
	}
}

func TestUploadSignatureRejectsNonSVG(t *testing.T) {
	srv := newTestServer(t, &fakeRenderer{}, &fakeStore{})
	body, ct := multipartFile(t, "file", "sig.png", []byte("\x89PNG"))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/profiles/anna/signature", body)
	req.Header.Set("Content-Type", ct)
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
}

func multipartFile(t *testing.T, field, filename string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile(field, filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return &buf, w.FormDataContentType()
}
