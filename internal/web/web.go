// Package web serves the local single-user editor UI on loopback: a CodeMirror
// Markdown editor with a live PDF/A-3b preview. It depends only on a Renderer,
// so handlers are testable without Typst.
package web

import (
	"context"
	"embed"
	"errors"
	"html/template"
	"io/fs"
	"log"
	"net/http"

	"github.com/jcmx9/mdo-service/internal/frontmatter"
)

//go:embed templates/*.html static
var assets embed.FS

// DefaultLetter seeds the editor on first load.
const DefaultLetter = `---
name: Dr. Anna Weber
street: Lindenallee 12
zip: 80331
city: München
email: anna.weber@example.de
accent: "#1F6FEB"
subject: Ihr Angebot vom 1. Juli
recipient:
  - Sonnenschein Verlag GmbH
  - Frau Lisa Bergmann
  - Rosenstraße 5
  - 50667 Köln
closing: Mit freundlichen Grüßen
---

Sehr geehrte Frau Bergmann,

vielen Dank für Ihr Angebot. Mit **Markdown** schreibt sich der Brief bequem:
*kursiv*, Aufzählungen und Tabellen werden nach DIN 5008 gesetzt.

- Erster Punkt
- Zweiter Punkt

Über eine Rückmeldung freue ich mich.
`

// Renderer turns a Markdown letter source into a PDF/A-3b document.
type Renderer interface {
	RenderMarkdown(ctx context.Context, source string) ([]byte, error)
}

// Server is the loopback HTTP handler for the editor UI.
type Server struct {
	mux      *http.ServeMux
	renderer Renderer
	index    *template.Template
}

// NewServer wires the routes and parses the embedded page template.
func NewServer(r Renderer) (*Server, error) {
	index, err := template.ParseFS(assets, "templates/index.html")
	if err != nil {
		return nil, err
	}
	s := &Server{mux: http.NewServeMux(), renderer: r, index: index}
	s.routes()
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

func (s *Server) routes() {
	static, _ := fs.Sub(assets, "static")
	s.mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(static))))
	s.mux.HandleFunc("GET /{$}", s.handleIndex)
	s.mux.HandleFunc("POST /render", s.handleRender)
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
		var pe *frontmatter.ParseError
		if errors.As(err, &pe) {
			status, msg = http.StatusUnprocessableEntity, pe.Message
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
