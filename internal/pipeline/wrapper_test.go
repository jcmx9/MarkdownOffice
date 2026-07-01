package pipeline

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildWrapperEmbedsPinnedImportsAndConformantAttach(t *testing.T) {
	letter := Letter{
		Sender: Sender{
			Name:   "Dr. Anna Weber",
			Street: "Lindenallee 12",
			City:   "80331 München",
			Email:  "anna.weber@example.de",
		},
		Recipient:   []string{"Sonnenschein Verlag GmbH", "50667 Köln"},
		Date:        "1. Juli 2026",
		Subject:     "Test",
		Closing:     "Mit freundlichen Grüßen",
		Signature:   "unterschrift.svg",
		Accent:      "#1F6FEB",
		Attachments: []string{"Anlage eins"},
	}

	w, err := BuildWrapper(letter, "26.4.35")
	if err != nil {
		t.Fatalf("BuildWrapper returned error: %v", err)
	}

	// Version-pinned local imports (din5008a version must be injected, not hardcoded elsewhere).
	if !strings.Contains(w.Typ, `#import "@local/din5008a:26.4.35"`) {
		t.Errorf("wrapper missing version-pinned din5008a import:\n%s", w.Typ)
	}
	if !strings.Contains(w.Typ, `#import "@local/cmarker:`) {
		t.Errorf("wrapper missing cmarker import:\n%s", w.Typ)
	}

	// PDF/A-3 requires AFRelationship + MIME type on the embedded source.
	if !strings.Contains(w.Typ, `pdf.attach("brief.md"`) ||
		!strings.Contains(w.Typ, `relationship: "source"`) ||
		!strings.Contains(w.Typ, `mime-type: "text/markdown"`) {
		t.Errorf("wrapper missing conformant pdf.attach:\n%s", w.Typ)
	}

	// Body is rendered from Markdown via cmarker (not Pandoc).
	if !strings.Contains(w.Typ, `cmarker.render(read("body.md"))`) {
		t.Errorf("wrapper does not render body via cmarker:\n%s", w.Typ)
	}

	// brief.json carries the structured sender data and accent colour.
	var data map[string]any
	if err := json.Unmarshal([]byte(w.JSON), &data); err != nil {
		t.Fatalf("brief.json is not valid JSON: %v", err)
	}
	sender, ok := data["sender"].(map[string]any)
	if !ok {
		t.Fatalf("brief.json has no sender object: %s", w.JSON)
	}
	if sender["name"] != "Dr. Anna Weber" {
		t.Errorf("sender.name = %v, want %q", sender["name"], "Dr. Anna Weber")
	}
	if data["accent"] != "#1F6FEB" {
		t.Errorf("accent = %v, want %q", data["accent"], "#1F6FEB")
	}
}
