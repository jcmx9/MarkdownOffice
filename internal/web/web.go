// Package web serves the local single-user editor UI on loopback: a CodeMirror
// Markdown editor with a live PDF/A-3b preview plus sender-profile management.
// It depends on a Renderer and a ProfileStore, so handlers are testable without
// Typst or the filesystem.
package web

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"io/fs"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/jcmx9/MarkdownOffice/internal/frontmatter"
	"github.com/jcmx9/MarkdownOffice/internal/profiles"
)

//go:embed templates/*.html static
var assets embed.FS

// maxSignatureBytes caps an uploaded signature image.
const maxSignatureBytes = 512 << 10 // 512 KiB

// DefaultLetter seeds the editor on first load. It uses the profile-based
// Modell-2 schema: the sender comes from the referenced profile.
const DefaultLetter = `---
profile: default
recipient:
  name: Sonnenschein Verlag GmbH
  extra: Frau Lisa Bergmann
  street: Rosenstraße 5
  zip: 50667
  city: Köln
subject: Ihr Angebot vom 1. Juli
date: null                 # null = heute; sonst z. B. "5. April 2026"
closing: Mit freundlichen Grüßen
sign: false                # true = Signatur des Profils einfügen
attachments:
  - Angebotsvergleich (PDF)
  - Referenzliste
---

Sehr geehrte Frau Bergmann,

vielen Dank für Ihr Angebot. Der Absender kommt aus dem **Profil** — hier musst
du ihn nicht wiederholen. Mit Markdown schreibt sich der Brief bequem: *kursiv*,
Aufzählungen, Tabellen und Links werden nach DIN 5008 gesetzt.

## Beispiel-Tabelle

Zahlen mit Punkt als Dezimaltrenner eingeben; in der Ausgabe erscheinen sie
deutsch (Komma) und rechtsbündig am Komma ausgerichtet.

| Leistung   | Menge | Preis    |
| ---------- | ----- | -------- |
| Grundpaket | 1     | 1200.50  |
| Support    | 12    | 300      |
| Gesamt     |       | 12345.75 |

Über eine Rückmeldung freue ich mich.
`

// Renderer turns a Markdown letter source into a PDF/A-3b document.
type Renderer interface {
	RenderMarkdown(ctx context.Context, source string) ([]byte, error)
}

// ProfileStore is the profile- and letter-management surface the web layer needs.
type ProfileStore interface {
	List() ([]string, error)
	Load(name string) (*profiles.Profile, error)
	Save(name string, p *profiles.Profile) error
	Delete(name string) error
	Signature(name string) (data []byte, ext string, err error)
	SaveSignature(name, ext string, data []byte) error
	SaveLetter(profile, source string) (id string, err error)
	ListLetters(profile string) ([]profiles.LetterMeta, error)
	LoadLetter(profile, id string) (source string, err error)
	DeleteLetter(profile, id string) error
}

// Server is the loopback HTTP handler for the editor UI.
type Server struct {
	mux      *http.ServeMux
	renderer Renderer
	store    ProfileStore
	index    *template.Template
}

// NewServer wires the routes and parses the embedded page template.
func NewServer(r Renderer, store ProfileStore) (*Server, error) {
	index, err := template.ParseFS(assets, "templates/index.html")
	if err != nil {
		return nil, err
	}
	s := &Server{mux: http.NewServeMux(), renderer: r, store: store, index: index}
	s.routes()
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

func (s *Server) routes() {
	static, _ := fs.Sub(assets, "static")
	s.mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(static))))
	s.mux.HandleFunc("GET /{$}", s.handleIndex)
	s.mux.HandleFunc("POST /render", s.handleRender)
	s.mux.HandleFunc("GET /profiles", s.handleListProfiles)
	s.mux.HandleFunc("GET /profiles/{name}", s.handleGetProfile)
	s.mux.HandleFunc("POST /profiles/{name}", s.handleSaveProfile)
	s.mux.HandleFunc("DELETE /profiles/{name}", s.handleDeleteProfile)
	s.mux.HandleFunc("POST /profiles/{name}/signature", s.handleUploadSignature)
	s.mux.HandleFunc("POST /letters/{profile}", s.handleSaveLetter)
	s.mux.HandleFunc("GET /letters/{profile}", s.handleListLetters)
	s.mux.HandleFunc("GET /letters/{profile}/{id}", s.handleGetLetter)
	s.mux.HandleFunc("DELETE /letters/{profile}/{id}", s.handleDeleteLetter)
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.index.Execute(w, map[string]any{"DefaultLetter": DefaultLetter}); err != nil {
		log.Printf("index template: %v", err)
		http.Error(w, "Interner Fehler beim Rendern der Seite.", http.StatusInternalServerError)
	}
}

func (s *Server) handleRender(w http.ResponseWriter, r *http.Request) {
	pdf, err := s.renderer.RenderMarkdown(r.Context(), r.FormValue("source"))
	if err != nil {
		status, msg := http.StatusInternalServerError, "Die PDF-Erzeugung ist fehlgeschlagen."
		if m, ok := friendlyMessage(err); ok {
			status, msg = http.StatusUnprocessableEntity, m
		} else {
			log.Printf("render: %v", err)
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(msg))
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	_, _ = w.Write(pdf)
}

func (s *Server) handleListProfiles(w http.ResponseWriter, r *http.Request) {
	names, err := s.store.List()
	if err != nil {
		log.Printf("list profiles: %v", err)
		http.Error(w, "Profile konnten nicht gelesen werden.", http.StatusInternalServerError)
		return
	}
	if names == nil {
		names = []string{}
	}
	writeJSON(w, names)
}

func (s *Server) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.Load(r.PathValue("name"))
	if err != nil {
		writeProfileError(w, err, http.StatusNotFound)
		return
	}
	writeJSON(w, p)
}

func (s *Server) handleSaveProfile(w http.ResponseWriter, r *http.Request) {
	var p profiles.Profile
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&p); err != nil {
		http.Error(w, "Die Profildaten sind ungültig.", http.StatusBadRequest)
		return
	}
	if err := s.store.Save(r.PathValue("name"), &p); err != nil {
		writeProfileError(w, err, http.StatusUnprocessableEntity)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteProfile(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Delete(r.PathValue("name")); err != nil {
		writeProfileError(w, err, http.StatusUnprocessableEntity)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUploadSignature(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxSignatureBytes+4<<10)
	if err := r.ParseMultipartForm(maxSignatureBytes); err != nil {
		http.Error(w, "Die Datei ist zu groß (max. 512 KB).", http.StatusRequestEntityTooLarge)
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Es wurde keine Datei empfangen.", http.StatusBadRequest)
		return
	}
	defer func() { _ = file.Close() }()

	ext := strings.ToLower(filepath.Ext(hdr.Filename))
	if ext != ".svg" {
		http.Error(w, "Nur SVG-Signaturen werden unterstützt.", http.StatusUnprocessableEntity)
		return
	}
	data, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Die Datei konnte nicht gelesen werden.", http.StatusInternalServerError)
		return
	}
	if err := s.store.SaveSignature(r.PathValue("name"), ext, data); err != nil {
		writeProfileError(w, err, http.StatusUnprocessableEntity)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSaveLetter(w http.ResponseWriter, r *http.Request) {
	source := r.FormValue("source")
	if strings.TrimSpace(source) == "" {
		http.Error(w, "Der Brief ist leer.", http.StatusBadRequest)
		return
	}
	id, err := s.store.SaveLetter(r.PathValue("profile"), source)
	if err != nil {
		writeProfileError(w, err, http.StatusUnprocessableEntity)
		return
	}
	writeJSON(w, map[string]string{"id": id})
}

func (s *Server) handleListLetters(w http.ResponseWriter, r *http.Request) {
	metas, err := s.store.ListLetters(r.PathValue("profile"))
	if err != nil {
		writeProfileError(w, err, http.StatusNotFound)
		return
	}
	writeJSON(w, metas)
}

func (s *Server) handleGetLetter(w http.ResponseWriter, r *http.Request) {
	source, err := s.store.LoadLetter(r.PathValue("profile"), r.PathValue("id"))
	if err != nil {
		writeProfileError(w, err, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(source))
}

func (s *Server) handleDeleteLetter(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteLetter(r.PathValue("profile"), r.PathValue("id")); err != nil {
		writeProfileError(w, err, http.StatusUnprocessableEntity)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// friendlyMessage returns a user-facing message for the errors the UI should
// surface verbatim (parse and profile errors), and whether it matched.
func friendlyMessage(err error) (string, bool) {
	var pe *frontmatter.ParseError
	if errors.As(err, &pe) {
		return pe.Error(), true
	}
	var prof *profiles.ProfileError
	if errors.As(err, &prof) {
		return prof.Error(), true
	}
	return "", false
}

func writeProfileError(w http.ResponseWriter, err error, fallbackStatus int) {
	var pe *profiles.ProfileError
	if errors.As(err, &pe) {
		http.Error(w, pe.Error(), fallbackStatus)
		return
	}
	log.Printf("profile: %v", err)
	http.Error(w, "Interner Fehler.", http.StatusInternalServerError)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}
