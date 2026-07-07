# Release-Workflow

MarkdownOffice-Releases werden mit [GoReleaser](https://goreleaser.com/) gebaut
(`.goreleaser.yaml`) und über GitHub Actions veröffentlicht
(`.github/workflows/release.yml`, triggert auf `v*`-Tags).

## Was ein Release erzeugt

Pro Ziel ein **self-contained** Binary — Typst, Fonts und die Typst-Pakete sind
eingebettet (`-tags embed_assets`), es braucht kein System-Typst und kein Netz:

| OS | Arch |
|----|------|
| macOS | arm64, amd64 |
| Linux | amd64, arm64 |
| Windows | amd64 |

Dazu: `tar.gz`/`zip`-Archive (mit `LICENSE`/READMEs), `checksums.txt`, GitHub-Release
und ein Homebrew-**Cask** im Tap `jcmx9/homebrew-tap`.

## Assets (fetch-at-build)

`scripts/fetch-assets.sh` lädt die eingebetteten Assets nach `internal/assets/dist/`
(gitignored). Modi:

```bash
./scripts/fetch-assets.sh shared   # Fonts + Typst-Pakete (plattformunabhängig, einmal)
GOOS=linux GOARCH=amd64 ./scripts/fetch-assets.sh typst   # Typst-Binary pro Target
./scripts/fetch-assets.sh          # beides für den Host
```

GoReleaser holt `shared` einmal (`before.hooks`) und pro Build das Ziel-Typst
(`builds[].hooks.pre` mit `GOOS`/`GOARCH`). Weitere Plattformen brauchen je eine
`internal/assets/embed_typst_<os>_<arch>.go`.

## Ohne Veröffentlichung testen

```bash
goreleaser check                                   # Config validieren
goreleaser build --snapshot --single-target --clean  # Host-Binary bauen, kein Publish
```

## Echten Release schneiden

Voraussetzungen: ein Tap-Repo `jcmx9/homebrew-tap` und ein Repo-Secret
`HOMEBREW_TAP_TOKEN` (PAT mit Schreibrechten darauf; nur für den Cask nötig).

```bash
git tag v26.7.0
git push origin v26.7.0     # löst den Release-Workflow aus
```

## Signierung (bewusst: keine kostenpflichtigen Zertifikate)

Nur die für Apple Silicon nötige **Ad-hoc-Signatur** (gegen `Killed: 9`): das
Go-Binary signiert der Linker beim Bauen, das eingebettete Typst ist von Typst
signiert. Der Homebrew-Cask entfernt beim Installieren das macOS-Quarantäne-Flag.
Beim allerersten Start kann eine einmalige „trotzdem öffnen"-Hürde auftreten.

## Offen (Follow-ups)

winget-/scoop-Manifeste, Doppelklick-Launcher, veraPDF-Gate im CI.
