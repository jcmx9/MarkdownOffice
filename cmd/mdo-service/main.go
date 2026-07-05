// Command mdo-service renders DIN 5008 letters from Markdown to PDF/A-3b, either
// one-shot (`render`) or via a local browser UI (`serve`).
//
// With the embed_assets build tag it runs self-contained (bundled Typst, fonts
// and packages). Without it, it shells out to a system Typst located via the
// MDO_* environment variables.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/jcmx9/mdo-service/internal/assets"
	"github.com/jcmx9/mdo-service/internal/bootstrap"
	"github.com/jcmx9/mdo-service/internal/pipeline"
	"github.com/jcmx9/mdo-service/internal/service"
	"github.com/jcmx9/mdo-service/internal/web"
)

// din5008aVersion is the pinned din5008a template version, matched by the
// vendored/embedded package tree (see scripts/fetch-assets.sh).
const din5008aVersion = "26.4.35"

// version is the tool version. A source build reports "dev"; release builds set
// it via -ldflags "-X main.version=<CalVer>".
var version = "dev"

func versionLine() string { return "mdo-service " + version }

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
	case "serve":
		return runServe(args[1:])
	case "-V", "--version", "version":
		fmt.Println(versionLine())
		return nil
	case "-h", "--help", "help":
		usage()
		return nil
	default:
		usage()
		return fmt.Errorf("unbekannter Befehl %q", args[0])
	}
}

// newTypstRunner builds the Typst runner. With embedded assets it extracts them
// into the user data dir and uses those; otherwise it falls back to a system
// Typst located via MDO_* environment variables.
func newTypstRunner() (pipeline.Runner, error) {
	if assets.Available() {
		base, err := os.UserConfigDir()
		if err != nil {
			return nil, fmt.Errorf("Datenverzeichnis nicht bestimmbar: %w", err)
		}
		root := filepath.Join(base, "mdo-service", "runtime")
		rt, err := bootstrap.Extract(root, assets.TypstVersion, assets.TypstBinary(), assets.SupportFS())
		if err != nil {
			return nil, fmt.Errorf("eingebettete Assets konnten nicht entpackt werden: %w", err)
		}
		return pipeline.NewTypstRunner(rt.TypstBin, pipeline.TypstEnv{
			PackagePath:      rt.PackagePath,
			PackageCachePath: rt.CachePath,
			FontPath:         rt.FontPath,
		}), nil
	}
	return pipeline.NewTypstRunner(env("MDO_TYPST_BIN", "typst"), pipeline.TypstEnv{
		PackagePath:      os.Getenv("MDO_PACKAGE_PATH"),
		PackageCachePath: os.Getenv("MDO_PACKAGE_CACHE_PATH"),
		FontPath:         os.Getenv("MDO_FONT_PATH"),
	}), nil
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

	runner, err := newTypstRunner()
	if err != nil {
		return err
	}
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

func runServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	addr := fs.String("addr", "127.0.0.1:8765", "Adresse (nur Loopback)")
	noOpen := fs.Bool("no-open", false, "Browser nicht automatisch öffnen")
	if err := fs.Parse(args); err != nil {
		return err
	}

	runner, err := newTypstRunner()
	if err != nil {
		return err
	}
	srv, err := web.NewServer(service.New(din5008aVersion, runner))
	if err != nil {
		return err
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return fmt.Errorf("kann nicht auf %s lauschen (Port belegt?): %w", *addr, err)
	}
	url := "http://" + ln.Addr().String()
	httpSrv := &http.Server{Handler: srv, ReadHeaderTimeout: 5 * time.Second}

	fmt.Printf("mdo-service läuft auf %s  (Strg-C zum Beenden)\n", url)
	if !*noOpen {
		openBrowser(url)
	}

	// Graceful shutdown on SIGINT/SIGTERM.
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(ctx)
	}()

	if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

func openBrowser(url string) {
	var name string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		name, args = "open", []string{url}
	case "windows":
		name, args = "rundll32", []string{"url.dll,FileProtocolHandler", url}
	default:
		name, args = "xdg-open", []string{url}
	}
	_ = exec.Command(name, args...).Start()
}

func usage() {
	fmt.Fprintf(os.Stderr, `%s — DIN-5008-Geschäftsbriefe aus Markdown (PDF/A-3b)

Befehle:
  render <datei.md> [-o out.pdf]   Brief nach PDF/A-3b erzeugen
  serve [--addr 127.0.0.1:8765] [--no-open]   Browser-Editor mit Live-Vorschau
  --version, -V                    Version anzeigen

Umgebungsvariablen (nur ohne eingebettete Assets):
  MDO_TYPST_BIN, MDO_PACKAGE_PATH, MDO_PACKAGE_CACHE_PATH, MDO_FONT_PATH
`, versionLine())
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
