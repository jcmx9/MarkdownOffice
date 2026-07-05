// Package frontmatter parses a DIN 5008 letter source (YAML frontmatter plus a
// Markdown body) into the structured form the pipeline consumes. Parse errors
// are translated into layperson-friendly German messages.
package frontmatter

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jcmx9/MarkdownOffice/internal/pipeline"
	"gopkg.in/yaml.v3"
)

const defaultClosing = "Mit freundlichem Gruß"

var germanMonths = [...]string{
	"Januar", "Februar", "März", "April", "Mai", "Juni",
	"Juli", "August", "September", "Oktober", "November", "Dezember",
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// ParseError is a user-facing parse failure with a German, layperson-friendly
// message. It wraps the underlying error for debugging via errors.Unwrap.
type ParseError struct {
	Message string // human-readable German message, no stack trace
	Field   string // offending frontmatter field, if applicable
	Err     error  // wrapped cause, if any
}

func (e *ParseError) Error() string {
	if e.Field != "" {
		return fmt.Sprintf("%s (Feld %q)", e.Message, e.Field)
	}
	return e.Message
}

func (e *ParseError) Unwrap() error { return e.Err }

// Parsed is the result of parsing a letter source.
type Parsed struct {
	Letter pipeline.Letter
	Body   string // Markdown body without frontmatter (rendered via cmarker)
	Source string // full original document, verbatim (embedded as PDF/A attachment)
}

// Parser parses letter sources. Now supplies "today" for the default date and
// is injectable for deterministic tests.
type Parser struct {
	Now func() time.Time
}

// Parse parses a letter source using the current wall clock for the date default.
func Parse(source string) (Parsed, error) {
	return Parser{Now: time.Now}.Parse(source)
}

// flexScalar accepts a YAML scalar regardless of its resolved type, so that
// bare numbers (e.g. a postal code parsed as int) map to strings.
type flexScalar string

func (f *flexScalar) UnmarshalYAML(n *yaml.Node) error {
	if n.Kind != yaml.ScalarNode {
		return fmt.Errorf("expected a scalar value, got kind %d", n.Kind)
	}
	*f = flexScalar(n.Value)
	return nil
}

// sigValue accepts the signature field as either a filename string or a bool.
type sigValue struct{ Filename string }

func (s *sigValue) UnmarshalYAML(n *yaml.Node) error {
	if n.Tag == "!!bool" {
		// true = auto-detect a signature file (deferred: needs storage context);
		// false = none. Either way, no explicit filename here.
		return nil
	}
	return n.Decode(&s.Filename)
}

type frontmatterYAML struct {
	Name           string      `yaml:"name"`
	Street         string      `yaml:"street"`
	Zip            flexScalar  `yaml:"zip"`
	City           string      `yaml:"city"`
	Phone          string      `yaml:"phone"`
	Email          string      `yaml:"email"`
	IBAN           string      `yaml:"iban"`
	BIC            string      `yaml:"bic"`
	Bank           string      `yaml:"bank"`
	QRCode         bool        `yaml:"qr_code"`
	Signature      *sigValue   `yaml:"signature"`
	SignatureWidth int         `yaml:"signature_width"`
	Closing        string      `yaml:"closing"`
	Date           *flexScalar `yaml:"date"`
	Subject        string      `yaml:"subject"`
	Recipient      []string    `yaml:"recipient"`
	Accent         string      `yaml:"accent"`
	Attachments    []string    `yaml:"attachments"`
}

// Parse splits the frontmatter from the body, validates required fields, and
// maps everything onto a pipeline.Letter.
func (p Parser) Parse(source string) (Parsed, error) {
	now := p.Now
	if now == nil {
		now = time.Now
	}

	fmText, body, err := splitFrontmatter(source)
	if err != nil {
		return Parsed{}, err
	}

	var fm frontmatterYAML
	if err := yaml.Unmarshal([]byte(fmText), &fm); err != nil {
		return Parsed{}, &ParseError{Message: "Das YAML-Frontmatter ist ungültig.", Err: err}
	}

	for _, req := range []struct{ value, name string }{
		{fm.Name, "name"}, {fm.Street, "street"}, {string(fm.Zip), "zip"}, {fm.City, "city"},
	} {
		if strings.TrimSpace(req.value) == "" {
			return Parsed{}, &ParseError{Message: "Ein Pflichtfeld fehlt oder ist leer.", Field: req.name}
		}
	}
	if len(fm.Recipient) == 0 {
		return Parsed{}, &ParseError{
			Message: "Der Empfänger braucht mindestens eine Adresszeile.",
			Field:   "recipient",
		}
	}
	if fm.Accent != "" && !hexColor.MatchString(fm.Accent) {
		return Parsed{}, &ParseError{
			Message: fmt.Sprintf("Die Akzentfarbe muss ein Hex-Wert wie #B03060 sein, war %q.", fm.Accent),
			Field:   "accent",
		}
	}

	closing := fm.Closing
	if strings.TrimSpace(closing) == "" {
		closing = defaultClosing
	}

	date := formatGermanDate(now())
	if fm.Date != nil && strings.TrimSpace(string(*fm.Date)) != "" {
		date = string(*fm.Date)
	}

	signature := ""
	if fm.Signature != nil {
		signature = fm.Signature.Filename
	}

	letter := pipeline.Letter{
		Sender: pipeline.Sender{
			Name:   fm.Name,
			Street: fm.Street,
			City:   strings.TrimSpace(string(fm.Zip) + " " + fm.City),
			Phone:  fm.Phone,
			Email:  fm.Email,
			IBAN:   fm.IBAN,
			BIC:    fm.BIC,
			Bank:   fm.Bank,
			QR:     fm.QRCode,
		},
		Recipient:   fm.Recipient,
		Date:        date,
		Subject:     fm.Subject,
		Closing:     closing,
		Signature:   signature,
		Accent:      fm.Accent,
		Attachments: fm.Attachments,
	}

	return Parsed{Letter: letter, Body: body, Source: source}, nil
}

// splitFrontmatter separates the leading YAML frontmatter from the Markdown body.
func splitFrontmatter(source string) (frontmatter, body string, err error) {
	parts := strings.SplitN(source, "---", 3)
	if len(parts) < 3 || strings.TrimSpace(parts[0]) != "" {
		return "", "", &ParseError{
			Message: "Kein YAML-Frontmatter gefunden — der Brief muss mit einem '---'-Block beginnen und diesen mit '---' schließen.",
		}
	}
	return parts[1], strings.TrimSpace(parts[2]), nil
}

func formatGermanDate(t time.Time) string {
	// Day without leading zero, e.g. "2. Juli 2026".
	return fmt.Sprintf("%d. %s %d", t.Day(), germanMonths[t.Month()-1], t.Year())
}
