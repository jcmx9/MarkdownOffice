package profiles

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// LetterMeta is the listing metadata of a saved letter.
type LetterMeta struct {
	ID        string `json:"id"`
	Subject   string `json:"subject"`
	Recipient string `json:"recipient"`
	Date      string `json:"date"`
}

// SaveLetter stores a letter source under its profile as
// letters/<YYYY-MM-DD>-<subject-slug>/brief.md and returns the generated id.
// Same-day collisions get a numeric suffix.
func (s *Store) SaveLetter(profile, source string) (string, error) {
	dir, err := s.resolveDir(profile)
	if err != nil {
		return "", err
	}
	lettersDir := filepath.Join(dir, "letters")
	if err := os.MkdirAll(lettersDir, 0o755); err != nil {
		return "", saveLetterErr(profile, err)
	}

	base := s.now().Format("2006-01-02") + "-" + slugify(parseLetterMeta(source).Subject)
	id := base
	for n := 2; ; n++ {
		if _, err := os.Stat(filepath.Join(lettersDir, id)); os.IsNotExist(err) {
			break
		}
		id = fmt.Sprintf("%s-%d", base, n)
	}

	target := filepath.Join(lettersDir, id)
	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", saveLetterErr(profile, err)
	}
	if err := os.WriteFile(filepath.Join(target, "brief.md"), []byte(source), 0o644); err != nil {
		return "", saveLetterErr(profile, err)
	}
	return id, nil
}

// ListLetters returns a profile's saved letters, newest first.
func (s *Store) ListLetters(profile string) ([]LetterMeta, error) {
	dir, err := s.resolveDir(profile)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.Join(dir, "letters"))
	if err != nil {
		if os.IsNotExist(err) {
			return []LetterMeta{}, nil
		}
		return nil, err
	}
	metas := make([]LetterMeta, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, "letters", e.Name(), "brief.md"))
		if err != nil {
			continue
		}
		m := parseLetterMeta(string(raw))
		metas = append(metas, LetterMeta{ID: e.Name(), Subject: m.Subject, Recipient: m.Recipient.Name, Date: m.Date})
	}
	// IDs are date-prefixed, so a descending string sort is newest-first.
	sort.Slice(metas, func(i, j int) bool { return metas[i].ID > metas[j].ID })
	return metas, nil
}

// LoadLetter returns the verbatim source of a saved letter.
func (s *Store) LoadLetter(profile, id string) (string, error) {
	dir, err := s.letterDir(profile, id)
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(filepath.Join(dir, "brief.md"))
	if err != nil {
		return "", &ProfileError{Message: "Der Brief wurde nicht gefunden.", Name: profile, Err: err}
	}
	return string(raw), nil
}

// DeleteLetter removes a saved letter.
func (s *Store) DeleteLetter(profile, id string) error {
	dir, err := s.letterDir(profile, id)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(dir); err != nil {
		return &ProfileError{Message: "Der Brief konnte nicht gelöscht werden.", Name: profile, Err: err}
	}
	return nil
}

// letterDir validates the profile and id and returns the letter directory.
func (s *Store) letterDir(profile, id string) (string, error) {
	dir, err := s.resolveDir(profile)
	if err != nil {
		return "", err
	}
	if !validName.MatchString(id) {
		return "", &ProfileError{Message: "Ungültige Brief-Kennung.", Name: profile}
	}
	return filepath.Join(dir, "letters", id), nil
}

func saveLetterErr(profile string, err error) error {
	return &ProfileError{Message: "Der Brief konnte nicht gespeichert werden.", Name: profile, Err: err}
}

type letterMetaYAML struct {
	Subject   string `yaml:"subject"`
	Date      string `yaml:"date"`
	Recipient struct {
		Name string `yaml:"name"`
	} `yaml:"recipient"`
}

// parseLetterMeta extracts the listing fields from a letter's frontmatter. It
// is lenient: an unparseable or missing frontmatter yields a zero value.
func parseLetterMeta(source string) letterMetaYAML {
	var m letterMetaYAML
	if parts := strings.SplitN(source, "---", 3); len(parts) >= 3 {
		_ = yaml.Unmarshal([]byte(parts[1]), &m)
	}
	return m
}

// slugify turns a subject into a filesystem-friendly slug, transliterating
// German umlauts and collapsing other runs to single hyphens.
func slugify(s string) string {
	s = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss").Replace(strings.ToLower(s))
	var b strings.Builder
	dash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		case !dash && b.Len() > 0:
			b.WriteByte('-')
			dash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 60 {
		out = strings.Trim(out[:60], "-")
	}
	if out == "" {
		out = "brief"
	}
	return out
}
