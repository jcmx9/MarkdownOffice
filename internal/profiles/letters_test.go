package profiles

import (
	"testing"
	"time"
)

const letterSource = `---
profile: eltern
recipient:
  - Amt Musterstadt
  - Weg 1
  - 12345 Stadt
subject: Kündigung Vertrag
date: null
---

Sehr geehrte Damen und Herren, hiermit kündige ich.
`

func storeWithProfile(t *testing.T, clock time.Time) *Store {
	t.Helper()
	dir := t.TempDir()
	s := NewStore("", dir)
	s.now = func() time.Time { return clock }
	writeProfile(t, dir, "eltern", "name: X\nstreet: Y\nzip: 1\ncity: Z\n")
	return s
}

func TestSaveAndLoadLetter(t *testing.T) {
	s := storeWithProfile(t, time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC))
	id, err := s.SaveLetter("eltern", letterSource)
	if err != nil {
		t.Fatalf("SaveLetter: %v", err)
	}
	if id != "2026-07-06-kuendigung-vertrag" {
		t.Errorf("id = %q", id)
	}
	got, err := s.LoadLetter("eltern", id)
	if err != nil {
		t.Fatalf("LoadLetter: %v", err)
	}
	if got != letterSource {
		t.Errorf("loaded source differs from saved")
	}
}

func TestSaveLetterCollision(t *testing.T) {
	s := storeWithProfile(t, time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC))
	id1, _ := s.SaveLetter("eltern", letterSource)
	id2, err := s.SaveLetter("eltern", letterSource)
	if err != nil {
		t.Fatal(err)
	}
	if id2 != id1+"-2" {
		t.Errorf("collision ids = %q, %q (want second suffixed -2)", id1, id2)
	}
}

func TestListLettersNewestFirst(t *testing.T) {
	dir := t.TempDir()
	s := NewStore("", dir)
	writeProfile(t, dir, "eltern", "name: X\nstreet: Y\nzip: 1\ncity: Z\n")
	mk := func(day int, subject string) {
		s.now = func() time.Time { return time.Date(2026, 7, day, 0, 0, 0, 0, time.UTC) }
		src := "---\nprofile: eltern\nrecipient:\n  - Empf\nsubject: " + subject + "\n---\n\nBody\n"
		if _, err := s.SaveLetter("eltern", src); err != nil {
			t.Fatal(err)
		}
	}
	mk(4, "Alpha")
	mk(6, "Bravo")
	mk(5, "Charlie")

	metas, err := s.ListLetters("eltern")
	if err != nil {
		t.Fatal(err)
	}
	if len(metas) != 3 {
		t.Fatalf("got %d letters, want 3", len(metas))
	}
	if metas[0].ID != "2026-07-06-bravo" || metas[2].ID != "2026-07-04-alpha" {
		t.Errorf("order = %s, %s, %s (want newest first)", metas[0].ID, metas[1].ID, metas[2].ID)
	}
	if metas[0].Subject != "Bravo" || metas[0].Recipient != "Empf" {
		t.Errorf("meta = %+v", metas[0])
	}
}

func TestListLettersEmpty(t *testing.T) {
	s := storeWithProfile(t, time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC))
	metas, err := s.ListLetters("eltern")
	if err != nil || len(metas) != 0 {
		t.Errorf("empty archive = %v, %v", metas, err)
	}
}

func TestSaveLetterUnknownProfile(t *testing.T) {
	s := NewStore("", t.TempDir())
	if _, err := s.SaveLetter("ghost", letterSource); err == nil {
		t.Error("expected an error saving under a nonexistent profile")
	}
}

func TestDeleteLetter(t *testing.T) {
	s := storeWithProfile(t, time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC))
	id, _ := s.SaveLetter("eltern", letterSource)
	if err := s.DeleteLetter("eltern", id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LoadLetter("eltern", id); err == nil {
		t.Error("letter still loadable after delete")
	}
}

func TestLetterPathTraversal(t *testing.T) {
	s := storeWithProfile(t, time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC))
	for _, bad := range []string{"../x", "a/b", "..", ".", ""} {
		if _, err := s.LoadLetter("eltern", bad); err == nil {
			t.Errorf("LoadLetter(id=%q) = nil error", bad)
		}
	}
	if _, err := s.SaveLetter("../evil", letterSource); err == nil {
		t.Error("SaveLetter with a bad profile slug succeeded")
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Kündigung Vertrag":   "kuendigung-vertrag",
		"Ihr Angebot vom 1.7": "ihr-angebot-vom-1-7",
		"   ---   ":           "brief",
		"Öl & Größe/Straße":   "oel-groesse-strasse",
	}
	for in, want := range cases {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
}
