// Package service composes frontmatter parsing, sender-profile lookup and the
// Typst pipeline into a single "Markdown in, PDF/A out" call.
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jcmx9/MarkdownOffice/internal/frontmatter"
	"github.com/jcmx9/MarkdownOffice/internal/pipeline"
	"github.com/jcmx9/MarkdownOffice/internal/profiles"
)

// Profiles resolves sender profiles and their signature images by name.
type Profiles interface {
	Load(name string) (*profiles.Profile, error)
	Signature(name string) (data []byte, ext string, err error)
}

// Service renders letters. It is safe to construct without a profile store, but
// RenderMarkdown then fails fast — every letter needs a sender profile.
type Service struct {
	din5008aVersion string
	runner          pipeline.Runner
	profiles        Profiles
}

// Option configures a Service.
type Option func(*Service)

// WithProfiles wires the sender-profile store used to resolve the letter's sender.
func WithProfiles(p Profiles) Option {
	return func(s *Service) { s.profiles = p }
}

// New builds a Service.
func New(din5008aVersion string, runner pipeline.Runner, opts ...Option) *Service {
	s := &Service{din5008aVersion: din5008aVersion, runner: runner}
	for _, o := range opts {
		o(s)
	}
	return s
}

// RenderMarkdown parses the letter, resolves its sender profile, maps both onto
// the pipeline letter and compiles a PDF/A-3b. A *frontmatter.ParseError or
// *profiles.ProfileError is propagated verbatim for a friendly message upstream.
func (s *Service) RenderMarkdown(ctx context.Context, source string) ([]byte, error) {
	parsed, err := frontmatter.Parse(source)
	if err != nil {
		return nil, err
	}
	if s.profiles == nil {
		return nil, errors.New("Kein Profilspeicher konfiguriert.")
	}

	name := parsed.Letter.Profile
	if name == "" {
		name = "default"
	}
	prof, err := s.profiles.Load(name)
	if err != nil {
		return nil, err
	}

	in := pipeline.Input{
		Letter: mapToLetter(prof, parsed.Letter),
		Body:   parsed.Body,
		Source: parsed.Source,
	}

	if parsed.Letter.Sign {
		data, ext, err := s.profiles.Signature(name)
		if err != nil {
			return nil, fmt.Errorf("Signatur konnte nicht geladen werden: %w", err)
		}
		if data != nil {
			in.Letter.Signature = "signature" + ext
			in.SignatureData = data
		}
	}

	pdf, err := pipeline.Compile(ctx, s.runner, in, pipeline.Options{Din5008aVersion: s.din5008aVersion})
	if err != nil {
		return nil, fmt.Errorf("PDF-Erzeugung fehlgeschlagen: %w", err)
	}
	return pdf, nil
}

// mapToLetter combines a sender profile and the parsed letter into the pipeline
// letter. The sender comes entirely from the profile; the recipient block is
// flattened into the address lines din5008a expects.
func mapToLetter(p *profiles.Profile, ld frontmatter.LetterData) pipeline.Letter {
	sender := pipeline.Sender{
		Name:   p.Name,
		Street: p.Street,
		City:   strings.TrimSpace(p.Zip + " " + p.City), // din5008a expects "PLZ Ort"
		Phone:  p.Phone,
		Email:  p.Email,
		QR:     p.PrintQR,
	}
	if p.Bank != nil {
		sender.IBAN, sender.BIC, sender.Bank = p.Bank.IBAN, p.Bank.BIC, p.Bank.BankName
	}
	return pipeline.Letter{
		Sender:         sender,
		Recipient:      ld.Recipient,
		Date:           ld.Date,
		Subject:        ld.Subject,
		Closing:        ld.Closing,
		Accent:         p.Accent,
		SignatureWidth: p.SignatureWidth,
		Attachments:    ld.Attachments,
	}
}
