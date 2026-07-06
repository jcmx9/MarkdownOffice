package profiles

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func writeProfile(t *testing.T, base, name, yaml string) string {
	t.Helper()
	dir := filepath.Join(base, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "profile.yaml"), []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

const fullProfile = `name: Dr. Anna Weber
street: Lindenallee 12
zip: 80331
city: München
phone: 089 1234567
email: anna@example.de
bank:
  holder: Anna Weber
  iban: DE91 7002 0500 0009 8765 43
  bic: BFSWDE33MUE
  bank_name: Bank für Sozialwirtschaft
signature: signature.svg
signature_height: 15mm
print_qr: false
accent: "#C2185B"
`

func TestValidateName(t *testing.T) {
	valid := []string{"eltern", "default", "geschaeftlich", "a", "profil_1", "a-b"}
	for _, n := range valid {
		if err := validateName(n); err != nil {
			t.Errorf("validateName(%q) = %v, want nil", n, err)
		}
	}
	invalid := []string{"", ".", "..", "a/b", `a\b`, "a.b", "Eltern", "a b"}
	for _, n := range invalid {
		if err := validateName(n); err == nil {
			t.Errorf("validateName(%q) = nil, want error", n)
		}
	}
}

func TestLoadFull(t *testing.T) {
	dir := t.TempDir()
	writeProfile(t, dir, "anna", fullProfile)
	s := NewStore("", dir)

	p, err := s.Load("anna")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if p.Name != "Dr. Anna Weber" || p.Street != "Lindenallee 12" || p.City != "München" {
		t.Errorf("name/street/city wrong: %+v", p)
	}
	if p.Zip != "80331" { // int in YAML coerced to string
		t.Errorf("zip = %q, want 80331", p.Zip)
	}
	if p.Bank == nil || p.Bank.IBAN != "DE91 7002 0500 0009 8765 43" || p.Bank.BankName != "Bank für Sozialwirtschaft" {
		t.Errorf("bank not flattened: %+v", p.Bank)
	}
	if p.Signature != "signature.svg" {
		t.Errorf("signature = %q", p.Signature)
	}
	if p.SignatureHeight != 15.0 {
		t.Errorf("signature_height = %v, want 15", p.SignatureHeight)
	}
	if p.PrintQR != false { // explicit false must be respected
		t.Errorf("print_qr = %v, want false", p.PrintQR)
	}
	if p.Accent != "#C2185B" {
		t.Errorf("accent = %q", p.Accent)
	}
}

func TestLoadDefaults(t *testing.T) {
	dir := t.TempDir()
	writeProfile(t, dir, "min", "name: X\nstreet: Y\nzip: 12345\ncity: Z\n")
	s := NewStore("", dir)

	p, err := s.Load("min")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if p.SignatureHeight != 15.0 {
		t.Errorf("default signature_height = %v, want 15", p.SignatureHeight)
	}
	if p.PrintQR != true { // absent → true
		t.Errorf("default print_qr = %v, want true", p.PrintQR)
	}
	if p.Bank != nil || p.Signature != "" || p.Accent != "" {
		t.Errorf("optionals not empty: %+v", p)
	}
}

func TestLoadMissingRequired(t *testing.T) {
	dir := t.TempDir()
	writeProfile(t, dir, "bad", "name: X\nstreet: Y\nzip: 12345\n") // city missing
	s := NewStore("", dir)

	_, err := s.Load("bad")
	var pe *ProfileError
	if !errors.As(err, &pe) {
		t.Fatalf("err = %v, want *ProfileError", err)
	}
	if pe.Field != "city" {
		t.Errorf("Field = %q, want city", pe.Field)
	}
}

func TestLoadInvalidAccent(t *testing.T) {
	dir := t.TempDir()
	writeProfile(t, dir, "bad", "name: X\nstreet: Y\nzip: 1\ncity: Z\naccent: red\n")
	s := NewStore("", dir)

	_, err := s.Load("bad")
	var pe *ProfileError
	if !errors.As(err, &pe) || pe.Field != "accent" {
		t.Fatalf("err = %v, want *ProfileError on accent", err)
	}
}

func TestSignatureHeightFormats(t *testing.T) {
	dir := t.TempDir()
	writeProfile(t, dir, "a", "name: X\nstreet: Y\nzip: 1\ncity: Z\nsignature_height: 12.5\n")
	writeProfile(t, dir, "b", "name: X\nstreet: Y\nzip: 1\ncity: Z\nsignature_height: 20mm\n")
	s := NewStore("", dir)

	if p, _ := s.Load("a"); p.SignatureHeight != 12.5 {
		t.Errorf("a = %v, want 12.5", p.SignatureHeight)
	}
	if p, _ := s.Load("b"); p.SignatureHeight != 20.0 {
		t.Errorf("b = %v, want 20", p.SignatureHeight)
	}
}

func TestLookupOrder(t *testing.T) {
	local, global := t.TempDir(), t.TempDir()
	writeProfile(t, local, "anna", "name: LOCAL\nstreet: Y\nzip: 1\ncity: Z\n")
	writeProfile(t, global, "anna", "name: GLOBAL\nstreet: Y\nzip: 1\ncity: Z\n")
	s := NewStore(local, global)

	p, err := s.Load("anna")
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "LOCAL" { // local shadows global
		t.Errorf("Name = %q, want LOCAL", p.Name)
	}

	if _, err := s.Load("missing"); !errors.As(err, new(*ProfileError)) {
		t.Errorf("missing profile err = %v, want *ProfileError", err)
	}
}

func TestSignature(t *testing.T) {
	dir := t.TempDir()
	pdir := writeProfile(t, dir, "anna", fullProfile)
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)
	if err := os.WriteFile(filepath.Join(pdir, "signature.svg"), svg, 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewStore("", dir)

	data, ext, err := s.Signature("anna")
	if err != nil {
		t.Fatalf("Signature: %v", err)
	}
	if ext != ".svg" || !reflect.DeepEqual(data, svg) {
		t.Errorf("Signature = (%q, %q)", data, ext)
	}

	// Profile without a signature file → no data, no error.
	writeProfile(t, dir, "nosig", "name: X\nstreet: Y\nzip: 1\ncity: Z\n")
	data, ext, err = s.Signature("nosig")
	if err != nil || data != nil || ext != "" {
		t.Errorf("no-signature = (%v, %q, %v), want (nil, \"\", nil)", data, ext, err)
	}
}

func TestList(t *testing.T) {
	local, global := t.TempDir(), t.TempDir()
	writeProfile(t, global, "anna", "name: X\nstreet: Y\nzip: 1\ncity: Z\n")
	writeProfile(t, global, "eltern", "name: X\nstreet: Y\nzip: 1\ncity: Z\n")
	writeProfile(t, local, "anna", "name: X\nstreet: Y\nzip: 1\ncity: Z\n") // dup
	writeProfile(t, local, "büro", "name: X\nstreet: Y\nzip: 1\ncity: Z\n")
	s := NewStore(local, global)

	got, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"anna", "büro", "eltern"} // union, dedup, sorted
	if !reflect.DeepEqual(got, want) {
		t.Errorf("List = %v, want %v", got, want)
	}
}

func TestSaveLoadRoundtrip(t *testing.T) {
	global := t.TempDir()
	s := NewStore("", global)

	p := &Profile{
		Name: "Anna", Street: "Weg 1", Zip: "12345", City: "Ort",
		Email: "a@b.de", Bank: &Bank{IBAN: "DE1", BIC: "BIC", BankName: "Bank"},
		SignatureHeight: 15.0, PrintQR: true, Accent: "#103C78",
	}
	if err := s.Save("anna", p); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := s.Load("anna")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(got, p) {
		t.Errorf("roundtrip mismatch:\n got %+v\nwant %+v", got, p)
	}
}

func TestDeleteAndBadSlug(t *testing.T) {
	global := t.TempDir()
	s := NewStore("", global)
	writeProfile(t, global, "anna", "name: X\nstreet: Y\nzip: 1\ncity: Z\n")

	if err := s.Delete("anna"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := s.Load("anna"); !errors.As(err, new(*ProfileError)) {
		t.Errorf("after delete, Load err = %v, want *ProfileError", err)
	}

	for _, bad := range []string{"../etc", "a/b", ""} {
		if _, err := s.Load(bad); err == nil {
			t.Errorf("Load(%q) = nil, want error", bad)
		}
		if err := s.Save(bad, &Profile{}); err == nil {
			t.Errorf("Save(%q) = nil, want error", bad)
		}
	}
}

func TestSaveSignature(t *testing.T) {
	global := t.TempDir()
	s := NewStore("", global)
	if err := s.Save("anna", &Profile{Name: "A", Street: "S", Zip: "1", City: "C", SignatureHeight: 15, PrintQR: true}); err != nil {
		t.Fatal(err)
	}
	svg := []byte(`<svg/>`)
	if err := s.SaveSignature("anna", ".svg", svg); err != nil {
		t.Fatalf("SaveSignature: %v", err)
	}
	data, ext, err := s.Signature("anna")
	if err != nil || ext != ".svg" || !reflect.DeepEqual(data, svg) {
		t.Errorf("after SaveSignature, Signature = (%q, %q, %v)", data, ext, err)
	}
}
