package main

import (
	"strings"
	"testing"
)

func TestVersionLine(t *testing.T) {
	got := versionLine()
	if !strings.HasPrefix(got, "markdownoffice ") {
		t.Fatalf("versionLine() = %q, want prefix %q", got, "markdownoffice ")
	}
	if !strings.Contains(got, version) {
		t.Fatalf("versionLine() = %q, want it to contain version %q", got, version)
	}
}

func TestRunVersionFlags(t *testing.T) {
	for _, arg := range []string{"--version", "-V", "version"} {
		if err := run([]string{arg}); err != nil {
			t.Errorf("run(%q) returned error: %v", arg, err)
		}
	}
}
