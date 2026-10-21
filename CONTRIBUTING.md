# Contributing

Thanks for your interest in contributing to this project. This guide describes the workflow.

## Prerequisites

- Node.js >= 22.12
- npm
- Git
- For the pipeline tests: `pdftotext` (poppler) or `mutool` (mupdf); the equivalence test needs poppler
- A GitHub account

## Setting Up the Development Environment

```bash
# Clone your fork
git clone git@github.com:<your-user>/MarkdownOffice.git
cd MarkdownOffice

# Install dependencies
npm ci
```

## Workflow

1. Create a branch from `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/<short-description>
   ```

2. Implement your changes.

3. Make sure all checks pass:
   ```bash
   npm run lint && npm run typecheck && npm test && npm run test:e2e
   bash pipeline/tests/test-pdf.sh && bash pipeline/tests/test-equivalence.sh
   ```
   Changes to the pipeline (`pipeline/`) must keep `test-pdf.sh` and `test-equivalence.sh`
   green; on Windows `pipeline/tests/test-windows.ps1` covers `convert.ps1`. Shell scripts
   must pass `shellcheck`.

4. Commit with a conventional commit message in English, without AI attribution lines:
   ```
   feat(editor): add word count
   ```

5. Push and create a PR targeting `dev`.

## The `markdown-office` command

The command is TypeScript in `src/cli/`, built on the shared logic in `src/core/` (no Electron, no Node modules there). `npm run build:cli` bundles it into `out/cli/cli.js`; packaging ships it as `<resources>/pipeline/cli.js`. `npm run dev` does not rebuild it, so run `npm run build:cli` (or `npm run build`) after changing `src/cli/` or `src/core/`.

## Pipeline assets

`npm run assets` downloads the pinned pipeline assets (Typst, fonts, Typst packages, template sets) into `build/pipeline-assets/`, checks every download against `scripts/pipeline-assets.json` and then builds the development layout `build/pipeline-dev/` (the packaged layout, used by `npm run dev`, the e2e tests and the pipeline tests); `npm run dist` runs the download first. To try an unpublished change to the `memo` set, point the script at a local checkout of `MarkdownOffice-set-memo` (the manifest's tag is archived; only tracked files are copied): `MDO_SET_MEMO_DIR=~/GitHub/MarkdownOffice-set-memo npm run assets`.

## Licence and contributor agreement

Markdown Office is licensed under the GNU Affero General Public License, version 3 or later
(AGPL-3.0-or-later). The maintainer (jcmx9) keeps the option to offer a separate commercial
licence (dual licensing). By submitting a contribution (pull request, patch or other code) you
agree that:

1. the contribution is your own work, or you have the right to submit it under these terms;
2. it is licensed under AGPL-3.0-or-later; and
3. you additionally grant jcmx9 a perpetual, worldwide, non-exclusive, royalty-free, irrevocable
   licence to use, modify, distribute and sublicense the contribution, including under other
   licence terms such as a commercial licence.

You keep the copyright of your contribution. Please confirm the agreement in your PR description
(see the checklist). Template sets are separate repositories under MIT.

## PR Checklist

Before submitting a PR, verify:

- [ ] All tests pass (`npm test`, `npm run test:e2e`, the pipeline tests)
- [ ] No linting errors (`npm run lint`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] New functionality has tests
- [ ] Documentation updated (if applicable; keep `README.md` and `README.en.md` identical)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Commit messages follow Conventional Commits
- [ ] I agree to the licence and contributor agreement above

## Code Standards

- **TypeScript strict** is required; **Biome** is the only linter/formatter.
- **Explicit types** are required for exported functions and methods.
- **Test coverage** for new functionality (target: >= 80 %).

## Issues

- Bug reports should include steps to reproduce.
- Feature requests should describe the use case, not just the desired solution.

## Code of Conduct

We expect respectful, constructive interaction. Harassment, discrimination, or trolling will result in exclusion.
