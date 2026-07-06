// Package profiles is a file-backed store for sender profiles. Each profile is a
// directory <base>/<name>/ holding a profile.yaml and an optional signature
// image. Profiles are resolved local-then-global (first match wins); writes go
// to the global directory. Parse and lookup errors carry layperson-friendly
// German messages.
package profiles

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const profileFile = "profile.yaml"

var (
	hexColor  = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	validName = regexp.MustCompile(`^[a-z0-9_-]+$`)
)

// Bank holds the account details shown in the letter footer.
type Bank struct {
	Holder   string `json:"holder"`
	IBAN     string `json:"iban"`
	BIC      string `json:"bic"`
	BankName string `json:"bank_name"`
}

// Profile is a sender's stored master data.
type Profile struct {
	Name            string  `json:"name"`   // required
	Street          string  `json:"street"` // required
	Zip             string  `json:"zip"`    // required (a bare YAML number is coerced to string)
	City            string  `json:"city"`   // required
	Phone           string  `json:"phone"`
	Email           string  `json:"email"`
	Bank            *Bank   `json:"bank,omitempty"`
	Signature       string  `json:"signature"`        // signature filename, e.g. "signature.svg"
	SignatureHeight float64 `json:"signature_height"` // mm; default 15.0
	PrintQR         bool    `json:"print_qr"`         // default true
	Accent          string  `json:"accent"`           // "#RRGGBB"; "" = template default colour
}

// ProfileError is a user-facing failure with a German, layperson-friendly message.
type ProfileError struct {
	Message string
	Name    string // offending profile name
	Field   string // offending field, if applicable
	Err     error
}

func (e *ProfileError) Error() string {
	switch {
	case e.Field != "":
		return fmt.Sprintf("%s (Feld %q)", e.Message, e.Field)
	case e.Name != "":
		return fmt.Sprintf("%s (Profil %q)", e.Message, e.Name)
	default:
		return e.Message
	}
}

func (e *ProfileError) Unwrap() error { return e.Err }

// Store resolves profiles across a local and a global directory. Each directory
// contains one subdirectory per profile. Reads try local first; writes always
// target the global directory.
type Store struct {
	localDir  string           // checked first for reads; "" disables it
	globalDir string           // fallback for reads, target for writes
	now       func() time.Time // clock for letter IDs; injectable for tests
}

// NewStore builds a Store over the given profile base directories.
func NewStore(localDir, globalDir string) *Store {
	return &Store{localDir: localDir, globalDir: globalDir, now: time.Now}
}

// validateName rejects anything that is not a single safe slug segment, so a
// name can never escape its base directory.
func validateName(name string) error {
	if !validName.MatchString(name) {
		return &ProfileError{Message: "Profilname enthält ungültige Zeichen.", Name: name}
	}
	return nil
}

// resolveDir returns the profile directory for name, trying local then global.
func (s *Store) resolveDir(name string) (string, error) {
	if err := validateName(name); err != nil {
		return "", err
	}
	for _, base := range []string{s.localDir, s.globalDir} {
		if base == "" {
			continue
		}
		dir := filepath.Join(base, name)
		if fi, err := os.Stat(filepath.Join(dir, profileFile)); err == nil && !fi.IsDir() {
			return dir, nil
		}
	}
	return "", &ProfileError{Message: "Profil wurde nicht gefunden.", Name: name}
}

// mmFloat parses a millimetre value, tolerating an optional "mm" suffix.
type mmFloat float64

func (m *mmFloat) UnmarshalYAML(n *yaml.Node) error {
	if n.Kind != yaml.ScalarNode {
		return fmt.Errorf("expected a scalar value, got kind %d", n.Kind)
	}
	v := strings.TrimSpace(n.Value)
	if strings.HasSuffix(strings.ToLower(v), "mm") {
		v = strings.TrimSpace(v[:len(v)-2])
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return err
	}
	*m = mmFloat(f)
	return nil
}

// flexScalar accepts a YAML scalar regardless of its resolved type, so a bare
// postal-code number maps to a string.
type flexScalar string

func (f *flexScalar) UnmarshalYAML(n *yaml.Node) error {
	if n.Kind != yaml.ScalarNode {
		return fmt.Errorf("expected a scalar value, got kind %d", n.Kind)
	}
	*f = flexScalar(n.Value)
	return nil
}

type yamlBank struct {
	Holder   string `yaml:"holder,omitempty"`
	IBAN     string `yaml:"iban,omitempty"`
	BIC      string `yaml:"bic,omitempty"`
	BankName string `yaml:"bank_name,omitempty"`
}

type yamlProfile struct {
	Name            string     `yaml:"name"`
	Street          string     `yaml:"street"`
	Zip             flexScalar `yaml:"zip"`
	City            string     `yaml:"city"`
	Phone           string     `yaml:"phone,omitempty"`
	Email           string     `yaml:"email,omitempty"`
	Bank            *yamlBank  `yaml:"bank,omitempty"`
	Signature       string     `yaml:"signature,omitempty"`
	SignatureHeight *mmFloat   `yaml:"signature_height,omitempty"`
	PrintQR         *bool      `yaml:"print_qr,omitempty"`
	Accent          string     `yaml:"accent,omitempty"`
}

// Load reads and validates the named profile.
func (s *Store) Load(name string) (*Profile, error) {
	dir, err := s.resolveDir(name)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(filepath.Join(dir, profileFile))
	if err != nil {
		return nil, &ProfileError{Message: "Die Profildatei konnte nicht gelesen werden.", Name: name, Err: err}
	}
	var y yamlProfile
	if err := yaml.Unmarshal(raw, &y); err != nil {
		return nil, &ProfileError{Message: "Die Profildatei ist ungültig.", Name: name, Err: err}
	}

	p := &Profile{
		Name:            y.Name,
		Street:          y.Street,
		Zip:             string(y.Zip),
		City:            y.City,
		Phone:           y.Phone,
		Email:           y.Email,
		Signature:       y.Signature,
		Accent:          y.Accent,
		SignatureHeight: 15.0,
		PrintQR:         true,
	}
	if y.Bank != nil {
		p.Bank = &Bank{Holder: y.Bank.Holder, IBAN: y.Bank.IBAN, BIC: y.Bank.BIC, BankName: y.Bank.BankName}
	}
	if y.SignatureHeight != nil {
		p.SignatureHeight = float64(*y.SignatureHeight)
	}
	if y.PrintQR != nil {
		p.PrintQR = *y.PrintQR
	}

	for _, req := range []struct{ value, name string }{
		{p.Name, "name"}, {p.Street, "street"}, {p.Zip, "zip"}, {p.City, "city"},
	} {
		if strings.TrimSpace(req.value) == "" {
			return nil, &ProfileError{Message: "Ein Pflichtfeld fehlt oder ist leer.", Name: name, Field: req.name}
		}
	}
	if p.Accent != "" && !hexColor.MatchString(p.Accent) {
		return nil, &ProfileError{
			Message: fmt.Sprintf("Die Akzentfarbe muss ein Hex-Wert wie #B03060 sein, war %q.", p.Accent),
			Name:    name,
			Field:   "accent",
		}
	}
	return p, nil
}

// Signature returns the profile's signature image bytes and file extension
// (e.g. ".svg"), or (nil, "", nil) when the profile declares no signature.
func (s *Store) Signature(name string) (data []byte, ext string, err error) {
	dir, err := s.resolveDir(name)
	if err != nil {
		return nil, "", err
	}
	p, err := s.Load(name)
	if err != nil {
		return nil, "", err
	}
	filename := p.Signature
	if filename == "" {
		filename = "signature.svg"
	}
	raw, err := os.ReadFile(filepath.Join(dir, filename))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "", nil
		}
		return nil, "", &ProfileError{Message: "Die Signaturdatei konnte nicht gelesen werden.", Name: name, Err: err}
	}
	return raw, filepath.Ext(filename), nil
}

// List returns the union of profile names across both directories, sorted.
func (s *Store) List() ([]string, error) {
	seen := map[string]struct{}{}
	for _, base := range []string{s.localDir, s.globalDir} {
		if base == "" {
			continue
		}
		entries, err := os.ReadDir(base)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			if fi, err := os.Stat(filepath.Join(base, e.Name(), profileFile)); err == nil && !fi.IsDir() {
				seen[e.Name()] = struct{}{}
			}
		}
	}
	names := make([]string, 0, len(seen))
	for n := range seen {
		names = append(names, n)
	}
	sort.Strings(names)
	return names, nil
}

// Save writes the profile to the global directory, creating it if needed.
func (s *Store) Save(name string, p *Profile) error {
	dir, err := s.writeDir(name)
	if err != nil {
		return err
	}
	sh := mmFloat(p.SignatureHeight)
	qr := p.PrintQR
	y := yamlProfile{
		Name: p.Name, Street: p.Street, Zip: flexScalar(p.Zip), City: p.City,
		Phone: p.Phone, Email: p.Email, Signature: p.Signature, Accent: p.Accent,
		SignatureHeight: &sh, PrintQR: &qr,
	}
	if p.Bank != nil {
		y.Bank = &yamlBank{Holder: p.Bank.Holder, IBAN: p.Bank.IBAN, BIC: p.Bank.BIC, BankName: p.Bank.BankName}
	}
	out, err := yaml.Marshal(y)
	if err != nil {
		return &ProfileError{Message: "Das Profil konnte nicht gespeichert werden.", Name: name, Err: err}
	}
	if err := os.WriteFile(filepath.Join(dir, profileFile), out, 0o644); err != nil {
		return &ProfileError{Message: "Das Profil konnte nicht gespeichert werden.", Name: name, Err: err}
	}
	return nil
}

// SaveSignature writes a signature image (as signature<ext>) into the global
// profile directory.
func (s *Store) SaveSignature(name, ext string, data []byte) error {
	dir, err := s.writeDir(name)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "signature"+ext), data, 0o644); err != nil {
		return &ProfileError{Message: "Die Signatur konnte nicht gespeichert werden.", Name: name, Err: err}
	}
	return nil
}

// Delete removes the named profile from the global directory.
func (s *Store) Delete(name string) error {
	if err := validateName(name); err != nil {
		return err
	}
	if s.globalDir == "" {
		return &ProfileError{Message: "Kein Speicherort für Profile konfiguriert.", Name: name}
	}
	if err := os.RemoveAll(filepath.Join(s.globalDir, name)); err != nil {
		return &ProfileError{Message: "Das Profil konnte nicht gelöscht werden.", Name: name, Err: err}
	}
	return nil
}

// writeDir validates the name and returns the global profile directory, created.
func (s *Store) writeDir(name string) (string, error) {
	if err := validateName(name); err != nil {
		return "", err
	}
	if s.globalDir == "" {
		return "", &ProfileError{Message: "Kein Speicherort für Profile konfiguriert.", Name: name}
	}
	dir := filepath.Join(s.globalDir, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", &ProfileError{Message: "Das Profilverzeichnis konnte nicht angelegt werden.", Name: name, Err: err}
	}
	return dir, nil
}
