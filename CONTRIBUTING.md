# Contributing

Thanks for your interest in contributing to `mdo-service`. This guide describes the workflow.

## Prerequisites

- [Go](https://go.dev/) >= 1.26
- Git
- A GitHub account
- Optional: [golangci-lint](https://golangci-lint.run/) for local linting, node/npm to
  re-vendor the editor's CodeMirror bundle

## Setting Up

```bash
git clone git@github.com:jcmx9/mdo-service.git
cd mdo-service
make build
make test
```

## Workflow (GitHub Flow)

1. Create a branch from `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/<short-description>
   ```
   Branch prefixes: `feature/`, `bugfix/`, `hotfix/`, `docs/`, `refactor/`.

2. Implement your change **test-first** (small increments, one concern per commit).

3. Make sure all checks pass:
   ```bash
   gofmt -l .          # must print nothing
   go vet ./...
   golangci-lint run
   go test ./...
   ```

4. Commit with a [Conventional Commits](https://www.conventionalcommits.org/) message
   (English), e.g. `feat(pipeline): add CSV table import`. Do **not** add AI co-author lines.

5. Push and open a PR targeting `dev`.

## PR Checklist

- [ ] `gofmt -l .` is clean and `go vet ./...` passes
- [ ] `golangci-lint run` passes
- [ ] `go test ./...` passes
- [ ] New functionality has tests
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Documentation updated (both `README.md` and `README.en.md` stay in sync)

## Code Standards

- Type hints / explicit types as idiomatic Go; run `gofmt` (no manual formatting).
- Public functions and packages carry doc comments.
- Errors reaching the user are plain-language German, without a stack trace.
- Keep packages layered: `pipeline` knows neither HTTP nor storage.

## Versioning

[CalVer](https://calver.org/) in the format `YY.M.MICRO`. Release binaries carry the version via
build-time ldflags; a source build reports `dev`.

## Code of Conduct

We expect respectful, constructive interaction. Harassment, discrimination, or trolling will result
in exclusion.
