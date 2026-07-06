# Design: Multiprofil + Signatur (Increment 1d-b)

**Status:** Entwurf zur Review · **Datum:** 2026-07-06 · **Repo:** MarkdownOffice (Go-Tool)

## Ziel

Mehrere **Absender-Profile** (Multiprofil, *nicht* Multiuser/Auth) mit Stammdaten und optionaler
Signatur. Ein Brief referenziert ein Profil; der Absender kommt beim Rendern aus dem Profil. Damit
richtet sich das Go-Tool auf das **kanonische MarkdownOffice-Schema** aus (aus
`jcmx9/markdown-secretary`), nicht mehr auf das aus `mdo-cli` gespiegelte Startschema.

**Bewusste Konsequenz:** Bestehende `mdo-cli`-Briefe (inline-Absender, `recipient` als Liste) werden
inkompatibel. Das ist der Preis des Schema-Alignments und ausdrücklich gewählt.

**Keine Datenbank.** Alles liegt als Datei im Dateisystem — menschenlesbar, editierbar, git-bar,
per Ordner-Kopie sicherbar.

## Schema (kanonisch, aus markdown-secretary)

### Profil — `profile.yaml`
| Feld | Typ | Pflicht | Default |
|------|-----|---------|---------|
| `name` | str | ✓ | |
| `street` | str | ✓ | |
| `zip` | str | ✓ | (Int im YAML wird zu String) |
| `city` | str | ✓ | |
| `phone` | str | | – |
| `email` | str | | – |
| `bank` | `{holder, iban, bic, bank_name}` | | – |
| `signature` | str (Dateiname) | | – |
| `signature_height` | float (mm) | | 15.0 (Suffix „mm" erlaubt) |
| `print_qr` | bool | | true |

`din5008_form` entfällt — es wird **immer Form A** (`din5008a`) gesetzt.

### Brief — YAML-Frontmatter (Modell 2)
| Feld | Typ | Pflicht | Default |
|------|-----|---------|---------|
| `profile` | str | ✓ | |
| `recipient` | `{name, extra?, street, zip, city}` | ✓ | |
| `subject` | str | ✓ | |
| `date` | Datum | | null → heute (deutsch) |
| `closing` | str | | „Mit freundlichen Grüßen" |
| `sign` | bool | | false |
| `attachments` | list[str] | | [] |

`date` weicht bewusst vom kanonischen Pflichtfeld ab: null/fehlt → heute (behält das bisherige,
bequeme Go-Verhalten).

## Speicherstruktur & Lookup

```
<datadir>/profiles/<name>/
    profile.yaml            # Profil-Stammdaten
    signature.svg│png       # optional; via `signature:` referenziert
    letters/<id>/brief.md   # Korrespondenz für dieses Profil (Increment 1d-a, später)
        (+ brief.pdf)
```

- `<datadir>` = `os.UserConfigDir()/markdownoffice/`.
- **Lookup je Profilname:** `./profiles/<name>/` (CWD) → `<datadir>/profiles/<name>/` (global).
  Erster Treffer gewinnt (wie `core/profile.py`). Ein konfigurierbarer Cloud-/Nextcloud-Pfad als
  weiterer Lookup-Ort ist **Follow-up**, nicht Teil dieses Increments.
- **Pfad-Traversal-Schutz:** `<name>` wird als einzelnes, safes Slug-Segment validiert.

## Render-Fluss (Modell 2)

```
brief.md (profile: eltern)
  → frontmatter.Parse          → LetterData{Profile, Recipient, Subject, Date, Closing, Sign, Attachments} + Body + Source
  → profiles.Load("eltern")    → Profile{name, street, …, bank, signature, print_qr}
  → mapping: Profile + LetterData + (sign ? Signatur-Bytes) → pipeline.Letter (din5008a-Felder)
  → pipeline.Compile           → PDF/A-3b
```

- Absender/Bank/QR/Signatur kommen aus dem **Profil**; `recipient`/`subject`/Body aus dem **Brief**.
- Unbekanntes `profile:` → klare deutsche Fehlermeldung (kein Fallback; explizit ist ehrlicher).
- Fehlt `profile:` ganz → `default`-Profil, falls vorhanden, sonst Fehlermeldung.
- `sign: true` **und** Profil hat `signature` → Signaturgrafik einfügen (din5008a färbt sie auf den
  Akzent); sonst nur der übliche Unterschriftsabstand.

## Architektur & Paketgrenzen

- **`internal/profiles`** (neu): `Profile`-Model + `Load(name)` (Lookup, YAML-Parse, Validierung,
  laienfreundlicher `*ProfileError`), `Signature(name)` (Bytes + Endung), `List()` (Ordner-Scan),
  `Save`/`Delete` für die Web-Verwaltung. Reine FS-/Parsing-Unit, gegen Temp-Dir testbar.
- **`internal/frontmatter`** (Neuschnitt): neues `LetterData` (Modell 2 — `Profile`,
  strukturierter `Recipient`, `Sign`) statt inline-Sender + recipient-Liste. `*ParseError` bleibt.
- **`internal/service`**: `RenderMarkdown` wird profil-bewusst — parst den Brief, lädt das Profil,
  mappt beides auf `pipeline.Letter`, löst die Signatur über das Profil auf (schließt zugleich die
  heutige Lücke, dass `serve` Signaturen gar nicht rendert).
- **`internal/pipeline`**: `Letter`/`BuildWrapper` an das strukturierte `recipient` + die
  Profil-Felder angepasst; din5008a-Mapping (Sender aus Profil).
- **`internal/web`**: `ProfileStore`-Interface (List/Load/Save/Delete/Signature) → `*profiles`-Impl,
  Handler mockbar. Routen: Profil-CRUD, `POST /profiles/{name}/signature` (multipart),
  `GET /profiles` (Auswahl). UI: Profil-Verwaltung + Profil-Dropdown beim Schreiben.

`pipeline` kennt weiter weder HTTP noch Profile-Lookup (bekommt fertige `Letter`-Daten).

## Sub-Increments (test-first, je eigener Commit)

- **1d-b-1 — `internal/profiles`:** Model, `Load`/Lookup, `Signature`, `List`, Pfad-Traversal,
  `*ProfileError`. Unit-Tests gegen Temp-Dir. *Kein* Web/Pipeline-Bezug.
- **1d-b-2 — Schema-Neuschnitt + Mapping:** `frontmatter.LetterData` (Modell 2), din5008a-Mapping
  (Absender aus Profil, strukturierter `recipient`), `service.RenderMarkdown` profil-bewusst,
  Signatur-Auflösung. Unit + asset-gesteuerter E2E (veraPDF grün).
- **1d-b-3 — Web-UI:** Profil-Verwaltung (Formular + Signatur-Upload), Profil-Auswahl, neuer
  Default-Brief im neuen Schema. Handler-Tests mit Fake-`ProfileStore` (`httptest`).

## MVP-Grenzen (YAGNI)

- Signatur-Formate nur **SVG** (umfärbbar) **+ PNG**.
- Kein Cloud-/Nextcloud-Lookup-Pfad (Follow-up).
- Kein Brief-Archiv (das ist 1d-a; die `letters/`-Ebene wird hier nur strukturell vorgesehen).
- Kein `signature: true`-Auto-Detect.
- Nur Form A.

## Verifikation

- `go test ./...` grün (profiles gegen Temp-Dir; frontmatter-Neuschnitt; service/web mit Fakes).
- Asset-gesteuerter E2E: Brief mit `profile:` + Signatur → **veraPDF 3b grün**, Signatur/Bank/QR
  korrekt, eingebettete `.md` byte-identisch.
- `gofmt -l` / `go vet` / `golangci-lint run` grün.
- Manuell: `serve` → Profil anlegen (mit Signatur-Upload) → Brief „aus Profil" → Vorschau zeigt
  Absender + Signatur → Download.
