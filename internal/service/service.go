// Package service composes the frontmatter parser and the Typst pipeline into a
// single "Markdown source in → PDF/A-3b out" operation, independent of transport
// (CLI or web).
package service

import (
	"context"
	"fmt"

	"github.com/jcmx9/mdo-service/internal/frontmatter"
	"github.com/jcmx9/mdo-service/internal/pipeline"
)

// SignatureResolver loads a signature image by the filename referenced in the
// letter frontmatter. It is optional; when nil, letters render without a
// signature image.
type SignatureResolver func(name string) ([]byte, error)

// Service renders letter sources to PDF/A-3b.
type Service struct {
	din5008aVersion string
	runner          pipeline.Runner
	sig             SignatureResolver
}

// Option configures a Service.
type Option func(*Service)

// WithSignatureResolver sets how signature images are located.
func WithSignatureResolver(r SignatureResolver) Option {
	return func(s *Service) { s.sig = r }
}

// New returns a Service that pins the given din5008a template version and uses
// runner to invoke Typst.
func New(din5008aVersion string, runner pipeline.Runner, opts ...Option) *Service {
	s := &Service{din5008aVersion: din5008aVersion, runner: runner}
	for _, o := range opts {
		o(s)
	}
	return s
}

// RenderMarkdown parses a letter source and compiles it to PDF/A-3b. Parse
// failures are returned as *frontmatter.ParseError (already user-friendly);
// compile failures are wrapped with a German message while preserving detail.
func (s *Service) RenderMarkdown(ctx context.Context, source string) ([]byte, error) {
	parsed, err := frontmatter.Parse(source)
	if err != nil {
		return nil, err
	}

	in := pipeline.Input{
		Letter: parsed.Letter,
		Body:   parsed.Body,
		Source: parsed.Source,
	}
	if parsed.Letter.Signature != "" && s.sig != nil {
		data, err := s.sig(parsed.Letter.Signature)
		if err != nil {
			return nil, fmt.Errorf("Signatur %q konnte nicht geladen werden: %w", parsed.Letter.Signature, err)
		}
		in.SignatureData = data
	}

	pdf, err := pipeline.Compile(ctx, s.runner, in, pipeline.Options{Din5008aVersion: s.din5008aVersion})
	if err != nil {
		return nil, fmt.Errorf("PDF-Erzeugung fehlgeschlagen: %w", err)
	}
	return pdf, nil
}
