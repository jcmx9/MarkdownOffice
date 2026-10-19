# Releasing Markdown Office

Versions use CalVer `YY.M.MICRO`. The single source is `version` in `package.json`; every
bump also rewrites the `**Version:**` line of `README.md` and `README.en.md`.
Dev builds are `YY.M.MICRO-dev.N`. A tag `v<version>` triggers
`.github/workflows/release.yml`; a tag containing `-dev.` publishes a GitHub pre-release,
any other tag a normal release.

The release workflow verifies that the tag equals `v` + the `package.json` version, builds on
macOS (arm64 and x64 zips), Windows (x64 zip) and Linux (x64 AppImage), names the assets
`markdown-office-<version>-<os>-<arch>.<ext>` (electron-builder `artifactName`, e.g.
`markdown-office-26.10.0-mac-arm64.zip`, `markdown-office-26.10.0-linux-x86_64.AppImage`) and
publishes them with a `SHA256SUMS` file (`<hash>  <file>` lines). `scripts/bootstrap.sh` and
`scripts/bootstrap.ps1` download exactly these names and verify them against `SHA256SUMS`.

## Commands

```bash
./scripts/release.sh dev                 # pre-release from dev
./scripts/release.sh prod                # release dev -> main
./scripts/release.sh prod --new-month    # release with the current YY.M and MICRO 0
./scripts/release.sh dev --dry-run       # print the steps, change nothing
```

`--print-next dev|prod [--new-month]` prints only the next version.

### dev

Run on a clean, up-to-date `dev`. The script bumps `-dev.N` to `-dev.N+1`
(`npm version --no-git-tag-version`, so `package-lock.json` follows), commits
`release: <version>`, tags `v<version>` and pushes branch and tag with `git push --atomic`:
if `dev` is rejected, the tag is not published either. A rerun after a failed push sees
the local commit and tag and only repeats the push.

### prod

Run from a clean, up-to-date `dev` with `gh` authenticated. Every `gh` call uses
`-R <owner/repo>` (derived from the `origin` URL, override with `MDO_GH_REPO`), so the
working directory does not matter. Without `--new-month` the script warns when the release
would carry an older `YY.M` than today.

1. Guard: every change on `main` must already be in `dev` (`main` is an ancestor of `dev`,
   or merging `main` into `dev` is clean and changes nothing, e.g. a hotfix committed to
   both). Otherwise the script stops with exit 10 and nothing pushed: merge `main` into
   `dev` by a PR first.
   Then branch `release/<version>` = **one snapshot commit** on top of `origin/main` whose
   tree is `origin/dev`'s tree plus the release version and the rolled `CHANGELOG.md`
   (`## [Unreleased]` stays, `## [<version>] - <date>` is inserted below it). Message
   `release: <version>` with the trailer `Release-Source: <dev commit>`. No dev commit is
   replayed, so conflicts resolved on `dev` earlier never block a release; `main` gets one
   commit per release and stays linear.
2. Pull request into `main` (a single commit); the script polls until GitHub has registered the checks, then
   waits for them (`gh pr checks --watch --fail-fast`).
3. Rebase-merge (keeps `main` linear; GitHub gives the commit a new SHA).
4. Fetch `main` and verify that `package.json` on `main` equals the version. On a
   mismatch the script aborts before tagging.
5. Tag `v<version>` on `main`, push the tag (publishes the release).
6. Back-merge `chore/back-merge-<version>`: from `origin/dev`, a merge commit with `main`
   as second parent whose content is dev plus the release delta
   (`Release-Source..main`: version, CHANGELOG, hotfixes). Only conflicts in the version
   lines (`package.json`, `package-lock.json`, the READMEs) are resolved automatically; dev then gets the next `YY.M.(MICRO+1)-dev.0`. The
   PR into `dev` is merged with a merge commit.

Nothing is pushed on a failed precondition. The script aborts on every error.

Commits made by the script use the repository's configured author and bypass git hooks and
sign-off, so they carry no `Co-authored-by` or `Signed-off-by` trailers; the only trailer is
`Release-Source`. The release workflow writes the GitHub release notes from `CHANGELOG.md`
(`scripts/release-notes.sh`: the version's section, for pre-releases `[Unreleased]`)
instead of GitHub's generated notes, which list PR authors and contributors.

`--dry-run` runs the local checks (branch, clean tree, `dev` against the last fetched
`origin/dev`, local tag, tools) and reports failures as warnings, without network access,
then prints the steps.

## Recovery

Each prod step checks whether an earlier run already did it, so after fixing the cause
(for example a failed check) run `./scripts/release.sh prod` again from `dev`:

| State found | Rerun does |
|---|---|
| `origin/release/<v>` is the snapshot of the current `origin/dev` on `origin/main` | reuses it |
| `origin/release/<v>` is stale (dev or main moved, e.g. a fix after failed checks) | stops (exit 9) with `git push origin --delete release/<v> && scripts/release.sh prod`; the rerun builds a fresh snapshot and PR |
| PR open / already merged | waits for checks and merges / skips the merge |
| `main` already has the version | skips to tagging |
| tag `v<v>` already on `origin` (on `main`, right version) | skips to the back-merge |
| `origin/chore/back-merge-<v>` exists | reuses it |
| `origin/dev` already contains `main` | skips the back-merge |

A local `release/<v>` or `chore/back-merge-<v>` branch that was never pushed is rebuilt.

**Exit 10 in the back-merge** (dev changed the same lines as `main` after the release was
cut): the release is published, nothing was pushed to `dev`. Finish by hand:

```bash
git checkout -b chore/back-merge-<v> origin/dev
# Same recipe as the script: record main as merged without taking its tree, then apply only
# what the release commit changed (version + CHANGELOG). A plain merge would use an older merge
# base and could bring back changes that dev reverted after the release was cut.
git merge -s ours --no-commit origin/main
git diff "<Release-Source of the release commit>" origin/main | git apply -3
npm version <v+1>-dev.0 --no-git-tag-version --allow-same-version
git commit -am "chore(release): back-merge v<v> into dev"
git push -u origin chore/back-merge-<v>
gh pr create --base dev --head chore/back-merge-<v> --fill
```

Then merge the PR with a merge commit (not squash or rebase, so `main` stays an ancestor
of `dev`).

**Exit 10 before the release branch** (`main` has changes that are not in `dev`, e.g. a
hotfix only on `main`): nothing was pushed. Merge `main` into `dev` by a PR (resolve the
conflicts there) and start `prod` again. After a manual back-merge as above, the next
`prod` also runs normally.

## Exit codes

| Code | Meaning |
|------|---------|
| 2 | Usage error |
| 3 | Not on `dev` |
| 4 | Working tree not clean |
| 5 | `dev` differs from `origin/dev` |
| 6 | Missing tool, `gh` not logged in, fetch failed |
| 7 | Tag already exists (local or remote) and does not belong to this release |
| 8 | Invalid version, or wrong version on `main` |
| 9 | A step failed (including failed or missing PR checks) |
| 10 | `main` has changes not in `dev` (before the release), or a back-merge conflict outside the version lines; nothing pushed for that step |

## Tests

`scripts/test-release.sh` checks the version arithmetic, the `--dry-run` output and runs
the flows in a throwaway repository with a bare fake origin and fake `npm`/`gh`. The fake
rebase-merge cherry-picks onto `main` with a new committer (new SHAs, like GitHub) and
refuses merge commits or conflicts. It runs dev → prod → dev → prod → prod `--new-month`
(one commit per release on `main`), resumes after failed checks, refuses a stale release
branch with the rebuild command, takes a hotfix back into dev, aborts a conflicting
back-merge cleanly and releases afterwards (manual back-merge; hotfix in `main` and `dev`;
hotfix only on `main` → exit 10, then `main` merged into `dev`), checks the atomic dev
push, that script commits carry no attribution trailers even with hooks that add them,
and `scripts/release-notes.sh`. CI runs it on Linux together with `release.sh dev --dry-run`
and `prod --dry-run`.
