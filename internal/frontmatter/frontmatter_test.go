package frontmatter

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

const validLetter = `---
profile: eltern
recipient:
  name: Sonnenschein Verlag GmbH
  extra: Frau Lisa Bergmann
  street: Rosenstraße 5
  zip: 50667
  city: Köln
subject: Ihr Angebot vom 1. Juli
date: 5. April 2026
closing: Mit besten Grüßen
sign: true
attachments:
  - Angebotsvergleich (PDF)
  - Referenzliste
---

Sehr geehrte Frau Bergmann,

vielen Dank für Ihr **Angebot**.
`

func fixedNow() time.Time { return time.Date(2026, time.July, 2, 10, 0, 0, 0, time.UTC) }

func TestParseMapsFields(t *testing.T) {
	p, err := Parse(validLetter)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	l := p.Letter
	if l.Profile != "eltern" {
		t.Errorf("Profile = %q, want eltern", l.Profile)
	}
	want := Recipient{Name: "Sonnenschein Verlag GmbH", Extra: "Frau Lisa Bergmann", Street: "Rosenstraße 5", Zip: "50667", City: "Köln"}
	if l.Recipient != want {
		t.Errorf("Recipient = %+v, want %+v", l.Recipient, want)
	}
	if l.Subject != "Ihr Angebot vom 1. Juli" || l.Date != "5. April 2026" || l.Closing != "Mit besten Grüßen" {
		t.Errorf("subject/date/closing wrong: %+v", l)
	}
	if !l.Sign {
		t.Error("Sign = false, want true")
	}
	if len(l.Attachments) != 2 || l.Attachments[0] != "Angebotsvergleich (PDF)" {
		t.Errorf("Attachments = %v", l.Attachments)
	}
	if p.Source != validLetter {
		t.Error("Source is not the verbatim original")
	}
	if want := "Sehr geehrte Frau Bergmann,"; len(p.Body) < len(want) || p.Body[:len(want)] != want {
		t.Errorf("Body should start with the greeting, got %q", p.Body)
	}
}

func TestParseZipCoercion(t *testing.T) {
	src := "---\nprofile: x\nrecipient:\n  name: N\n  street: S\n  zip: 50667\n  city: C\nsubject: S\n---\n\nBody\n"
	p, err := Parse(src)
	if err != nil {
		t.Fatal(err)
	}
	if p.Letter.Recipient.Zip != "50667" { // int in YAML → string
		t.Errorf("zip = %q, want 50667", p.Letter.Recipient.Zip)
	}
}

func TestParseDateDefaultAndOverride(t *testing.T) {
	base := "---\nprofile: x\nrecipient:\n  name: N\n  street: S\n  zip: 1\n  city: C\nsubject: S\n%s---\n\nBody\n"
	// No date → today (fixed clock).
	noDate, err := (Parser{Now: fixedNow}).Parse(fmt.Sprintf(base, ""))
	if err != nil {
		t.Fatal(err)
	}
	if noDate.Letter.Date != "2. Juli 2026" {
		t.Errorf("default date = %q, want 2. Juli 2026", noDate.Letter.Date)
	}
	// Explicit date passes through.
	withDate, err := (Parser{Now: fixedNow}).Parse(fmt.Sprintf(base, "date: 1. Januar 2027\n"))
	if err != nil {
		t.Fatal(err)
	}
	if withDate.Letter.Date != "1. Januar 2027" {
		t.Errorf("explicit date = %q", withDate.Letter.Date)
	}
}

func TestParseClosingDefault(t *testing.T) {
	src := "---\nprofile: x\nrecipient:\n  name: N\n  street: S\n  zip: 1\n  city: C\nsubject: S\n---\n\nBody\n"
	p, err := Parse(src)
	if err != nil {
		t.Fatal(err)
	}
	if p.Letter.Closing != "Mit freundlichen Grüßen" {
		t.Errorf("default closing = %q", p.Letter.Closing)
	}
}

func TestParseProfileOptional(t *testing.T) {
	// A missing profile is allowed here; the service defaults it to "default".
	src := "---\nrecipient:\n  name: N\n  street: S\n  zip: 1\n  city: C\nsubject: S\n---\n\nBody\n"
	p, err := Parse(src)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if p.Letter.Profile != "" {
		t.Errorf("Profile = %q, want empty", p.Letter.Profile)
	}
}

func TestParseMissingRequired(t *testing.T) {
	cases := map[string]struct{ src, field string }{
		"no recipient": {"---\nprofile: x\nsubject: S\n---\n\nB\n", "recipient.name"},
		"no street":    {"---\nprofile: x\nrecipient:\n  name: N\n  zip: 1\n  city: C\nsubject: S\n---\n\nB\n", "recipient.street"},
		"no subject":   {"---\nprofile: x\nrecipient:\n  name: N\n  street: S\n  zip: 1\n  city: C\n---\n\nB\n", "subject"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Parse(tc.src)
			var pe *ParseError
			if !errors.As(err, &pe) {
				t.Fatalf("err = %v, want *ParseError", err)
			}
			if pe.Field != tc.field {
				t.Errorf("Field = %q, want %q", pe.Field, tc.field)
			}
		})
	}
}

func TestParseNoFrontmatter(t *testing.T) {
	_, err := Parse("kein frontmatter hier\n")
	if !errors.As(err, new(*ParseError)) {
		t.Errorf("err = %v, want *ParseError", err)
	}
}
