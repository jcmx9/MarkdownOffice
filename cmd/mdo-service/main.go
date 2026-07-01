// Command mdo-service renders DIN 5008 letters from Markdown to PDF/A-3b.
//
// For now it shells out to a system Typst and locates the vendored packages and
// fonts via environment variables; embedding those assets is a later step.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/jcmx9/mdo-service/internal/pipeline"
	"github.com/jcmx9/mdo-service/internal/service"
)

// din5008aVersion is the pinned template version. It will be derived from the
// embedded assets once bootstrapping (1b-ii) lands.
const din5008aVersion = "26.4.35"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "Fehler: "+err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		usage()
		return nil
	}
	switch args[0] {
	case "render":
		return runRender(args[1:])
	case "-h", "--help", "help":
		usage()
		return nil
	default:
		usage()
		return fmt.Errorf("unbekannter Befehl %q", args[0])
	}
}

func runRender(args []string) error {
	fs := flag.NewFlagSet("render", flag.ContinueOnError)
	out := fs.String("o", "", "Ausgabedatei (Standard: <datei>.pdf)")

	// Allow flags before and after the positional argument.
	var positional []string
	rest := args
	for len(rest) > 0 {
		if err := fs.Parse(rest); err != nil {
			return err
		}
		if fs.NArg() == 0 {
			break
		}
		positional = append(positional, fs.Arg(0))
		rest = fs.Args()[1:]
	}
	if len(positional) != 1 {
		return fmt.Errorf("Aufruf: mdo-service render <datei.md> [-o out.pdf]")
	}
	inPath := positional[0]

	source, err := os.ReadFile(inPath)
	if err != nil {
		return fmt.Errorf("Datei nicht lesbar: %w", err)
	}

	outPath := *out
	if outPath == "" {
		outPath = strings.TrimSuffix(inPath, filepath.Ext(inPath)) + ".pdf"
	}

	runner := pipeline.NewTypstRunner(env("MDO_TYPST_BIN", "typst"), pipeline.TypstEnv{
		PackagePath:      os.Getenv("MDO_PACKAGE_PATH"),
		PackageCachePath: os.Getenv("MDO_PACKAGE_CACHE_PATH"),
		FontPath:         os.Getenv("MDO_FONT_PATH"),
	})

	// Signatures are resolved relative to the letter file's directory.
	dir := filepath.Dir(inPath)
	svc := service.New(din5008aVersion, runner, service.WithSignatureResolver(
		func(name string) ([]byte, error) { return os.ReadFile(filepath.Join(dir, name)) },
	))

	pdf, err := svc.RenderMarkdown(context.Background(), string(source))
	if err != nil {
		return err
	}
	if err := os.WriteFile(outPath, pdf, 0o644); err != nil {
		return fmt.Errorf("Ausgabe nicht schreibbar: %w", err)
	}
	fmt.Printf("PDF geschrieben: %s\n", outPath)
	return nil
}

func usage() {
	fmt.Fprint(os.Stderr, `mdo-service — DIN-5008-Geschäftsbriefe aus Markdown (PDF/A-3b)

Befehle:
  render <datei.md> [-o out.pdf]   Brief nach PDF/A-3b erzeugen

Umgebungsvariablen (bis Assets eingebettet sind):
  MDO_TYPST_BIN, MDO_PACKAGE_PATH, MDO_PACKAGE_CACHE_PATH, MDO_FONT_PATH
`)
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
