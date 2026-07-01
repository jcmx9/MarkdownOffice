package pipeline

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Runner executes Typst on entrypoint inside workdir, writing the PDF to outPath.
// It is the single external-tool seam of the pipeline and is faked in tests.
type Runner interface {
	Compile(ctx context.Context, workdir, entrypoint, outPath string) error
}

// Options configures a single compile run.
type Options struct {
	// Din5008aVersion pins the din5008a template version used in the import.
	Din5008aVersion string
}

// Input is everything needed to produce one letter PDF.
type Input struct {
	Letter Letter
	// Body is the Markdown body (without frontmatter), rendered via cmarker.
	Body string
	// Source is the full Markdown source (frontmatter + body), embedded verbatim
	// as the PDF/A-3 attachment.
	Source string
	// SignatureData is the optional signature image; written as Letter.Signature
	// into the compile directory when both are set.
	SignatureData []byte
}

// Compile writes the generated wrapper and its side-cars into a temporary
// directory, runs the Runner, and returns the resulting PDF bytes. The temporary
// directory is always removed before returning.
func Compile(ctx context.Context, r Runner, in Input, opts Options) ([]byte, error) {
	w, err := BuildWrapper(in.Letter, opts.Din5008aVersion)
	if err != nil {
		return nil, err
	}

	dir, err := os.MkdirTemp("", "mdo-compile-*")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(dir)

	files := map[string]string{
		"brief.typ":  w.Typ,
		"brief.json": w.JSON,
		"body.md":    in.Body,
		"brief.md":   in.Source,
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			return nil, fmt.Errorf("write %s: %w", name, err)
		}
	}
	if in.Letter.Signature != "" && len(in.SignatureData) > 0 {
		if err := os.WriteFile(filepath.Join(dir, in.Letter.Signature), in.SignatureData, 0o644); err != nil {
			return nil, fmt.Errorf("write signature: %w", err)
		}
	}

	out := filepath.Join(dir, "brief.pdf")
	if err := r.Compile(ctx, dir, "brief.typ", out); err != nil {
		return nil, err
	}
	pdf, err := os.ReadFile(out)
	if err != nil {
		return nil, fmt.Errorf("read output pdf: %w", err)
	}
	return pdf, nil
}

// TypstEnv locates the vendored Typst packages and fonts for the runner.
type TypstEnv struct {
	PackagePath      string // TYPST_PACKAGE_PATH — @local namespace packages
	PackageCachePath string // TYPST_PACKAGE_CACHE_PATH — @preview namespace cache
	FontPath         string // --font-path
}

type typstRunner struct {
	bin string
	env TypstEnv
}

// NewTypstRunner returns a Runner backed by the Typst CLI at bin, compiling to
// PDF/A-3b with the given package and font locations.
func NewTypstRunner(bin string, env TypstEnv) Runner {
	return &typstRunner{bin: bin, env: env}
}

func (t *typstRunner) Compile(ctx context.Context, workdir, entrypoint, outPath string) error {
	args := []string{"compile", "--pdf-standard", "a-3b", "--root", workdir}
	if t.env.FontPath != "" {
		args = append(args, "--font-path", t.env.FontPath)
	}
	args = append(args, filepath.Join(workdir, entrypoint), outPath)

	cmd := exec.CommandContext(ctx, t.bin, args...)
	cmd.Env = os.Environ()
	if t.env.PackagePath != "" {
		cmd.Env = append(cmd.Env, "TYPST_PACKAGE_PATH="+t.env.PackagePath)
	}
	if t.env.PackageCachePath != "" {
		cmd.Env = append(cmd.Env, "TYPST_PACKAGE_CACHE_PATH="+t.env.PackageCachePath)
	}

	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("typst compile failed: %w\n%s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}
