// Package frontmatter parses a DIN 5008 letter source (YAML frontmatter plus a
// Markdown body) into structured letter data. The sender is not part of the
// letter — it is referenced by profile name and resolved elsewhere. Parse errors
// are translated into layperson-friendly German messages.
package frontmatter

import (
	"fmt"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const defaultClosing = "Mit freundlichen Grüßen"

var germanMonths = [...]string{
	"Januar", "Februar", "März", "April", "Mai", "Juni",
	"Juli", "August", "September", "Oktober", "November", "Dezember",
}

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

// Recipient is the addressee block of a letter.
type Recipient struct {
	Name   string
	Extra  string // optional second line, e.g. a department
	Street string
	Zip    string
	City   string
}

// LetterData is the letter metadata parsed from the frontmatter. The sender
// comes from the referenced profile, not from here.
type LetterData struct {
	Profile     string // profile name; empty means the default profile
	Recipient   Recipient
	Subject     string
	Date        string // resolved German date
	Closing     string
	Sign        bool
	Attachments []string
}

// Parsed is the result of parsing a letter source.
type Parsed struct {
	Letter LetterData
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

type recipientYAML struct {
	Name   string     `yaml:"name"`
	Extra  string     `yaml:"extra"`
	Street string     `yaml:"street"`
	Zip    flexScalar `yaml:"zip"`
	City   string     `yaml:"city"`
}

type frontmatterYAML struct {
	Profile     string        `yaml:"profile"`
	Recipient   recipientYAML `yaml:"recipient"`
	Subject     string        `yaml:"subject"`
	Date        *flexScalar   `yaml:"date"`
	Closing     string        `yaml:"closing"`
	Sign        bool          `yaml:"sign"`
	Attachments []string      `yaml:"attachments"`
}

// Parse splits the frontmatter from the body, validates required fields, and
// maps everything onto LetterData.
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
		{fm.Recipient.Name, "recipient.name"},
		{fm.Recipient.Street, "recipient.street"},
		{string(fm.Recipient.Zip), "recipient.zip"},
		{fm.Recipient.City, "recipient.city"},
		{fm.Subject, "subject"},
	} {
		if strings.TrimSpace(req.value) == "" {
			return Parsed{}, &ParseError{Message: "Ein Pflichtfeld fehlt oder ist leer.", Field: req.name}
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

	letter := LetterData{
		Profile: fm.Profile,
		Recipient: Recipient{
			Name:   fm.Recipient.Name,
			Extra:  fm.Recipient.Extra,
			Street: fm.Recipient.Street,
			Zip:    string(fm.Recipient.Zip),
			City:   fm.Recipient.City,
		},
		Subject:     fm.Subject,
		Date:        date,
		Closing:     closing,
		Sign:        fm.Sign,
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
