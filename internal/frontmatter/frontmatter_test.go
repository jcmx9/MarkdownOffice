package frontmatter

import (
	"errors"
	"strings"
	"testing"
	"time"
)

const sampleMD = `---
name: Dr. Anna Weber
street: Lindenallee 12
zip: 80331
city: München
email: anna.weber@example.de
qr_code: true
closing: Mit herzlichen Grüßen
date: 5. April 2026
subject: Manuskript-Einreichung
recipient:
  - Sonnenschein Verlag GmbH
  - 50667 Köln
accent: "#1F6FEB"
attachments:
  - Anlage eins
---

Sehr geehrte Frau Bergmann,

dies ist der **Body**.
`

func TestParseMapsFieldsBodyAndSource(t *testing.T) {
	got, err := Parse(sampleMD)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}
	l := got.Letter

	if l.Sender.Name != "Dr. Anna Weber" {
		t.Errorf("sender.Name = %q", l.Sender.Name)
	}
	if l.Sender.Street != "Lindenallee 12" {
		t.Errorf("sender.Street = %q", l.Sender.Street)
	}
	// zip (parsed as int by YAML) + city are combined into "PLZ Ort".
	if l.Sender.City != "80331 München" {
		t.Errorf("sender.City = %q, want %q", l.Sender.City, "80331 München")
	}
	if !l.Sender.QR {
		t.Errorf("qr_code not mapped to Sender.QR")
	}
	if l.Subject != "Manuskript-Einreichung" {
		t.Errorf("subject = %q", l.Subject)
	}
	if l.Closing != "Mit herzlichen Grüßen" {
		t.Errorf("closing = %q", l.Closing)
	}
	if l.Accent != "#1F6FEB" {
		t.Errorf("accent = %q", l.Accent)
	}
	if len(l.Recipient) != 2 || l.Recipient[0] != "Sonnenschein Verlag GmbH" {
		t.Errorf("recipient = %v", l.Recipient)
	}
	if l.Date != "5. April 2026" {
		t.Errorf("date = %q (explicit value should pass through)", l.Date)
	}

	// Body is the text after the frontmatter, not the YAML.
	if !strings.Contains(got.Body, "dies ist der **Body**") {
		t.Errorf("body missing content:\n%s", got.Body)
	}
	if strings.Contains(got.Body, "name:") {
		t.Errorf("body must not contain frontmatter:\n%s", got.Body)
	}
	// Source is the full original document, verbatim (embedded later as attachment).
	if got.Source != sampleMD {
		t.Errorf("Source is not the verbatim original")
	}
}

func TestParseDefaultsDateToToday(t *testing.T) {
	fixed := time.Date(2026, time.April, 5, 0, 0, 0, 0, time.UTC)
	p := Parser{Now: func() time.Time { return fixed }}

	src := "---\nname: A\nstreet: S\nzip: 1\ncity: C\nrecipient:\n  - R\n---\n\nBody\n"
	got, err := p.Parse(src)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if got.Letter.Date != "5. April 2026" {
		t.Errorf("date = %q, want today German without leading zero", got.Letter.Date)
	}
	if got.Letter.Closing != "Mit freundlichem Gruß" {
		t.Errorf("closing default = %q", got.Letter.Closing)
	}
}

func TestParseErrors(t *testing.T) {
	cases := map[string]string{
		"no frontmatter":  "Sehr geehrte Damen und Herren,\n",
		"empty recipient": "---\nname: A\nstreet: S\nzip: 1\ncity: C\nrecipient: []\n---\n\nBody\n",
		"missing name":    "---\nstreet: S\nzip: 1\ncity: C\nrecipient:\n  - R\n---\n\nBody\n",
		"bad accent":      "---\nname: A\nstreet: S\nzip: 1\ncity: C\nrecipient:\n  - R\naccent: blau\n---\n\nBody\n",
		"broken yaml":     "---\nname: [unterminated\n---\n\nBody\n",
	}
	for name, src := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Parse(src)
			if err == nil {
				t.Fatalf("expected an error for %q", name)
			}
			var pe *ParseError
			if !errors.As(err, &pe) {
				t.Errorf("error is not *ParseError: %T", err)
			} else if strings.TrimSpace(pe.Message) == "" {
				t.Errorf("ParseError has no human message")
			}
		})
	}
}
