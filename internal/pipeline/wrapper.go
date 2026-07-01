// Package pipeline turns a structured DIN 5008 letter plus a Markdown body into
// a PDF/A-3b document with the Markdown source embedded. It orchestrates Typst
// (with the din5008a template and the cmarker Markdown transpiler) and has no
// knowledge of HTTP, storage, or the surrounding application.
package pipeline

import (
	"encoding/json"
	"fmt"
)

// cmarkerVersion is the pinned cmarker (Markdown→Typst) package version.
const cmarkerVersion = "0.1.9"

// Sender is the writer's letterhead and return-address data.
type Sender struct {
	Name   string `json:"name,omitempty"`
	Street string `json:"street,omitempty"`
	City   string `json:"city,omitempty"`
	Phone  string `json:"phone,omitempty"`
	Email  string `json:"email,omitempty"`
	IBAN   string `json:"iban,omitempty"`
	BIC    string `json:"bic,omitempty"`
	Bank   string `json:"bank,omitempty"`
	QR     bool   `json:"qr"`
}

// Letter is a single DIN 5008 Form A business letter, independent of how it is
// stored or transported.
type Letter struct {
	Sender      Sender
	Recipient   []string
	Date        string
	Subject     string
	Closing     string
	Signature   string // signature image filename relative to the compile root, or "" for none
	Accent      string // hex colour like "#1F6FEB", or "" for the template default
	Attachments []string
}

// Wrapper holds the generated Typst entrypoint and its JSON side-car, ready to
// be written next to body.md and brief.md in the compile directory.
type Wrapper struct {
	Typ  string
	JSON string
}

// briefJSON is the on-disk shape consumed by the din5008a template.
type briefJSON struct {
	Sender      Sender   `json:"sender"`
	Recipient   []string `json:"recipient"`
	Date        string   `json:"date,omitempty"`
	Subject     string   `json:"subject,omitempty"`
	Closing     string   `json:"closing,omitempty"`
	Signature   *string  `json:"signature"`
	Accent      *string  `json:"accent"`
	Attachments []string `json:"attachments"`
}

// BuildWrapper renders the Typst entrypoint (brief.typ) and its JSON side-car
// (brief.json) for a letter. The din5008a template version is injected so the
// caller controls pinning; cmarker is pinned internally. The generated wrapper
// renders the body from body.md via cmarker and embeds brief.md as the PDF/A-3
// source attachment (AFRelationship "source").
func BuildWrapper(l Letter, din5008aVersion string) (Wrapper, error) {
	if din5008aVersion == "" {
		return Wrapper{}, fmt.Errorf("din5008a version must not be empty")
	}

	// Coalesce nil slices to empty arrays so the JSON encodes `[]`, not `null`:
	// the din5008a template calls .len() on these and `none` would abort the compile.
	recipient := l.Recipient
	if recipient == nil {
		recipient = []string{}
	}
	attachments := l.Attachments
	if attachments == nil {
		attachments = []string{}
	}

	bj := briefJSON{
		Sender:      l.Sender,
		Recipient:   recipient,
		Date:        l.Date,
		Subject:     l.Subject,
		Closing:     l.Closing,
		Attachments: attachments,
	}
	if l.Signature != "" {
		bj.Signature = &l.Signature
	}
	if l.Accent != "" {
		bj.Accent = &l.Accent
	}
	jsonBytes, err := json.MarshalIndent(bj, "", "  ")
	if err != nil {
		return Wrapper{}, fmt.Errorf("marshal brief.json: %w", err)
	}

	typ := fmt.Sprintf(`#import "@local/din5008a:%s": din5008a, bullet
#import "@local/cmarker:%s"

#let data = json("brief.json")
#let sig = if data.at("signature", default: none) != none { read(data.signature) } else { none }

#show: din5008a.with(
  sender: data.sender,
  recipient: data.recipient,
  date: data.at("date", default: none),
  subject: data.at("subject", default: none),
  closing: data.at("closing", default: none),
  signature: sig,
  %sattachments: data.at("attachments", default: ()),
)

// Original Markdown source embedded as PDF/A-3 attachment (AFRelationship=Source).
#pdf.attach("brief.md",
  relationship: "source",
  mime-type: "text/markdown",
  description: "Markdown-Quelle des Briefs")

// Body: Markdown rendered to Typst via cmarker, styled by din5008a.
#cmarker.render(read("body.md"))
`, din5008aVersion, cmarkerVersion, accentArg(l.Accent))

	return Wrapper{Typ: typ, JSON: string(jsonBytes)}, nil
}

// accentArg returns the din5008a accent argument line when an accent colour is
// set, or an empty string to fall back to the template default.
func accentArg(accent string) string {
	if accent == "" {
		return ""
	}
	return "accent: rgb(data.accent),\n  "
}
