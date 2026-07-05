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

	"github.com/jcmx9/MarkdownOffice/internal/frontmatter"
)

//go:embed templates/*.html static
var assets embed.FS

// DefaultLetter seeds the editor on first load. It shows the full frontmatter
// field set so users can see every option at a glance.
const DefaultLetter = `---
# Absender
name: Dr. Anna Weber
street: Lindenallee 12
zip: 80331
city: München
phone: 089 1234567
email: anna.weber@example.de
# Bankverbindung (optional, erscheint in der Fußzeile)
iban: DE91 7002 0500 0009 8765 43
bic: BFSWDE33MUE
bank: Bank für Sozialwirtschaft
# Optik & Extras
accent: "#C2185B"          # Akzentfarbe als Hex (#RRGGBB) — Rubinrosa
qr_code: true              # vCard-QR im Info-Block
# signature: unterschrift.svg   # (Signatur-Upload folgt in einer späteren Version)
# Brief
date: null                 # null = heute; sonst z. B. "5. April 2026"
subject: Ihr Angebot vom 1. Juli
recipient:
  - Sonnenschein Verlag GmbH
  - Frau Lisa Bergmann
  - Rosenstraße 5
  - 50667 Köln
closing: Mit freundlichen Grüßen
attachments:
  - Angebotsvergleich (PDF)
  - Referenzliste
---

Sehr geehrte Frau Bergmann,

vielen Dank für Ihr Angebot. Mit **Markdown** schreibt sich der Brief bequem:
*kursiv*, Aufzählungen, Tabellen und Links werden nach DIN 5008 gesetzt.

## Beispiel-Tabelle

Zahlen mit **Punkt** als Dezimaltrenner eingeben (z. B. ` + "`1200.50`" + `); in der Ausgabe
erscheinen sie deutsch (Komma) und **rechtsbündig am Komma ausgerichtet**.

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
